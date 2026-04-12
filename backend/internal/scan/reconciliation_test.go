//go:build integration

package scan

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// TestCounterReconciliation_AfterLoad verifies that Redis counters match PG
// state after processing many scans through the full pipeline (Redis + PG).
func TestCounterReconciliation_AfterLoad(t *testing.T) {
	store := setupTestPG(t)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	eventID := "reconcile_load_test_001"

	const numGuests = 500

	// Process scans through the service (Redis path)
	svc := &Service{
		redis:      rdb,
		pgPool:     nil,
		pgStore:    store,
		hmacSecret: testSecret,
	}

	// Seed guests and process scans
	for i := 0; i < numGuests; i++ {
		guestID := fmt.Sprintf("rec_load_guest_%04d", i)
		category := []string{"vip", "regular", "staff"}[i%3]
		seedTestGuest(t, rdb, eventID, guestID, fmt.Sprintf("Rec Guest %d", i), category)

		payload := makeValidPayload(t, eventID, guestID, qr.QRTypeEntry)
		result, err := svc.ProcessEntryScan(ctx, ScanRequest{
			QRPayload: payload,
			StallID:   "stall_rec_load",
			DeviceID:  "device_rec_load",
		})
		if err != nil {
			t.Fatalf("scan %d failed: %v", i, err)
		}
		if result.Status != "valid" {
			t.Fatalf("scan %d expected valid, got %q", i, result.Status)
		}

		// Also write to PG synchronously for reconciliation check
		now := time.Now().UTC()
		_, pgErr := store.InsertEntryScan(ctx, InsertParams{
			EventID:       eventID,
			GuestID:       guestID,
			StallID:       "stall_rec_load",
			DeviceID:      "device_rec_load",
			ScannedAt:     now,
			GuestCategory: category,
			Status:        "valid",
		})
		if pgErr != nil {
			t.Fatalf("pg insert %d failed: %v", i, pgErr)
		}
	}

	// Verify Redis attendance matches PG count
	countersKey := fmt.Sprintf("counters:%s", eventID)
	redisAttendance, _ := rdb.HGet(ctx, countersKey, "attendance").Result()
	pgCount, _ := store.CountByEvent(ctx, eventID)

	if redisAttendance != fmt.Sprintf("%d", pgCount) {
		t.Errorf("attendance mismatch: Redis=%s, PG=%d", redisAttendance, pgCount)
	}

	// Verify checked-in set matches PG
	checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
	setCard, _ := rdb.SCard(ctx, checkedInKey).Result()
	if setCard != pgCount {
		t.Errorf("set mismatch: Redis SCARD=%d, PG count=%d", setCard, pgCount)
	}

	// Verify per-category counts
	pgCategories, _ := store.CountByCategory(ctx, eventID)
	for _, cat := range pgCategories {
		if cat.GuestCategory == "" {
			continue
		}
		redisVal, _ := rdb.HGet(ctx, countersKey, cat.GuestCategory+":checkedin").Result()
		if redisVal != fmt.Sprintf("%d", cat.Total) {
			t.Errorf("category %s mismatch: Redis=%s, PG=%d", cat.GuestCategory, redisVal, cat.Total)
		}
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", eventID)
}

// TestReseedAfterRedisRestart verifies counter re-seed produces correct values
// after a simulated Redis restart.
func TestReseedAfterRedisRestart(t *testing.T) {
	store := setupTestPG(t)
	ctx := context.Background()
	eventID := "reseed_restart_test_001"

	// Insert 300 scan records directly into PG
	categories := map[string]int{"vip": 100, "regular": 150, "staff": 50}
	guestNum := 0
	for cat, count := range categories {
		for i := 0; i < count; i++ {
			guestID := fmt.Sprintf("restart_guest_%04d", guestNum)
			guestNum++
			_, err := store.InsertEntryScan(ctx, InsertParams{
				EventID:       eventID,
				GuestID:       guestID,
				StallID:       "stall_restart",
				DeviceID:      "device_restart",
				ScannedAt:     time.Now().UTC(),
				GuestCategory: cat,
				Status:        "valid",
			})
			if err != nil {
				t.Fatalf("insert failed: %v", err)
			}
		}
	}

	// Create new Redis instance (simulating restart — no data)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	// Re-seed from PG
	reseedSvc := NewReseedService(rdb, store)
	if err := reseedSvc.ReseedEventCounters(ctx, eventID); err != nil {
		t.Fatalf("reseed failed: %v", err)
	}

	// Verify attendance
	countersKey := fmt.Sprintf("counters:%s", eventID)
	attendance, _ := rdb.HGet(ctx, countersKey, "attendance").Result()
	if attendance != "300" {
		t.Errorf("expected attendance '300', got %q", attendance)
	}

	// Verify checked-in set
	checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
	setCard, _ := rdb.SCard(ctx, checkedInKey).Result()
	if setCard != 300 {
		t.Errorf("expected SCARD 300, got %d", setCard)
	}

	// Verify SISMEMBER for every guest
	for i := 0; i < 300; i++ {
		guestID := fmt.Sprintf("restart_guest_%04d", i)
		isMember, _ := rdb.SIsMember(ctx, checkedInKey, guestID).Result()
		if !isMember {
			t.Errorf("guest %s should be in checked-in set", guestID)
			break // Don't spam 300 failures
		}
	}

	// Verify per-category counters
	for cat, expected := range categories {
		val, _ := rdb.HGet(ctx, countersKey, cat+":checkedin").Result()
		if val != fmt.Sprintf("%d", expected) {
			t.Errorf("expected %s:checkedin '%d', got %q", cat, expected, val)
		}
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", eventID)
}

// TestReseedAtomicity verifies that during re-seed, readers see either old
// state or new state, never partial state.
func TestReseedAtomicity(t *testing.T) {
	store := setupTestPG(t)
	ctx := context.Background()
	eventID := "reseed_atomicity_test_001"

	// Insert 100 scans into PG
	for i := 0; i < 100; i++ {
		_, err := store.InsertEntryScan(ctx, InsertParams{
			EventID:       eventID,
			GuestID:       fmt.Sprintf("atom_guest_%04d", i),
			StallID:       "stall_atom",
			DeviceID:      "device_atom",
			ScannedAt:     time.Now().UTC(),
			GuestCategory: "regular",
			Status:        "valid",
		})
		if err != nil {
			t.Fatalf("insert failed: %v", err)
		}
	}

	// Set up Redis with stale counters (attendance=50)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	countersKey := fmt.Sprintf("counters:%s", eventID)
	rdb.HSet(ctx, countersKey, "attendance", 50)

	// Re-seed in goroutine while reading concurrently
	reseedSvc := NewReseedService(rdb, store)

	var wg sync.WaitGroup
	readings := make([]string, 0, 200)
	var mu sync.Mutex
	done := make(chan struct{})

	// Reader goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-done:
				return
			default:
				val, err := rdb.HGet(ctx, countersKey, "attendance").Result()
				if err == nil {
					mu.Lock()
					readings = append(readings, val)
					mu.Unlock()
				}
			}
		}
	}()

	// Re-seed
	if err := reseedSvc.ReseedEventCounters(ctx, eventID); err != nil {
		t.Fatalf("reseed failed: %v", err)
	}
	close(done)
	wg.Wait()

	// Every reading should be either "50" (old) or "100" (new)
	for i, val := range readings {
		if val != "50" && val != "100" {
			t.Errorf("reading %d: expected '50' or '100', got %q", i, val)
		}
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", eventID)
}

// TestDuplicateDetectionAfterReseed verifies that scanning a previously
// checked-in guest after Redis re-seed correctly returns "duplicate".
func TestDuplicateDetectionAfterReseed(t *testing.T) {
	store := setupTestPG(t)
	ctx := context.Background()
	eventID := "reseed_dup_test_001"
	guestID := "reseed_dup_guest_001"

	// Insert existing check-in into PG
	scannedAt := time.Now().UTC().Add(-1 * time.Hour)
	_, err := store.InsertEntryScan(ctx, InsertParams{
		EventID:       eventID,
		GuestID:       guestID,
		StallID:       "stall_original",
		DeviceID:      "device_original",
		ScannedAt:     scannedAt,
		GuestCategory: "vip",
		Status:        "valid",
	})
	if err != nil {
		t.Fatalf("insert failed: %v", err)
	}

	// Create fresh Redis and re-seed
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	reseedSvc := NewReseedService(rdb, store)
	if err := reseedSvc.ReseedEventCounters(ctx, eventID); err != nil {
		t.Fatalf("reseed failed: %v", err)
	}

	// Seed the guest data for the scan service
	seedTestGuest(t, rdb, eventID, guestID, "Reseed Dup Guest", "vip")

	// Try scanning the same guest — should detect as duplicate via re-seeded set
	svc := NewService(rdb, nil, testSecret)
	payload := makeValidPayload(t, eventID, guestID, qr.QRTypeEntry)
	result, err := svc.ProcessEntryScan(ctx, ScanRequest{
		QRPayload: payload,
		StallID:   "stall_new",
		DeviceID:  "device_new",
	})
	if err != nil {
		t.Fatalf("scan error: %v", err)
	}
	if result.Status != "duplicate" {
		t.Errorf("expected 'duplicate' after reseed, got %q", result.Status)
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", eventID)
}
