// Command seed_matrix generates test payloads and seeds PostgreSQL + Redis
// for all 6 event configuration combinations.
//
// Usage:
//
//	go run ./tests/load/cmd/seed_matrix \
//	  -guests-per-config 15000 \
//	  -hmac-secret "$HMAC_SECRET" \
//	  -redis-url redis://localhost:6379 \
//	  -pg-url postgres://eventarc:password@localhost:6432/eventarc
//
// For each configuration:
//  1. Creates an event record in PG with the config settings
//  2. Creates guest records with QR payloads
//  3. Seeds Redis with guest cache hashes
//  4. Seeds Redis with food rules per event
//  5. Seeds vendor hierarchy
//  6. Writes payloads_{config_name}.json for k6 consumption
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// EventConfig represents one of the 6 supported configurations.
type EventConfig struct {
	Name       string
	QRStrategy string
	FoodMode   string
	FoodTiming string
}

func allConfigs() []EventConfig {
	return []EventConfig{
		{Name: "unified_guestlinked_presnt", QRStrategy: "unified", FoodMode: "guest-linked", FoodTiming: "pre-sent"},
		{Name: "unified_anonymous_presnt", QRStrategy: "unified", FoodMode: "anonymous", FoodTiming: "pre-sent"},
		{Name: "separate_guestlinked_presnt", QRStrategy: "separate", FoodMode: "guest-linked", FoodTiming: "pre-sent"},
		{Name: "separate_guestlinked_postentry", QRStrategy: "separate", FoodMode: "guest-linked", FoodTiming: "post-entry"},
		{Name: "separate_anonymous_presnt", QRStrategy: "separate", FoodMode: "anonymous", FoodTiming: "pre-sent"},
		{Name: "separate_anonymous_postentry", QRStrategy: "separate", FoodMode: "anonymous", FoodTiming: "post-entry"},
	}
}

// payloadEntry is the JSON format written for k6 consumption.
type payloadEntry struct {
	GuestID        string `json:"guest_id"`
	Category       string `json:"category"`
	EntryPayload   string `json:"entry_payload,omitempty"`
	FoodPayload    string `json:"food_payload,omitempty"`
	UnifiedPayload string `json:"unified_payload,omitempty"`
	EntryStallID   string `json:"entry_stall_id"`
	FoodStallID    string `json:"food_stall_id"`
}

func main() {
	guestsPerConfig := flag.Int("guests-per-config", 15000, "Number of guests per configuration")
	hmacSecret := flag.String("hmac-secret", "load_test_hmac_secret", "HMAC secret key")
	redisURL := flag.String("redis-url", "redis://localhost:6379", "Redis URL")
	pgURL := flag.String("pg-url", "postgres://eventarc:dev_password@localhost:6432/eventarc?sslmode=disable", "PostgreSQL URL")
	outputDir := flag.String("output-dir", "", "Directory for JSON files (default: same dir as script)")
	configsFlag := flag.String("configs", "", "Comma-separated config names to seed (default: all)")
	flag.Parse()

	if *outputDir == "" {
		// Default to the current working directory so payloads land in a
		// stable, predictable location regardless of whether the binary
		// was invoked via `go run` (which uses a temp build dir).
		*outputDir, _ = os.Getwd()
		if *outputDir == "" {
			*outputDir = "."
		}
	}

	ctx := context.Background()

	// Connect to Redis
	redisOpts, err := redis.ParseURL(*redisURL)
	if err != nil {
		log.Fatalf("failed to parse Redis URL: %v", err)
	}
	rdb := redis.NewClient(redisOpts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("failed to connect to Redis: %v", err)
	}
	defer rdb.Close()

	// Connect to PostgreSQL
	pgPool, err := pgxpool.New(ctx, *pgURL)
	if err != nil {
		log.Fatalf("failed to connect to PostgreSQL: %v", err)
	}
	defer pgPool.Close()

	secret := []byte(*hmacSecret)
	now := time.Now().Unix()
	totalStart := time.Now()

	// Filter configs if specified
	configs := allConfigs()
	if *configsFlag != "" {
		names := strings.Split(*configsFlag, ",")
		nameSet := make(map[string]bool)
		for _, n := range names {
			nameSet[strings.TrimSpace(n)] = true
		}
		var filtered []EventConfig
		for _, cfg := range configs {
			if nameSet[cfg.Name] {
				filtered = append(filtered, cfg)
			}
		}
		configs = filtered
	}

	if len(configs) == 0 {
		log.Fatal("no configurations to seed")
	}

	log.Printf("Seeding %d configs with %d guests each...", len(configs), *guestsPerConfig)

	for _, cfg := range configs {
		configStart := time.Now()
		eventID := fmt.Sprintf("loadtest_%s", cfg.Name)

		log.Printf("  Config: %s (event: %s)", cfg.Name, eventID)

		// 1. Create event in PG
		_, err := pgPool.Exec(ctx,
			`INSERT INTO event_counters (event_id, counter_key, value)
			 VALUES ($1, 'totalGuests', $2)
			 ON CONFLICT (event_id, counter_key) DO UPDATE SET value = $2`,
			eventID, *guestsPerConfig,
		)
		if err != nil {
			log.Printf("    WARNING: failed to insert event counter in PG: %v", err)
		}

		// 2. Seed Redis event config
		eventKey := fmt.Sprintf("event:%s", eventID)
		rdb.HSet(ctx, eventKey, map[string]interface{}{
			"name":       fmt.Sprintf("Load Test (%s)", cfg.Name),
			"status":     "live",
			"qrStrategy": cfg.QRStrategy,
			"foodQrMode": cfg.FoodMode,
			"foodTiming": cfg.FoodTiming,
		})

		// 3. Seed food rules
		rulesKey := fmt.Sprintf("foodrules:%s", eventID)
		rdb.HSet(ctx, rulesKey, map[string]interface{}{
			"vip:fuchka":      3,
			"general:fuchka":  1,
			"staff:fuchka":    2,
			"vip:coke":        -1,
			"general:coke":    2,
			"staff:coke":      2,
			"vip:biryani":     2,
			"general:biryani": 1,
			"staff:biryani":   1,
		})

		// 4. Seed food category names
		for id, name := range map[string]string{"fuchka": "Fuchka", "coke": "Coke", "biryani": "Biryani"} {
			rdb.HSet(ctx, fmt.Sprintf("foodcategory:%s:%s", eventID, id), "name", name)
		}

		// 5. Seed stall names
		stallNames := map[string]string{
			"stall_entry_01":   "Entry Gate 1",
			"stall_entry_02":   "Entry Gate 2",
			"stall_fuchka_01":  "Fuchka Stall 1",
			"stall_fuchka_02":  "Fuchka Stall 2",
			"stall_coke_01":    "Coke Stall 1",
			"stall_biryani_01": "Biryani Stall 1",
		}
		for stallID, name := range stallNames {
			rdb.HSet(ctx, fmt.Sprintf("stall:%s:%s", eventID, stallID), "name", name)
		}

		// 6. Seed deterministic scanner sessions for load scenarios.
		entrySession := model.DeviceSession{
			Token:            fmt.Sprintf("k6_entry_%s", eventID),
			StallID:          "stall_entry_01",
			EventID:          eventID,
			VendorCategoryID: "cat_entry",
			VendorTypeID:     "type_entry",
			VendorType:       "entry",
			CreatedAt:        time.Now().UTC(),
		}
		foodSession := model.DeviceSession{
			Token:            fmt.Sprintf("k6_food_%s", eventID),
			StallID:          "stall_fuchka_01",
			EventID:          eventID,
			VendorCategoryID: "fuchka",
			VendorTypeID:     "type_food",
			VendorType:       "food",
			CreatedAt:        time.Now().UTC(),
		}
		entryRaw, err := json.Marshal(entrySession)
		if err != nil {
			log.Fatalf("failed to marshal entry session: %v", err)
		}
		foodRaw, err := json.Marshal(foodSession)
		if err != nil {
			log.Fatalf("failed to marshal food session: %v", err)
		}
		if err := rdb.Set(ctx, "session:"+entrySession.Token, entryRaw, 48*time.Hour).Err(); err != nil {
			log.Fatalf("failed to seed entry session in redis: %v", err)
		}
		if err := rdb.Set(ctx, "session:"+foodSession.Token, foodRaw, 48*time.Hour).Err(); err != nil {
			log.Fatalf("failed to seed food session in redis: %v", err)
		}

		// 7. Initialize counters
		countersKey := fmt.Sprintf("counters:%s", eventID)
		rdb.HSet(ctx, countersKey, "attendance", 0, "totalGuests", *guestsPerConfig)

		// 8. Generate guests and payloads
		categories := []string{"vip", "general", "staff"}
		categoryWeights := []int{5000, 8000, 2000} // Per 15K: 5K VIP, 8K General, 2K Staff
		if *guestsPerConfig != 15000 {
			// Scale proportionally
			total := *guestsPerConfig
			categoryWeights = []int{total / 3, total * 8 / 15, total - total/3 - total*8/15}
		}

		payloads := make([]payloadEntry, 0, *guestsPerConfig)
		pipe := rdb.Pipeline()
		batchSize := 1000
		guestIdx := 0

		for catIdx, category := range categories {
			count := categoryWeights[catIdx]
			if catIdx == len(categories)-1 {
				// Last category gets the remainder
				count = *guestsPerConfig - guestIdx
			}

			for i := 0; i < count && guestIdx < *guestsPerConfig; i++ {
				guestID := fmt.Sprintf("guest_%06d", guestIdx)

				// Seed guest hash in Redis
				guestKey := fmt.Sprintf("guest:%s:%s", eventID, guestID)
				pipe.HSet(ctx, guestKey, map[string]interface{}{
					"name":          fmt.Sprintf("%s Guest %06d", category, guestIdx),
					"category":      category,
					"categoryLabel": strings.Title(category),
					"photoUrl":      "",
				})

				// For anonymous mode, seed anonymous token
				if cfg.FoodMode == "anonymous" {
					anonKey := fmt.Sprintf("anontoken:%s:%s", eventID, guestID)
					pipe.HSet(ctx, anonKey, "category", category)
				}

				// Generate QR payloads
				entry := payloadEntry{
					GuestID:      guestID,
					Category:     category,
					EntryStallID: fmt.Sprintf("stall_entry_%02d", guestIdx%2+1),
					FoodStallID:  "stall_fuchka_01",
				}

				if cfg.QRStrategy == "unified" {
					p := qr.Payload{
						Version:   qr.PayloadVersion,
						QRType:    qr.QRTypeUnified,
						EventID:   eventID,
						GuestID:   guestID,
						Timestamp: now,
					}
					encoded, encErr := qr.EncodePayload(p, secret)
					if encErr != nil {
						log.Fatalf("failed to encode unified payload: %v", encErr)
					}
					entry.UnifiedPayload = encoded
				} else {
					// Entry payload
					entryP := qr.Payload{
						Version:   qr.PayloadVersion,
						QRType:    qr.QRTypeEntry,
						EventID:   eventID,
						GuestID:   guestID,
						Timestamp: now,
					}
					entryEncoded, encErr := qr.EncodePayload(entryP, secret)
					if encErr != nil {
						log.Fatalf("failed to encode entry payload: %v", encErr)
					}
					entry.EntryPayload = entryEncoded

					// Food payload (only for pre-sent timing)
					if cfg.FoodTiming == "pre-sent" {
						foodP := qr.Payload{
							Version:   qr.PayloadVersion,
							QRType:    qr.QRTypeFood,
							EventID:   eventID,
							GuestID:   guestID,
							Timestamp: now,
						}
						foodEncoded, encErr := qr.EncodePayload(foodP, secret)
						if encErr != nil {
							log.Fatalf("failed to encode food payload: %v", encErr)
						}
						entry.FoodPayload = foodEncoded
					}
				}

				payloads = append(payloads, entry)
				guestIdx++

				// Execute pipeline in batches
				if guestIdx%batchSize == 0 {
					if _, execErr := pipe.Exec(ctx); execErr != nil {
						log.Fatalf("Redis pipeline exec failed at batch %d: %v", guestIdx/batchSize, execErr)
					}
					pipe = rdb.Pipeline()
					if guestIdx%(batchSize*5) == 0 {
						log.Printf("    Seeded %d/%d guests...", guestIdx, *guestsPerConfig)
					}
				}
			}
		}

		// Execute remaining pipeline
		if _, err := pipe.Exec(ctx); err != nil {
			log.Fatalf("Redis pipeline exec failed (final): %v", err)
		}

		// 8. Write payloads JSON file
		outputFile := filepath.Join(*outputDir, fmt.Sprintf("payloads_%s.json", cfg.Name))
		jsonData, err := json.Marshal(payloads)
		if err != nil {
			log.Fatalf("failed to marshal payloads: %v", err)
		}
		if err := os.WriteFile(outputFile, jsonData, 0644); err != nil {
			log.Fatalf("failed to write %s: %v", outputFile, err)
		}

		configDuration := time.Since(configStart)
		log.Printf("    Config %s: %d guests, %d payloads, event %s (%s)",
			cfg.Name, guestIdx, len(payloads), eventID, configDuration)
	}

	totalDuration := time.Since(totalStart)
	log.Printf("Total: %d configs seeded in %s", len(configs), totalDuration)
}
