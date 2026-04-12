//go:build integration

package scan

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestReseedEventCounters(t *testing.T) {
	store := setupTestPG(t)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	eventID := "reseed_test_001"

	// Insert 100 scans across 3 categories into PG
	categories := map[string]int{"vip": 30, "regular": 50, "staff": 20}
	guestNum := 0
	for cat, count := range categories {
		for i := 0; i < count; i++ {
			guestID := fmt.Sprintf("reseed_guest_%04d", guestNum)
			guestNum++
			_, err := store.InsertEntryScan(ctx, InsertParams{
				EventID:       eventID,
				GuestID:       guestID,
				StallID:       "stall_reseed",
				DeviceID:      "device_reseed",
				ScannedAt:     time.Now().UTC(),
				GuestCategory: cat,
				Status:        "valid",
			})
			if err != nil {
				t.Fatalf("insert failed: %v", err)
			}
		}
	}

	// Re-seed Redis from PG
	reseedSvc := NewReseedService(rdb, store)
	if err := reseedSvc.ReseedEventCounters(ctx, eventID); err != nil {
		t.Fatalf("reseed failed: %v", err)
	}

	// Verify attendance counter
	countersKey := fmt.Sprintf("counters:%s", eventID)
	attendance, err := rdb.HGet(ctx, countersKey, "attendance").Result()
	if err != nil {
		t.Fatalf("HGET attendance error: %v", err)
	}
	if attendance != "100" {
		t.Errorf("expected attendance '100', got %q", attendance)
	}

	// Verify per-category counters
	for cat, expected := range categories {
		val, err := rdb.HGet(ctx, countersKey, cat+":checkedin").Result()
		if err != nil {
			t.Fatalf("HGET %s:checkedin error: %v", cat, err)
		}
		if val != fmt.Sprintf("%d", expected) {
			t.Errorf("expected %s:checkedin '%d', got %q", cat, expected, val)
		}
	}

	// Verify checked-in set
	checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
	setCard, err := rdb.SCard(ctx, checkedInKey).Result()
	if err != nil {
		t.Fatalf("SCARD error: %v", err)
	}
	if setCard != 100 {
		t.Errorf("expected SCARD 100, got %d", setCard)
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", eventID)
}

func TestReseedCheckedInSet(t *testing.T) {
	store := setupTestPG(t)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	eventID := "reseed_set_test_001"

	guestIDs := []string{"g_set_001", "g_set_002", "g_set_003", "g_set_004", "g_set_005"}
	for _, gid := range guestIDs {
		_, err := store.InsertEntryScan(ctx, InsertParams{
			EventID:       eventID,
			GuestID:       gid,
			StallID:       "stall_set",
			DeviceID:      "device_set",
			ScannedAt:     time.Now().UTC(),
			GuestCategory: "regular",
			Status:        "valid",
		})
		if err != nil {
			t.Fatalf("insert failed: %v", err)
		}
	}

	// Re-seed the set
	reseedSvc := NewReseedService(rdb, store)
	if err := reseedSvc.ReseedCheckedInSet(ctx, eventID); err != nil {
		t.Fatalf("reseed set failed: %v", err)
	}

	// Verify each guest is in the set
	checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
	for _, gid := range guestIDs {
		isMember, err := rdb.SIsMember(ctx, checkedInKey, gid).Result()
		if err != nil {
			t.Fatalf("SISMEMBER error: %v", err)
		}
		if !isMember {
			t.Errorf("guest %s should be in checked-in set", gid)
		}
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", eventID)
}

func TestCheckAndReseed_CountersMissing(t *testing.T) {
	store := setupTestPG(t)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	eventID := "reseed_check_test_001"

	// Insert some scans into PG
	for i := 0; i < 5; i++ {
		_, err := store.InsertEntryScan(ctx, InsertParams{
			EventID:       eventID,
			GuestID:       fmt.Sprintf("g_check_%03d", i),
			StallID:       "stall_check",
			DeviceID:      "device_check",
			ScannedAt:     time.Now().UTC(),
			GuestCategory: "vip",
			Status:        "valid",
		})
		if err != nil {
			t.Fatalf("insert failed: %v", err)
		}
	}

	// Redis is empty — should trigger re-seed
	reseedSvc := NewReseedService(rdb, store)
	reseeded, err := reseedSvc.CheckAndReseed(ctx, eventID)
	if err != nil {
		t.Fatalf("check and reseed failed: %v", err)
	}
	if !reseeded {
		t.Error("expected re-seed to be triggered")
	}

	// Verify counters exist now
	countersKey := fmt.Sprintf("counters:%s", eventID)
	attendance, _ := rdb.HGet(ctx, countersKey, "attendance").Result()
	if attendance != "5" {
		t.Errorf("expected attendance '5', got %q", attendance)
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", eventID)
}

func TestCheckAndReseed_CountersExist(t *testing.T) {
	store := setupTestPG(t)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	eventID := "reseed_existing_test_001"

	// Pre-populate Redis counters
	countersKey := fmt.Sprintf("counters:%s", eventID)
	checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
	rdb.HSet(ctx, countersKey, "attendance", 10)
	rdb.SAdd(ctx, checkedInKey, "dummy_guest")

	// Should NOT trigger re-seed since counters exist
	reseedSvc := NewReseedService(rdb, store)
	reseeded, err := reseedSvc.CheckAndReseed(ctx, eventID)
	if err != nil {
		t.Fatalf("check and reseed failed: %v", err)
	}
	if reseeded {
		t.Error("expected no re-seed since counters already exist")
	}
}

func TestCounterReconciliation(t *testing.T) {
	store := setupTestPG(t)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	eventID := "reconcile_test_001"

	// Insert scans directly into PG
	for i := 0; i < 25; i++ {
		_, err := store.InsertEntryScan(ctx, InsertParams{
			EventID:       eventID,
			GuestID:       fmt.Sprintf("g_rec_%03d", i),
			StallID:       "stall_rec",
			DeviceID:      "device_rec",
			ScannedAt:     time.Now().UTC(),
			GuestCategory: "regular",
			Status:        "valid",
		})
		if err != nil {
			t.Fatalf("insert failed: %v", err)
		}
	}

	// Re-seed from PG
	reseedSvc := NewReseedService(rdb, store)
	if err := reseedSvc.ReseedEventCounters(ctx, eventID); err != nil {
		t.Fatalf("reseed failed: %v", err)
	}

	// Verify Redis matches PG
	pgCount, _ := store.CountByEvent(ctx, eventID)
	countersKey := fmt.Sprintf("counters:%s", eventID)
	redisAttendance, _ := rdb.HGet(ctx, countersKey, "attendance").Result()

	if redisAttendance != fmt.Sprintf("%d", pgCount) {
		t.Errorf("counter mismatch: Redis=%s, PG=%d", redisAttendance, pgCount)
	}

	checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
	setCard, _ := rdb.SCard(ctx, checkedInKey).Result()
	if setCard != pgCount {
		t.Errorf("set mismatch: Redis SCARD=%d, PG count=%d", setCard, pgCount)
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", eventID)
}
