//go:build integration

package hardening

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// testHMACSecret is the HMAC secret used for all hardening tests.
var testHMACSecret = []byte("hardening_test_hmac_secret_32b!")

// EventConfig represents one of the 6 supported event configurations.
type EventConfig struct {
	Name       string
	QRStrategy string // "unified" or "separate"
	FoodMode   string // "guest-linked" or "anonymous"
	FoodTiming string // "pre-sent" or "post-entry"
}

// AllConfigs returns all 6 valid configuration combinations.
// QR strategy (2) x food mode (2) x food timing (2) = 8, but unified strategy
// always uses pre-sent timing (no post-entry for unified), so we get 6 valid combos.
func AllConfigs() []EventConfig {
	return []EventConfig{
		{Name: "unified_guestlinked_present", QRStrategy: "unified", FoodMode: "guest-linked", FoodTiming: "pre-sent"},
		{Name: "unified_anonymous_present", QRStrategy: "unified", FoodMode: "anonymous", FoodTiming: "pre-sent"},
		{Name: "separate_guestlinked_present", QRStrategy: "separate", FoodMode: "guest-linked", FoodTiming: "pre-sent"},
		{Name: "separate_guestlinked_postentry", QRStrategy: "separate", FoodMode: "guest-linked", FoodTiming: "post-entry"},
		{Name: "separate_anonymous_present", QRStrategy: "separate", FoodMode: "anonymous", FoodTiming: "pre-sent"},
		{Name: "separate_anonymous_postentry", QRStrategy: "separate", FoodMode: "anonymous", FoodTiming: "post-entry"},
	}
}

// TestInfra holds test container references and clients.
type TestInfra struct {
	PG             *pgxpool.Pool
	Redis          *redis.Client
	PGContainer    testcontainers.Container
	RedisContainer testcontainers.Container
	Ctx            context.Context
	Cancel         context.CancelFunc
}

// SetupTestInfra creates PostgreSQL 17 + Redis 8 containers, runs migrations,
// and returns connected clients. Caller must defer infra.Teardown(t).
func SetupTestInfra(t *testing.T) *TestInfra {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)

	// Start PostgreSQL 17 container
	pgContainer, err := postgres.Run(ctx,
		"postgres:17-alpine",
		postgres.WithDatabase("eventarc_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(30*time.Second),
		),
	)
	if err != nil {
		cancel()
		t.Fatalf("failed to start postgres container: %v", err)
	}

	// Start Redis 8 container
	redisContainer, err := tcredis.Run(ctx,
		"redis:8-alpine",
		tcredis.WithLogLevel(tcredis.LogLevelNotice),
	)
	if err != nil {
		pgContainer.Terminate(ctx)
		cancel()
		t.Fatalf("failed to start redis container: %v", err)
	}

	// Get PostgreSQL connection string
	pgConnStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		pgContainer.Terminate(ctx)
		redisContainer.Terminate(ctx)
		cancel()
		t.Fatalf("failed to get pg connection string: %v", err)
	}

	// Get Redis connection string
	redisEndpoint, err := redisContainer.Endpoint(ctx, "")
	if err != nil {
		pgContainer.Terminate(ctx)
		redisContainer.Terminate(ctx)
		cancel()
		t.Fatalf("failed to get redis endpoint: %v", err)
	}

	// Connect to PostgreSQL
	pgPool, err := pgxpool.New(ctx, pgConnStr)
	if err != nil {
		pgContainer.Terminate(ctx)
		redisContainer.Terminate(ctx)
		cancel()
		t.Fatalf("failed to connect to postgres: %v", err)
	}

	// Run migrations
	if err := runMigrations(ctx, pgPool); err != nil {
		pgPool.Close()
		pgContainer.Terminate(ctx)
		redisContainer.Terminate(ctx)
		cancel()
		t.Fatalf("failed to run migrations: %v", err)
	}

	// Connect to Redis
	rdb := redis.NewClient(&redis.Options{
		Addr: redisEndpoint,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		pgPool.Close()
		pgContainer.Terminate(ctx)
		redisContainer.Terminate(ctx)
		cancel()
		t.Fatalf("failed to connect to redis: %v", err)
	}

	return &TestInfra{
		PG:             pgPool,
		Redis:          rdb,
		PGContainer:    pgContainer,
		RedisContainer: redisContainer,
		Ctx:            ctx,
		Cancel:         cancel,
	}
}

// Teardown closes clients and terminates containers.
func (ti *TestInfra) Teardown(t *testing.T) {
	t.Helper()
	if ti.PG != nil {
		ti.PG.Close()
	}
	if ti.Redis != nil {
		ti.Redis.Close()
	}
	if ti.PGContainer != nil {
		ti.PGContainer.Terminate(ti.Ctx)
	}
	if ti.RedisContainer != nil {
		ti.RedisContainer.Terminate(ti.Ctx)
	}
	if ti.Cancel != nil {
		ti.Cancel()
	}
}

// runMigrations applies all up migrations to the test database.
func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	// Find the migrations directory relative to the test file
	migrationsDir := findMigrationsDir()
	if migrationsDir == "" {
		return fmt.Errorf("migrations directory not found")
	}

	// Read and sort migration files
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	var upFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".sql" {
			if len(entry.Name()) > 7 && entry.Name()[len(entry.Name())-7:] == ".up.sql" {
				upFiles = append(upFiles, filepath.Join(migrationsDir, entry.Name()))
			}
		}
	}
	sort.Strings(upFiles)

	for _, f := range upFiles {
		sql, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", f, err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("execute migration %s: %w", filepath.Base(f), err)
		}
	}
	return nil
}

// findMigrationsDir walks up from the test directory to find backend/migrations.
func findMigrationsDir() string {
	// Try relative paths from test location
	candidates := []string{
		"../../migrations",                    // backend/tests/hardening -> backend/migrations
		"../../../backend/migrations",         // fallback
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return ""
}

// SeedEvent creates an event with the given config in Redis.
// Returns the event ID.
func (ti *TestInfra) SeedEvent(t *testing.T, cfg EventConfig) string {
	t.Helper()
	eventID := fmt.Sprintf("evt_%s_%d", cfg.Name[:8], time.Now().UnixNano()%100000)

	// Seed event config in Redis (used by food_service.go to determine food mode)
	eventKey := fmt.Sprintf("event:%s", eventID)
	err := ti.Redis.HSet(ti.Ctx, eventKey, map[string]interface{}{
		"name":        fmt.Sprintf("Test Event (%s)", cfg.Name),
		"status":      "live",
		"qrStrategy":  cfg.QRStrategy,
		"foodQrMode":  cfg.FoodMode,
		"foodTiming":  cfg.FoodTiming,
	}).Err()
	if err != nil {
		t.Fatalf("failed to seed event in Redis: %v", err)
	}

	return eventID
}

// TestGuest holds test guest data with QR payloads.
type TestGuest struct {
	ID           string
	Name         string
	Category     string // "vip", "general", "staff"
	CategoryID   string // category ID for food rules lookup
	EntryQR      string // base64url encoded entry QR payload
	FoodQR       string // base64url encoded food QR payload (may be same as EntryQR for unified)
}

// SeedGuests creates N guests for an event with categories.
// Returns guest IDs and their pre-generated QR payloads.
// Categories distributed: first third VIP, next half General, remainder Staff.
func (ti *TestInfra) SeedGuests(t *testing.T, eventID string, cfg EventConfig, count int) []TestGuest {
	t.Helper()
	now := time.Now().Unix()
	guests := make([]TestGuest, 0, count)

	pipe := ti.Redis.Pipeline()
	for i := 0; i < count; i++ {
		guestID := fmt.Sprintf("guest_%s_%04d", eventID[4:12], i)
		var category, categoryID string
		switch {
		case i < count/5:
			category = "VIP"
			categoryID = "vip"
		case i < count/5+count*3/5:
			category = "General"
			categoryID = "general"
		default:
			category = "Staff"
			categoryID = "staff"
		}

		name := fmt.Sprintf("%s Guest %04d", category, i)

		// Seed guest hash in Redis
		guestKey := fmt.Sprintf("guest:%s:%s", eventID, guestID)
		pipe.HSet(ti.Ctx, guestKey, map[string]interface{}{
			"name":          name,
			"category":      categoryID,
			"categoryLabel": category,
			"photoUrl":      "",
		})

		// Generate QR payloads based on strategy
		var entryQR, foodQR string

		if cfg.QRStrategy == "unified" {
			// Unified: single QR code
			p := qr.Payload{
				Version:   qr.PayloadVersion,
				QRType:    qr.QRTypeUnified,
				EventID:   eventID,
				GuestID:   guestID,
				Timestamp: now,
			}
			encoded, err := qr.EncodePayload(p, testHMACSecret)
			if err != nil {
				t.Fatalf("failed to encode unified payload for guest %d: %v", i, err)
			}
			entryQR = encoded
			foodQR = encoded
		} else {
			// Separate: entry + food QR codes
			entryP := qr.Payload{
				Version:   qr.PayloadVersion,
				QRType:    qr.QRTypeEntry,
				EventID:   eventID,
				GuestID:   guestID,
				Timestamp: now,
			}
			entryEncoded, err := qr.EncodePayload(entryP, testHMACSecret)
			if err != nil {
				t.Fatalf("failed to encode entry payload for guest %d: %v", i, err)
			}
			entryQR = entryEncoded

			if cfg.FoodTiming == "pre-sent" {
				foodP := qr.Payload{
					Version:   qr.PayloadVersion,
					QRType:    qr.QRTypeFood,
					EventID:   eventID,
					GuestID:   guestID,
					Timestamp: now,
				}
				foodEncoded, err := qr.EncodePayload(foodP, testHMACSecret)
				if err != nil {
					t.Fatalf("failed to encode food payload for guest %d: %v", i, err)
				}
				foodQR = foodEncoded
			}
			// For post-entry timing, foodQR stays empty (generated after entry)
		}

		// For anonymous mode, also seed anonymous token metadata
		if cfg.FoodMode == "anonymous" {
			anonKey := fmt.Sprintf("anontoken:%s:%s", eventID, guestID)
			pipe.HSet(ti.Ctx, anonKey, map[string]interface{}{
				"category": categoryID,
			})
		}

		guests = append(guests, TestGuest{
			ID:         guestID,
			Name:       name,
			Category:   category,
			CategoryID: categoryID,
			EntryQR:    entryQR,
			FoodQR:     foodQR,
		})

		// Execute pipeline in batches of 500
		if (i+1)%500 == 0 {
			if _, err := pipe.Exec(ti.Ctx); err != nil {
				t.Fatalf("redis pipeline exec failed at batch %d: %v", i/500, err)
			}
			pipe = ti.Redis.Pipeline()
		}
	}

	// Execute remaining pipeline commands
	if _, err := pipe.Exec(ti.Ctx); err != nil {
		t.Fatalf("redis pipeline exec failed (final): %v", err)
	}

	return guests
}

// SeedFoodRules creates food rules matrix for an event.
// 3 food categories x 3 guest categories with varying limits.
//
// Rules:
//
//	fuchka:  VIP=3, General=1, Staff=2
//	coke:    VIP=-1 (unlimited), General=2, Staff=2
//	biryani: VIP=2, General=1, Staff=1
func (ti *TestInfra) SeedFoodRules(t *testing.T, eventID string) {
	t.Helper()
	rulesKey := fmt.Sprintf("foodrules:%s", eventID)
	rules := map[string]interface{}{
		// Format: "{guestCategoryId}:{foodCategoryId}" -> limit
		"vip:fuchka":     3,
		"general:fuchka":  1,
		"staff:fuchka":    2,
		"vip:coke":       -1, // unlimited
		"general:coke":    2,
		"staff:coke":      2,
		"vip:biryani":    2,
		"general:biryani": 1,
		"staff:biryani":   1,
	}

	if err := ti.Redis.HSet(ti.Ctx, rulesKey, rules).Err(); err != nil {
		t.Fatalf("failed to seed food rules: %v", err)
	}

	// Seed food category name cache
	foodCategories := map[string]string{
		"fuchka":  "Fuchka",
		"coke":    "Coke",
		"biryani": "Biryani",
	}
	for id, name := range foodCategories {
		catKey := fmt.Sprintf("foodcategory:%s:%s", eventID, id)
		ti.Redis.HSet(ti.Ctx, catKey, "name", name)
	}
}

// SeedVendorHierarchy creates vendor types, categories, and stalls.
// Returns stall IDs for use in scan requests.
func (ti *TestInfra) SeedVendorHierarchy(t *testing.T, eventID string) []string {
	t.Helper()
	stallIDs := []string{
		"stall_entry_01",
		"stall_entry_02",
		"stall_fuchka_01",
		"stall_fuchka_02",
		"stall_coke_01",
		"stall_biryani_01",
	}

	stallNames := map[string]string{
		"stall_entry_01":   "Entry Gate 1",
		"stall_entry_02":   "Entry Gate 2",
		"stall_fuchka_01":  "Fuchka Stall 1",
		"stall_fuchka_02":  "Fuchka Stall 2",
		"stall_coke_01":    "Coke Stall 1",
		"stall_biryani_01": "Biryani Stall 1",
	}

	pipe := ti.Redis.Pipeline()
	for stallID, name := range stallNames {
		key := fmt.Sprintf("stall:%s:%s", eventID, stallID)
		pipe.HSet(ti.Ctx, key, "name", name)
	}
	if _, err := pipe.Exec(ti.Ctx); err != nil {
		t.Fatalf("failed to seed vendor hierarchy: %v", err)
	}

	return stallIDs
}

// InitializeCounters sets up initial counter values for an event.
func (ti *TestInfra) InitializeCounters(t *testing.T, eventID string) {
	t.Helper()
	countersKey := fmt.Sprintf("counters:%s", eventID)
	ti.Redis.HSet(ti.Ctx, countersKey, "attendance", 0)
}
