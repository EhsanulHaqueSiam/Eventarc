package scan

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func setupSyncTestService(t *testing.T) (*Service, *miniredis.Miniredis, *redis.Client) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	svc := &Service{redis: rdb, hmacSecret: []byte("test-secret")}
	return svc, mr, rdb
}

func TestSyncFoodRules_WritesToRedis(t *testing.T) {
	svc, _, rdb := setupSyncTestService(t)
	ctx := context.Background()
	eventID := "evt_sync1"

	rules := []FoodRuleSync{
		{GuestCategoryID: "cat_vip", FoodCategoryID: "fcat_fuchka", Limit: 3},
		{GuestCategoryID: "cat_vip", FoodCategoryID: "fcat_coke", Limit: -1},
		{GuestCategoryID: "cat_general", FoodCategoryID: "fcat_fuchka", Limit: 1},
	}

	err := svc.SyncFoodRules(ctx, eventID, rules)
	if err != nil {
		t.Fatalf("SyncFoodRules failed: %v", err)
	}

	key := "foodrules:" + eventID

	// Verify all 3 rules written
	fields, err := rdb.HGetAll(ctx, key).Result()
	if err != nil {
		t.Fatalf("HGetAll failed: %v", err)
	}
	if len(fields) != 3 {
		t.Errorf("expected 3 fields, got %d", len(fields))
	}

	// Verify specific values
	val := fields["cat_vip:fcat_fuchka"]
	if val != "3" {
		t.Errorf("cat_vip:fcat_fuchka = %q, want %q", val, "3")
	}

	val = fields["cat_vip:fcat_coke"]
	if val != "-1" {
		t.Errorf("cat_vip:fcat_coke = %q, want %q", val, "-1")
	}

	val = fields["cat_general:fcat_fuchka"]
	if val != "1" {
		t.Errorf("cat_general:fcat_fuchka = %q, want %q", val, "1")
	}
}

func TestSyncFoodRules_ReplacesExisting(t *testing.T) {
	svc, _, rdb := setupSyncTestService(t)
	ctx := context.Background()
	eventID := "evt_sync2"

	// Pre-populate with old rules
	oldRules := []FoodRuleSync{
		{GuestCategoryID: "cat_old", FoodCategoryID: "fcat_old", Limit: 99},
		{GuestCategoryID: "cat_vip", FoodCategoryID: "fcat_fuchka", Limit: 5},
	}
	err := svc.SyncFoodRules(ctx, eventID, oldRules)
	if err != nil {
		t.Fatalf("SyncFoodRules (old) failed: %v", err)
	}

	// Sync new rules (should replace old)
	newRules := []FoodRuleSync{
		{GuestCategoryID: "cat_vip", FoodCategoryID: "fcat_fuchka", Limit: 2},
	}
	err = svc.SyncFoodRules(ctx, eventID, newRules)
	if err != nil {
		t.Fatalf("SyncFoodRules (new) failed: %v", err)
	}

	key := "foodrules:" + eventID
	fields, err := rdb.HGetAll(ctx, key).Result()
	if err != nil {
		t.Fatalf("HGetAll failed: %v", err)
	}

	// Only new rules should exist
	if len(fields) != 1 {
		t.Errorf("expected 1 field after replace, got %d: %v", len(fields), fields)
	}

	// Old rule should be gone
	if _, ok := fields["cat_old:fcat_old"]; ok {
		t.Error("old rule cat_old:fcat_old should not exist after replace")
	}

	// New rule should have updated value
	val := fields["cat_vip:fcat_fuchka"]
	if val != "2" {
		t.Errorf("cat_vip:fcat_fuchka = %q, want %q", val, "2")
	}
}

func TestSyncFoodRules_EmptyRules(t *testing.T) {
	svc, mr, _ := setupSyncTestService(t)
	ctx := context.Background()
	eventID := "evt_sync3"

	// Pre-populate
	_ = svc.SyncFoodRules(ctx, eventID, []FoodRuleSync{
		{GuestCategoryID: "cat_a", FoodCategoryID: "fcat_b", Limit: 1},
	})

	// Sync empty rules
	err := svc.SyncFoodRules(ctx, eventID, []FoodRuleSync{})
	if err != nil {
		t.Fatalf("SyncFoodRules (empty) failed: %v", err)
	}

	key := "foodrules:" + eventID
	exists := mr.Exists(key)
	if exists {
		t.Error("key should not exist after syncing empty rules")
	}
}

func TestSyncAnonymousTokens_WritesToRedis(t *testing.T) {
	svc, _, rdb := setupSyncTestService(t)
	ctx := context.Background()
	eventID := "evt_sync4"

	tokens := []AnonTokenSync{
		{TokenID: "tok_abc", GuestCategoryID: "cat_vip"},
		{TokenID: "tok_def", GuestCategoryID: "cat_general"},
	}

	err := svc.SyncAnonymousTokens(ctx, eventID, tokens)
	if err != nil {
		t.Fatalf("SyncAnonymousTokens failed: %v", err)
	}

	// Verify token 1
	key1 := "anontoken:" + eventID + ":tok_abc"
	cat1, err := rdb.HGet(ctx, key1, "category").Result()
	if err != nil {
		t.Fatalf("HGet token1 failed: %v", err)
	}
	if cat1 != "cat_vip" {
		t.Errorf("token1 category = %q, want %q", cat1, "cat_vip")
	}

	// Verify token 2
	key2 := "anontoken:" + eventID + ":tok_def"
	cat2, err := rdb.HGet(ctx, key2, "category").Result()
	if err != nil {
		t.Fatalf("HGet token2 failed: %v", err)
	}
	if cat2 != "cat_general" {
		t.Errorf("token2 category = %q, want %q", cat2, "cat_general")
	}
}

func TestSyncAnonymousTokens_Empty(t *testing.T) {
	svc, _, _ := setupSyncTestService(t)
	ctx := context.Background()

	// Should not error on empty tokens
	err := svc.SyncAnonymousTokens(ctx, "evt_sync5", []AnonTokenSync{})
	if err != nil {
		t.Fatalf("SyncAnonymousTokens (empty) failed: %v", err)
	}
}
