package scan

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestCheckFoodCountersExist_DetectsMissing(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	svc := &Service{redis: rdb, hmacSecret: []byte("test-secret")}
	ctx := context.Background()
	eventID := "evt_check1"

	// Initially, no counters exist
	exists, err := svc.CheckFoodCountersExist(ctx, eventID)
	if err != nil {
		t.Fatalf("CheckFoodCountersExist failed: %v", err)
	}
	if exists {
		t.Error("expected false when no counters exist")
	}

	// Mark as initialized
	err = svc.MarkFoodCountersInitialized(ctx, eventID)
	if err != nil {
		t.Fatalf("MarkFoodCountersInitialized failed: %v", err)
	}

	// Now should return true
	exists, err = svc.CheckFoodCountersExist(ctx, eventID)
	if err != nil {
		t.Fatalf("CheckFoodCountersExist after mark failed: %v", err)
	}
	if !exists {
		t.Error("expected true after MarkFoodCountersInitialized")
	}
}

func TestCheckFoodCountersExist_SeparateEvents(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	svc := &Service{redis: rdb, hmacSecret: []byte("test-secret")}
	ctx := context.Background()

	// Mark event1 only
	err := svc.MarkFoodCountersInitialized(ctx, "evt_a")
	if err != nil {
		t.Fatalf("MarkFoodCountersInitialized failed: %v", err)
	}

	// Event1 should exist
	exists, err := svc.CheckFoodCountersExist(ctx, "evt_a")
	if err != nil {
		t.Fatalf("CheckFoodCountersExist evt_a failed: %v", err)
	}
	if !exists {
		t.Error("expected true for evt_a")
	}

	// Event2 should not exist
	exists, err = svc.CheckFoodCountersExist(ctx, "evt_b")
	if err != nil {
		t.Fatalf("CheckFoodCountersExist evt_b failed: %v", err)
	}
	if exists {
		t.Error("expected false for evt_b")
	}
}

func TestReconcileFoodCounters_NilPgPool(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	svc := &Service{redis: rdb, pgPool: nil, hmacSecret: []byte("test-secret")}
	ctx := context.Background()

	err := svc.ReconcileFoodCounters(ctx, "evt_nil")
	if err == nil {
		t.Fatal("expected error when pgPool is nil")
	}
}
