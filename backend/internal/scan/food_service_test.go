package scan

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// seedFoodRules populates the food rules hash for an event.
func seedFoodRules(t *testing.T, rdb *redis.Client, eventID string, rules map[string]int) {
	t.Helper()
	ctx := context.Background()
	key := "foodrules:" + eventID
	for ruleKey, limit := range rules {
		err := rdb.HSet(ctx, key, ruleKey, limit).Err()
		if err != nil {
			t.Fatalf("failed to seed food rule: %v", err)
		}
	}
}

// seedEventConfig populates the event config hash with foodQrMode.
func seedEventConfig(t *testing.T, rdb *redis.Client, eventID, foodQrMode string) {
	t.Helper()
	ctx := context.Background()
	key := "event:" + eventID
	err := rdb.HSet(ctx, key, "foodQrMode", foodQrMode).Err()
	if err != nil {
		t.Fatalf("failed to seed event config: %v", err)
	}
}

// seedAnonToken populates anonymous token metadata.
func seedAnonToken(t *testing.T, rdb *redis.Client, eventID, tokenID, category string) {
	t.Helper()
	ctx := context.Background()
	key := "anontoken:" + eventID + ":" + tokenID
	err := rdb.HSet(ctx, key, "category", category).Err()
	if err != nil {
		t.Fatalf("failed to seed anon token: %v", err)
	}
}

// --- Lua Script Direct Tests ---

func TestFoodScanLua_AllowsWithinLimit(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	eventID := "evt_food_lua_01"
	guestID := "guest_lua_food_01"

	// Setup: food rule cat_vip:fcat_fuchka = 3
	rdb.HSet(ctx, "foodrules:"+eventID, "cat_vip:fcat_fuchka", 3)

	consumptionKey := "food:" + eventID + ":" + guestID
	rulesKey := "foodrules:" + eventID
	countersKey := "counters:" + eventID
	logKey := "foodlog:" + eventID + ":" + guestID

	result, err := foodScanScript.Run(ctx, rdb,
		[]string{consumptionKey, rulesKey, countersKey, logKey},
		"cat_vip", "fcat_fuchka", "stall_01", "2026-04-12T18:00:00Z", "dev_01", "Fuchka Stall 1",
	).StringSlice()
	if err != nil {
		t.Fatalf("lua script error: %v", err)
	}

	if result[0] != "OK" {
		t.Errorf("expected 'OK', got %q", result[0])
	}
	if result[1] != "1" {
		t.Errorf("expected count '1', got %q", result[1])
	}
	if result[2] != "3" {
		t.Errorf("expected limit '3', got %q", result[2])
	}

	// Verify consumption hash
	count, _ := rdb.HGet(ctx, consumptionKey, "fcat_fuchka").Result()
	if count != "1" {
		t.Errorf("expected consumption hash value '1', got %q", count)
	}

	// Verify dashboard counter
	served, _ := rdb.HGet(ctx, countersKey, "food:fcat_fuchka:served").Result()
	if served != "1" {
		t.Errorf("expected food counter '1', got %q", served)
	}

	stallServed, _ := rdb.HGet(ctx, countersKey, "food:stall_01:served").Result()
	if stallServed != "1" {
		t.Errorf("expected stall counter '1', got %q", stallServed)
	}

	// Verify log entry
	logEntries, _ := rdb.LRange(ctx, logKey, 0, -1).Result()
	if len(logEntries) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logEntries))
	}
	if logEntries[0] != "2026-04-12T18:00:00Z|stall_01|Fuchka Stall 1" {
		t.Errorf("unexpected log entry: %q", logEntries[0])
	}
}

func TestFoodScanLua_RejectsAtLimit(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	eventID := "evt_food_lua_02"
	guestID := "guest_lua_food_02"

	// Setup: rule = 1, already consumed 1
	rdb.HSet(ctx, "foodrules:"+eventID, "cat_vip:fcat_fuchka", 1)
	rdb.HSet(ctx, "food:"+eventID+":"+guestID, "fcat_fuchka", 1)

	consumptionKey := "food:" + eventID + ":" + guestID
	rulesKey := "foodrules:" + eventID
	countersKey := "counters:" + eventID
	logKey := "foodlog:" + eventID + ":" + guestID

	result, err := foodScanScript.Run(ctx, rdb,
		[]string{consumptionKey, rulesKey, countersKey, logKey},
		"cat_vip", "fcat_fuchka", "stall_02", "2026-04-12T18:01:00Z", "dev_02", "Fuchka Stall 2",
	).StringSlice()
	if err != nil {
		t.Fatalf("lua script error: %v", err)
	}

	if result[0] != "LIMIT_REACHED" {
		t.Errorf("expected 'LIMIT_REACHED', got %q", result[0])
	}
	if result[1] != "1" {
		t.Errorf("expected count '1', got %q", result[1])
	}
	if result[2] != "1" {
		t.Errorf("expected limit '1', got %q", result[2])
	}

	// Verify consumption hash unchanged
	count, _ := rdb.HGet(ctx, consumptionKey, "fcat_fuchka").Result()
	if count != "1" {
		t.Errorf("expected consumption still '1', got %q", count)
	}

	// Verify counter NOT incremented (should be "0" or not set)
	served, err := rdb.HGet(ctx, countersKey, "food:fcat_fuchka:served").Result()
	if err == nil && served != "0" {
		t.Errorf("counter should not have incremented, got %q", served)
	}
}

func TestFoodScanLua_RejectsNoRule(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	eventID := "evt_food_lua_03"
	guestID := "guest_lua_food_03"

	// No rules set at all
	consumptionKey := "food:" + eventID + ":" + guestID
	rulesKey := "foodrules:" + eventID
	countersKey := "counters:" + eventID
	logKey := "foodlog:" + eventID + ":" + guestID

	result, err := foodScanScript.Run(ctx, rdb,
		[]string{consumptionKey, rulesKey, countersKey, logKey},
		"cat_vip", "fcat_fuchka", "stall_03", "2026-04-12T18:02:00Z", "dev_03", "Fuchka Stall 3",
	).StringSlice()
	if err != nil {
		t.Fatalf("lua script error: %v", err)
	}

	if result[0] != "NO_RULE" {
		t.Errorf("expected 'NO_RULE', got %q", result[0])
	}
	if result[1] != "0" {
		t.Errorf("expected count '0', got %q", result[1])
	}
	if result[2] != "0" {
		t.Errorf("expected limit '0', got %q", result[2])
	}
}

func TestFoodScanLua_UnlimitedAllowsAlways(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	eventID := "evt_food_lua_04"
	guestID := "guest_lua_food_04"

	// Setup: unlimited (-1) rule, already consumed 99
	rdb.HSet(ctx, "foodrules:"+eventID, "cat_vip:fcat_water", -1)
	rdb.HSet(ctx, "food:"+eventID+":"+guestID, "fcat_water", 99)

	consumptionKey := "food:" + eventID + ":" + guestID
	rulesKey := "foodrules:" + eventID
	countersKey := "counters:" + eventID
	logKey := "foodlog:" + eventID + ":" + guestID

	result, err := foodScanScript.Run(ctx, rdb,
		[]string{consumptionKey, rulesKey, countersKey, logKey},
		"cat_vip", "fcat_water", "stall_04", "2026-04-12T18:03:00Z", "dev_04", "Water Station",
	).StringSlice()
	if err != nil {
		t.Fatalf("lua script error: %v", err)
	}

	if result[0] != "OK" {
		t.Errorf("expected 'OK', got %q", result[0])
	}
	if result[1] != "100" {
		t.Errorf("expected count '100', got %q", result[1])
	}
	if result[2] != "-1" {
		t.Errorf("expected limit '-1', got %q", result[2])
	}

	// Verify consumption incremented
	count, _ := rdb.HGet(ctx, consumptionKey, "fcat_water").Result()
	if count != "100" {
		t.Errorf("expected consumption '100', got %q", count)
	}
}

func TestFoodScanLua_ConcurrentSameGuestSameCategory(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	eventID := "evt_food_lua_05"
	guestID := "guest_lua_food_05"

	// Setup: limit = 1
	rdb.HSet(ctx, "foodrules:"+eventID, "cat_general:fcat_fuchka", 1)

	consumptionKey := "food:" + eventID + ":" + guestID
	rulesKey := "foodrules:" + eventID
	countersKey := "counters:" + eventID
	logKey := "foodlog:" + eventID + ":" + guestID

	const goroutines = 100
	var okCount atomic.Int32
	var limitCount atomic.Int32

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			result, err := foodScanScript.Run(ctx, rdb,
				[]string{consumptionKey, rulesKey, countersKey, logKey},
				"cat_general", "fcat_fuchka",
				fmt.Sprintf("stall_%d", idx),
				fmt.Sprintf("2026-04-12T18:04:%02dZ", idx%60),
				fmt.Sprintf("dev_%d", idx),
				fmt.Sprintf("Stall %d", idx),
			).StringSlice()
			if err != nil {
				t.Errorf("goroutine %d: lua error: %v", idx, err)
				return
			}
			switch result[0] {
			case "OK":
				okCount.Add(1)
			case "LIMIT_REACHED":
				limitCount.Add(1)
			default:
				t.Errorf("goroutine %d: unexpected result %q", idx, result[0])
			}
		}(i)
	}

	wg.Wait()

	if okCount.Load() != 1 {
		t.Errorf("expected exactly 1 OK, got %d", okCount.Load())
	}
	if limitCount.Load() != int32(goroutines-1) {
		t.Errorf("expected %d LIMIT_REACHED, got %d", goroutines-1, limitCount.Load())
	}

	// Verify final consumption count is exactly 1
	count, _ := rdb.HGet(ctx, consumptionKey, "fcat_fuchka").Result()
	if count != "1" {
		t.Errorf("expected final consumption '1', got %q", count)
	}
}

// --- Service-Level Tests ---

func TestProcessFoodScan_GuestLinkedMode(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	guestID := "guest_food_gl_01"
	seedEventConfig(t, svc.redis, testEventID, "guestLinked")
	seedTestGuest(t, svc.redis, testEventID, guestID, "Alice Food", "cat_vip")
	// Also set categoryLabel for the guest
	svc.redis.HSet(ctx, "guest:"+testEventID+":"+guestID, "categoryLabel", "VIP")
	seedFoodRules(t, svc.redis, testEventID, map[string]int{
		"cat_vip:fcat_fuchka": 3,
	})

	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeFood)
	result, err := svc.ProcessFoodScan(ctx, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_food_01",
		DeviceID:       "dev_food_01",
		FoodCategoryID: "fcat_fuchka",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "valid" {
		t.Errorf("expected status 'valid', got %q", result.Status)
	}
	if result.Consumption == nil {
		t.Fatal("expected consumption info")
	}
	if result.Consumption.Current != 1 {
		t.Errorf("expected current 1, got %d", result.Consumption.Current)
	}
	if result.Consumption.Limit != 3 {
		t.Errorf("expected limit 3, got %d", result.Consumption.Limit)
	}
	if result.Consumption.Remaining != 2 {
		t.Errorf("expected remaining 2, got %d", result.Consumption.Remaining)
	}
	if result.Guest == nil {
		t.Fatal("expected guest info in guest-linked mode")
	}
	if result.Guest.Name != "Alice Food" {
		t.Errorf("expected guest name 'Alice Food', got %q", result.Guest.Name)
	}
}

func TestProcessFoodScan_AnonymousMode(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	tokenID := "token_anon_01"
	seedEventConfig(t, svc.redis, testEventID, "anonymous")
	seedAnonToken(t, svc.redis, testEventID, tokenID, "cat_general")
	seedFoodRules(t, svc.redis, testEventID, map[string]int{
		"cat_general:fcat_biryani": 2,
	})

	payload := makeValidPayload(t, testEventID, tokenID, qr.QRTypeFood)
	result, err := svc.ProcessFoodScan(ctx, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_food_02",
		DeviceID:       "dev_food_02",
		FoodCategoryID: "fcat_biryani",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "valid" {
		t.Errorf("expected status 'valid', got %q", result.Status)
	}
	if result.Consumption == nil {
		t.Fatal("expected consumption info")
	}
	if result.Consumption.Current != 1 {
		t.Errorf("expected current 1, got %d", result.Consumption.Current)
	}

	// Verify tracked under anonymous key
	anonKey := "food:" + testEventID + ":anon:" + tokenID
	count, err := svc.redis.HGet(ctx, anonKey, "fcat_biryani").Result()
	if err != nil {
		t.Fatalf("failed to read anon consumption: %v", err)
	}
	if count != "1" {
		t.Errorf("expected anon consumption '1', got %q", count)
	}
}

func TestProcessFoodScan_InvalidQRType(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	guestID := "guest_food_wrongqr"
	seedEventConfig(t, svc.redis, testEventID, "guestLinked")
	seedTestGuest(t, svc.redis, testEventID, guestID, "Wrong QR Guest", "cat_vip")

	// Entry QR at food stall
	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeEntry)
	_, err := svc.ProcessFoodScan(ctx, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_food_03",
		DeviceID:       "dev_food_03",
		FoodCategoryID: "fcat_fuchka",
	})
	if !errors.Is(err, qr.ErrInvalidQRType) {
		t.Errorf("expected ErrInvalidQRType, got: %v", err)
	}
}

func TestProcessFoodScan_LimitReachedWithHistory(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	guestID := "guest_food_limit"
	seedEventConfig(t, svc.redis, testEventID, "guestLinked")
	seedTestGuest(t, svc.redis, testEventID, guestID, "Limit Guest", "cat_general")
	svc.redis.HSet(ctx, "guest:"+testEventID+":"+guestID, "categoryLabel", "General")
	seedFoodRules(t, svc.redis, testEventID, map[string]int{
		"cat_general:fcat_fuchka": 1,
	})

	// Pre-populate consumption and log
	consumptionKey := "food:" + testEventID + ":" + guestID
	svc.redis.HSet(ctx, consumptionKey, "fcat_fuchka", 1)
	logKey := "foodlog:" + testEventID + ":" + guestID
	svc.redis.LPush(ctx, logKey, "2026-04-12T14:30:00Z|stall_prev|Fuchka Stall 2")

	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeFood)
	result, err := svc.ProcessFoodScan(ctx, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_food_04",
		DeviceID:       "dev_food_04",
		FoodCategoryID: "fcat_fuchka",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "limit_reached" {
		t.Errorf("expected status 'limit_reached', got %q", result.Status)
	}
	if result.Consumption == nil {
		t.Fatal("expected consumption info")
	}
	if result.Consumption.Remaining != 0 {
		t.Errorf("expected remaining 0, got %d", result.Consumption.Remaining)
	}
	if len(result.History) == 0 {
		t.Error("expected history entries in rejection response")
	}
	if result.History[0].StallName != "Fuchka Stall 2" {
		t.Errorf("expected stall name 'Fuchka Stall 2', got %q", result.History[0].StallName)
	}
	if result.History[0].ConsumedAt != "2026-04-12T14:30:00Z" {
		t.Errorf("expected consumed_at '2026-04-12T14:30:00Z', got %q", result.History[0].ConsumedAt)
	}
}

func TestProcessFoodScan_PerCategoryEnforcement(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	vipGuestID := "guest_food_vip"
	generalGuestID := "guest_food_general"
	seedEventConfig(t, svc.redis, testEventID, "guestLinked")
	seedTestGuest(t, svc.redis, testEventID, vipGuestID, "VIP Guest", "cat_vip")
	svc.redis.HSet(ctx, "guest:"+testEventID+":"+vipGuestID, "categoryLabel", "VIP")
	seedTestGuest(t, svc.redis, testEventID, generalGuestID, "General Guest", "cat_general")
	svc.redis.HSet(ctx, "guest:"+testEventID+":"+generalGuestID, "categoryLabel", "General")

	seedFoodRules(t, svc.redis, testEventID, map[string]int{
		"cat_vip:fcat_fuchka":     3, // VIP gets 3
		"cat_general:fcat_fuchka": 1, // General gets 1
	})

	vipPayload := makeValidPayload(t, testEventID, vipGuestID, qr.QRTypeFood)
	generalPayload := makeValidPayload(t, testEventID, generalGuestID, qr.QRTypeFood)

	makeFoodReq := func(payload, stallID string) FoodScanRequest {
		return FoodScanRequest{
			QRPayload:      payload,
			StallID:        stallID,
			DeviceID:       "dev_cat_test",
			FoodCategoryID: "fcat_fuchka",
		}
	}

	// VIP first scan — allowed (1/3)
	r1, err := svc.ProcessFoodScan(ctx, makeFoodReq(vipPayload, "stall_v1"))
	if err != nil {
		t.Fatalf("VIP scan 1 error: %v", err)
	}
	if r1.Status != "valid" || r1.Consumption.Current != 1 || r1.Consumption.Limit != 3 {
		t.Errorf("VIP scan 1: expected valid 1/3, got %s %d/%d", r1.Status, r1.Consumption.Current, r1.Consumption.Limit)
	}

	// General first scan — allowed (1/1)
	r2, err := svc.ProcessFoodScan(ctx, makeFoodReq(generalPayload, "stall_g1"))
	if err != nil {
		t.Fatalf("General scan 1 error: %v", err)
	}
	if r2.Status != "valid" || r2.Consumption.Current != 1 || r2.Consumption.Limit != 1 {
		t.Errorf("General scan 1: expected valid 1/1, got %s %d/%d", r2.Status, r2.Consumption.Current, r2.Consumption.Limit)
	}

	// General second scan — rejected (limit_reached)
	r3, err := svc.ProcessFoodScan(ctx, makeFoodReq(generalPayload, "stall_g2"))
	if err != nil {
		t.Fatalf("General scan 2 error: %v", err)
	}
	if r3.Status != "limit_reached" {
		t.Errorf("General scan 2: expected 'limit_reached', got %q", r3.Status)
	}

	// VIP second scan — still allowed (2/3)
	r4, err := svc.ProcessFoodScan(ctx, makeFoodReq(vipPayload, "stall_v2"))
	if err != nil {
		t.Fatalf("VIP scan 2 error: %v", err)
	}
	if r4.Status != "valid" || r4.Consumption.Current != 2 || r4.Consumption.Remaining != 1 {
		t.Errorf("VIP scan 2: expected valid 2/3 remaining 1, got %s %d/%d remaining %d",
			r4.Status, r4.Consumption.Current, r4.Consumption.Limit, r4.Consumption.Remaining)
	}
}

// --- Edge case: stall name formatting for food category ---

func TestFoodScanLua_MultipleCategories(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	eventID := "evt_food_lua_06"
	guestID := "guest_lua_food_06"

	// Setup: different limits for different food categories
	rdb.HSet(ctx, "foodrules:"+eventID, "cat_vip:fcat_fuchka", 3)
	rdb.HSet(ctx, "foodrules:"+eventID, "cat_vip:fcat_biryani", 1)
	rdb.HSet(ctx, "foodrules:"+eventID, "cat_vip:fcat_water", -1)

	consumptionKey := "food:" + eventID + ":" + guestID
	rulesKey := "foodrules:" + eventID
	countersKey := "counters:" + eventID
	logKey := "foodlog:" + eventID + ":" + guestID

	// Consume fuchka twice
	for i := 0; i < 2; i++ {
		result, err := foodScanScript.Run(ctx, rdb,
			[]string{consumptionKey, rulesKey, countersKey, logKey},
			"cat_vip", "fcat_fuchka", "stall_01",
			fmt.Sprintf("2026-04-12T18:%02d:00Z", i),
			"dev_01", "Stall 1",
		).StringSlice()
		if err != nil {
			t.Fatalf("fuchka scan %d error: %v", i, err)
		}
		if result[0] != "OK" {
			t.Errorf("fuchka scan %d: expected OK, got %q", i, result[0])
		}
	}

	// Consume biryani once (limit 1)
	result, err := foodScanScript.Run(ctx, rdb,
		[]string{consumptionKey, rulesKey, countersKey, logKey},
		"cat_vip", "fcat_biryani", "stall_02", "2026-04-12T18:10:00Z", "dev_02", "Stall 2",
	).StringSlice()
	if err != nil {
		t.Fatalf("biryani scan error: %v", err)
	}
	if result[0] != "OK" {
		t.Errorf("biryani scan: expected OK, got %q", result[0])
	}

	// Biryani second scan — should be rejected
	result2, err := foodScanScript.Run(ctx, rdb,
		[]string{consumptionKey, rulesKey, countersKey, logKey},
		"cat_vip", "fcat_biryani", "stall_03", "2026-04-12T18:11:00Z", "dev_03", "Stall 3",
	).StringSlice()
	if err != nil {
		t.Fatalf("biryani scan 2 error: %v", err)
	}
	if result2[0] != "LIMIT_REACHED" {
		t.Errorf("biryani scan 2: expected LIMIT_REACHED, got %q", result2[0])
	}

	// Fuchka third scan — still allowed (2/3 -> 3/3)
	result3, err := foodScanScript.Run(ctx, rdb,
		[]string{consumptionKey, rulesKey, countersKey, logKey},
		"cat_vip", "fcat_fuchka", "stall_01", "2026-04-12T18:12:00Z", "dev_01", "Stall 1",
	).StringSlice()
	if err != nil {
		t.Fatalf("fuchka scan 3 error: %v", err)
	}
	if result3[0] != "OK" {
		t.Errorf("fuchka scan 3: expected OK, got %q", result3[0])
	}

	// Verify per-category counts
	fuchkaCount, _ := rdb.HGet(ctx, consumptionKey, "fcat_fuchka").Result()
	biryaniCount, _ := rdb.HGet(ctx, consumptionKey, "fcat_biryani").Result()
	if fuchkaCount != "3" {
		t.Errorf("expected fuchka count '3', got %q", fuchkaCount)
	}
	if biryaniCount != "1" {
		t.Errorf("expected biryani count '1', got %q", biryaniCount)
	}

	// Verify dashboard counters are per-category
	fuchkaServed, _ := rdb.HGet(ctx, countersKey, "food:fcat_fuchka:served").Result()
	biryaniServed, _ := rdb.HGet(ctx, countersKey, "food:fcat_biryani:served").Result()
	fuchkaServedInt, _ := strconv.Atoi(fuchkaServed)
	biryaniServedInt, _ := strconv.Atoi(biryaniServed)
	if fuchkaServedInt != 3 {
		t.Errorf("expected fuchka served 3, got %d", fuchkaServedInt)
	}
	if biryaniServedInt != 1 {
		t.Errorf("expected biryani served 1, got %d", biryaniServedInt)
	}
}
