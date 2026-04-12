//go:build integration

package hardening

import (
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
	"github.com/ehsanul-haque-siam/eventarc/internal/scan"
)

// TestConfigMatrix_EntryScans tests entry scan processing for all 6 configurations.
// For each config:
//  1. SetupTestInfra (PG + Redis containers)
//  2. SeedEvent with config, SeedGuests (50 guests: 10 VIP, 30 General, 10 Staff)
//  3. Process entry scans for all 50 guests via scan service
//  4. Verify: exactly 50 "valid" results, zero errors
//  5. Verify: Redis attendance counter == 50
//  6. Verify: Redis checkedin set SCARD == 50
//  7. Verify: Per-category counters (vip:10, general:30, staff:10)
func TestConfigMatrix_EntryScans(t *testing.T) {
	for _, cfg := range AllConfigs() {
		t.Run(cfg.Name, func(t *testing.T) {
			infra := SetupTestInfra(t)
			defer infra.Teardown(t)

			eventID := infra.SeedEvent(t, cfg)
			guests := infra.SeedGuests(t, eventID, cfg, 50)
			infra.SeedFoodRules(t, eventID)
			infra.SeedVendorHierarchy(t, eventID)
			infra.InitializeCounters(t, eventID)

			svc := scan.NewService(infra.Redis, infra.PG, testHMACSecret)

			validCount := 0
			for _, g := range guests {
				result, err := svc.ProcessEntryScan(infra.Ctx, scan.ScanRequest{
					QRPayload: g.EntryQR,
					StallID:   "stall_entry_01",
					DeviceID:  "device_test_01",
				})
				if err != nil {
					t.Fatalf("entry scan failed for guest %s: %v", g.ID, err)
				}
				if result.Status != "valid" {
					t.Errorf("expected status 'valid' for guest %s, got %q", g.ID, result.Status)
				} else {
					validCount++
				}
			}

			if validCount != 50 {
				t.Errorf("expected 50 valid scans, got %d", validCount)
			}

			// Verify Redis attendance counter
			countersKey := fmt.Sprintf("counters:%s", eventID)
			attendance, err := infra.Redis.HGet(infra.Ctx, countersKey, "attendance").Result()
			if err != nil {
				t.Fatalf("failed to get attendance counter: %v", err)
			}
			if attendance != "50" {
				t.Errorf("expected attendance counter '50', got %q", attendance)
			}

			// Verify Redis checkedin set cardinality
			checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
			setCard, err := infra.Redis.SCard(infra.Ctx, checkedInKey).Result()
			if err != nil {
				t.Fatalf("failed to get checkedin set cardinality: %v", err)
			}
			if setCard != 50 {
				t.Errorf("expected checkedin set cardinality 50, got %d", setCard)
			}

			// Verify per-category counters
			// With 50 guests: 10 VIP (first 1/5), 30 General (next 3/5), 10 Staff (last 1/5)
			vipCount, _ := infra.Redis.HGet(infra.Ctx, countersKey, "vip:checkedin").Result()
			generalCount, _ := infra.Redis.HGet(infra.Ctx, countersKey, "general:checkedin").Result()
			staffCount, _ := infra.Redis.HGet(infra.Ctx, countersKey, "staff:checkedin").Result()

			if vipCount != "10" {
				t.Errorf("expected vip:checkedin '10', got %q", vipCount)
			}
			if generalCount != "30" {
				t.Errorf("expected general:checkedin '30', got %q", generalCount)
			}
			if staffCount != "10" {
				t.Errorf("expected staff:checkedin '10', got %q", staffCount)
			}
		})
	}
}

// TestConfigMatrix_DuplicateEntryScans tests that duplicate entry scans are rejected
// for all 6 configurations.
func TestConfigMatrix_DuplicateEntryScans(t *testing.T) {
	for _, cfg := range AllConfigs() {
		t.Run(cfg.Name, func(t *testing.T) {
			infra := SetupTestInfra(t)
			defer infra.Teardown(t)

			eventID := infra.SeedEvent(t, cfg)
			guests := infra.SeedGuests(t, eventID, cfg, 10)
			infra.InitializeCounters(t, eventID)

			svc := scan.NewService(infra.Redis, infra.PG, testHMACSecret)

			// First pass: all should be valid
			for _, g := range guests {
				result, err := svc.ProcessEntryScan(infra.Ctx, scan.ScanRequest{
					QRPayload: g.EntryQR,
					StallID:   "stall_entry_01",
					DeviceID:  "device_test_01",
				})
				if err != nil {
					t.Fatalf("first scan failed for guest %s: %v", g.ID, err)
				}
				if result.Status != "valid" {
					t.Fatalf("first scan expected 'valid' for guest %s, got %q", g.ID, result.Status)
				}
			}

			// Second pass: all should be duplicate
			dupCount := 0
			for _, g := range guests {
				result, err := svc.ProcessEntryScan(infra.Ctx, scan.ScanRequest{
					QRPayload: g.EntryQR,
					StallID:   "stall_entry_02",
					DeviceID:  "device_test_02",
				})
				if err != nil {
					t.Fatalf("second scan failed for guest %s: %v", g.ID, err)
				}
				if result.Status != "duplicate" {
					t.Errorf("second scan expected 'duplicate' for guest %s, got %q", g.ID, result.Status)
				} else {
					dupCount++
				}
				if result.Original == nil {
					t.Errorf("duplicate response should include original scan info for guest %s", g.ID)
				}
			}

			if dupCount != 10 {
				t.Errorf("expected 10 duplicates, got %d", dupCount)
			}

			// Verify attendance counter did NOT double
			countersKey := fmt.Sprintf("counters:%s", eventID)
			attendance, err := infra.Redis.HGet(infra.Ctx, countersKey, "attendance").Result()
			if err != nil {
				t.Fatalf("failed to get attendance counter: %v", err)
			}
			if attendance != "10" {
				t.Errorf("expected attendance counter '10' (not 20), got %q", attendance)
			}
		})
	}
}

// TestConfigMatrix_FoodScans tests food scan processing with limit enforcement
// for all 6 configurations.
func TestConfigMatrix_FoodScans(t *testing.T) {
	for _, cfg := range AllConfigs() {
		t.Run(cfg.Name, func(t *testing.T) {
			infra := SetupTestInfra(t)
			defer infra.Teardown(t)

			eventID := infra.SeedEvent(t, cfg)
			// 30 guests: 6 VIP, 18 General, 6 Staff
			guests := infra.SeedGuests(t, eventID, cfg, 30)
			infra.SeedFoodRules(t, eventID)
			infra.SeedVendorHierarchy(t, eventID)
			infra.InitializeCounters(t, eventID)

			svc := scan.NewService(infra.Redis, infra.PG, testHMACSecret)

			// Entry scans first (prerequisite for food in most configs)
			for _, g := range guests {
				_, err := svc.ProcessEntryScan(infra.Ctx, scan.ScanRequest{
					QRPayload: g.EntryQR,
					StallID:   "stall_entry_01",
					DeviceID:  "device_test_01",
				})
				if err != nil {
					t.Fatalf("entry scan failed for guest %s: %v", g.ID, err)
				}
			}

			// First round of fuchka scans: all should succeed (limit: VIP=3, General=1, Staff=2)
			for _, g := range guests {
				foodPayload := g.FoodQR
				if foodPayload == "" {
					continue // post-entry QR not yet generated
				}

				result, err := svc.ProcessFoodScan(infra.Ctx, scan.FoodScanRequest{
					QRPayload:      foodPayload,
					StallID:        "stall_fuchka_01",
					DeviceID:       "device_test_01",
					FoodCategoryID: "fuchka",
				})
				if err != nil {
					t.Fatalf("first food scan failed for guest %s: %v", g.ID, err)
				}
				if result.Status != "valid" {
					t.Errorf("first food scan expected 'valid' for guest %s (%s), got %q",
						g.ID, g.CategoryID, result.Status)
				}
			}

			// Second round for General guests: should be REJECTED (limit: 1, used: 1)
			generalRejected := 0
			for _, g := range guests {
				if g.CategoryID != "general" {
					continue
				}
				foodPayload := g.FoodQR
				if foodPayload == "" {
					continue
				}

				result, err := svc.ProcessFoodScan(infra.Ctx, scan.FoodScanRequest{
					QRPayload:      foodPayload,
					StallID:        "stall_fuchka_01",
					DeviceID:       "device_test_01",
					FoodCategoryID: "fuchka",
				})
				if err != nil {
					t.Fatalf("second food scan failed for general guest %s: %v", g.ID, err)
				}
				if result.Status == "limit_reached" {
					generalRejected++
				} else {
					t.Errorf("expected 'limit_reached' for general guest %s, got %q", g.ID, result.Status)
				}
			}

			// Count general guests that had food QR
			generalWithFood := 0
			for _, g := range guests {
				if g.CategoryID == "general" && g.FoodQR != "" {
					generalWithFood++
				}
			}
			if generalRejected != generalWithFood {
				t.Errorf("expected %d general guests rejected, got %d", generalWithFood, generalRejected)
			}

			// Second round for VIP guests: should still SUCCEED (limit: 3, used: 1)
			for _, g := range guests {
				if g.CategoryID != "vip" {
					continue
				}
				foodPayload := g.FoodQR
				if foodPayload == "" {
					continue
				}

				result, err := svc.ProcessFoodScan(infra.Ctx, scan.FoodScanRequest{
					QRPayload:      foodPayload,
					StallID:        "stall_fuchka_01",
					DeviceID:       "device_test_01",
					FoodCategoryID: "fuchka",
				})
				if err != nil {
					t.Fatalf("second food scan failed for VIP guest %s: %v", g.ID, err)
				}
				if result.Status != "valid" {
					t.Errorf("expected 'valid' for VIP guest %s (limit 3, used 1), got %q",
						g.ID, result.Status)
				}
			}
		})
	}
}

// TestConfigMatrix_CrossStallEnforcement tests that food limits are enforced
// across different stalls for all 6 configurations.
func TestConfigMatrix_CrossStallEnforcement(t *testing.T) {
	for _, cfg := range AllConfigs() {
		t.Run(cfg.Name, func(t *testing.T) {
			infra := SetupTestInfra(t)
			defer infra.Teardown(t)

			eventID := infra.SeedEvent(t, cfg)
			// Seed only General guests (fuchka limit: 1)
			guests := infra.SeedGuests(t, eventID, cfg, 10)
			infra.SeedFoodRules(t, eventID)
			infra.SeedVendorHierarchy(t, eventID)
			infra.InitializeCounters(t, eventID)

			svc := scan.NewService(infra.Redis, infra.PG, testHMACSecret)

			// Entry scan all guests
			for _, g := range guests {
				_, err := svc.ProcessEntryScan(infra.Ctx, scan.ScanRequest{
					QRPayload: g.EntryQR,
					StallID:   "stall_entry_01",
					DeviceID:  "device_test_01",
				})
				if err != nil {
					t.Fatalf("entry scan failed for guest %s: %v", g.ID, err)
				}
			}

			// Select only general guests (who have fuchka limit=1)
			var generalGuests []TestGuest
			for _, g := range guests {
				if g.CategoryID == "general" && g.FoodQR != "" {
					generalGuests = append(generalGuests, g)
				}
			}

			if len(generalGuests) == 0 {
				t.Skip("no general guests with food QR available")
			}

			// Take first 5 general guests (or fewer if not enough)
			scanCount := 5
			if scanCount > len(generalGuests) {
				scanCount = len(generalGuests)
			}

			// Scan first batch at stall 1 — should succeed
			for i := 0; i < scanCount; i++ {
				result, err := svc.ProcessFoodScan(infra.Ctx, scan.FoodScanRequest{
					QRPayload:      generalGuests[i].FoodQR,
					StallID:        "stall_fuchka_01",
					DeviceID:       "device_test_01",
					FoodCategoryID: "fuchka",
				})
				if err != nil {
					t.Fatalf("stall-1 food scan failed for guest %s: %v", generalGuests[i].ID, err)
				}
				if result.Status != "valid" {
					t.Errorf("stall-1 expected 'valid' for guest %s, got %q", generalGuests[i].ID, result.Status)
				}
			}

			// Scan same guests at stall 2 — should be REJECTED (cross-stall enforcement)
			rejectedCount := 0
			for i := 0; i < scanCount; i++ {
				result, err := svc.ProcessFoodScan(infra.Ctx, scan.FoodScanRequest{
					QRPayload:      generalGuests[i].FoodQR,
					StallID:        "stall_fuchka_02",
					DeviceID:       "device_test_02",
					FoodCategoryID: "fuchka",
				})
				if err != nil {
					t.Fatalf("stall-2 food scan failed for guest %s: %v", generalGuests[i].ID, err)
				}
				if result.Status == "limit_reached" {
					rejectedCount++
				} else {
					t.Errorf("stall-2 expected 'limit_reached' for guest %s, got %q",
						generalGuests[i].ID, result.Status)
				}
			}

			if rejectedCount != scanCount {
				t.Errorf("expected %d cross-stall rejections, got %d", scanCount, rejectedCount)
			}
		})
	}
}

// TestConfigMatrix_PostEntryFoodTiming tests that post-entry food QRs work correctly.
// Only runs for configs with food_timing == "post-entry".
func TestConfigMatrix_PostEntryFoodTiming(t *testing.T) {
	for _, cfg := range AllConfigs() {
		if cfg.FoodTiming != "post-entry" {
			continue
		}
		t.Run(cfg.Name, func(t *testing.T) {
			infra := SetupTestInfra(t)
			defer infra.Teardown(t)

			eventID := infra.SeedEvent(t, cfg)
			guests := infra.SeedGuests(t, eventID, cfg, 10)
			infra.SeedFoodRules(t, eventID)
			infra.SeedVendorHierarchy(t, eventID)
			infra.InitializeCounters(t, eventID)

			svc := scan.NewService(infra.Redis, infra.PG, testHMACSecret)

			// Verify guests initially have no food QR (post-entry timing)
			for _, g := range guests {
				if g.FoodQR != "" {
					t.Errorf("post-entry guest %s should not have food QR before entry, but has one", g.ID)
				}
			}

			// Entry scan all guests
			for _, g := range guests {
				result, err := svc.ProcessEntryScan(infra.Ctx, scan.ScanRequest{
					QRPayload: g.EntryQR,
					StallID:   "stall_entry_01",
					DeviceID:  "device_test_01",
				})
				if err != nil {
					t.Fatalf("entry scan failed for guest %s: %v", g.ID, err)
				}
				if result.Status != "valid" {
					t.Errorf("entry scan expected 'valid' for guest %s, got %q", g.ID, result.Status)
				}
			}

			// After entry, manually generate food QR payloads (simulating post-entry generation)
			now := time.Now().Unix()
			for i := range guests {
				foodP := qr.Payload{
					Version:   qr.PayloadVersion,
					QRType:    qr.QRTypeFood,
					EventID:   eventID,
					GuestID:   guests[i].ID,
					Timestamp: now,
				}
				foodEncoded, err := qr.EncodePayload(foodP, testHMACSecret)
				if err != nil {
					t.Fatalf("failed to generate post-entry food QR for guest %s: %v", guests[i].ID, err)
				}
				guests[i].FoodQR = foodEncoded

				// For anonymous mode, seed the anonymous token
				if cfg.FoodMode == "anonymous" {
					anonKey := fmt.Sprintf("anontoken:%s:%s", eventID, guests[i].ID)
					infra.Redis.HSet(infra.Ctx, anonKey, "category", guests[i].CategoryID)
				}
			}

			// Now food scans should work with the generated QRs
			for _, g := range guests {
				result, err := svc.ProcessFoodScan(infra.Ctx, scan.FoodScanRequest{
					QRPayload:      g.FoodQR,
					StallID:        "stall_fuchka_01",
					DeviceID:       "device_test_01",
					FoodCategoryID: "fuchka",
				})
				if err != nil {
					t.Fatalf("post-entry food scan failed for guest %s: %v", g.ID, err)
				}
				if result.Status != "valid" {
					t.Errorf("post-entry food scan expected 'valid' for guest %s, got %q", g.ID, result.Status)
				}
			}
		})
	}
}

// TestConfigMatrix_CounterReconciliation tests Redis-PG counter consistency
// for all 6 configurations.
func TestConfigMatrix_CounterReconciliation(t *testing.T) {
	for _, cfg := range AllConfigs() {
		t.Run(cfg.Name, func(t *testing.T) {
			infra := SetupTestInfra(t)
			defer infra.Teardown(t)

			eventID := infra.SeedEvent(t, cfg)
			guests := infra.SeedGuests(t, eventID, cfg, 100)
			infra.SeedFoodRules(t, eventID)
			infra.SeedVendorHierarchy(t, eventID)
			infra.InitializeCounters(t, eventID)

			svc := scan.NewService(infra.Redis, infra.PG, testHMACSecret)

			// Process entry scans for all guests
			for _, g := range guests {
				_, err := svc.ProcessEntryScan(infra.Ctx, scan.ScanRequest{
					QRPayload: g.EntryQR,
					StallID:   "stall_entry_01",
					DeviceID:  "device_test_01",
				})
				if err != nil {
					t.Fatalf("entry scan failed for guest %s: %v", g.ID, err)
				}
			}

			// Also process some food scans for guests with food QR
			foodScanned := 0
			for _, g := range guests {
				if g.FoodQR == "" {
					continue
				}
				_, err := svc.ProcessFoodScan(infra.Ctx, scan.FoodScanRequest{
					QRPayload:      g.FoodQR,
					StallID:        "stall_fuchka_01",
					DeviceID:       "device_test_01",
					FoodCategoryID: "fuchka",
				})
				if err != nil {
					// Some food scans may fail (no rule etc.) — skip silently
					continue
				}
				foodScanned++
			}

			// Verify Redis attendance counter
			countersKey := fmt.Sprintf("counters:%s", eventID)
			attendance, err := infra.Redis.HGet(infra.Ctx, countersKey, "attendance").Result()
			if err != nil {
				t.Fatalf("failed to get attendance counter: %v", err)
			}
			attendanceInt, _ := strconv.Atoi(attendance)
			if attendanceInt != 100 {
				t.Errorf("expected Redis attendance 100, got %d", attendanceInt)
			}

			// Insert PG records to simulate async PG writes
			// (In production, asynq workers handle this. We write directly for test.)
			for _, g := range guests {
				_, err := infra.PG.Exec(infra.Ctx,
					`INSERT INTO entry_scans (idempotency_key, event_id, guest_id, stall_id, scanned_at, device_id, status, guest_category)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
					 ON CONFLICT (idempotency_key) DO NOTHING`,
					fmt.Sprintf("entry:%s:%s", eventID, g.ID),
					eventID, g.ID, "stall_entry_01",
					time.Now(), "device_test_01", "valid", g.CategoryID,
				)
				if err != nil {
					t.Fatalf("failed to insert PG entry scan for %s: %v", g.ID, err)
				}
			}

			// Verify PG count matches Redis
			var pgCount int64
			err = infra.PG.QueryRow(infra.Ctx,
				"SELECT COUNT(*) FROM entry_scans WHERE event_id=$1 AND status='valid'",
				eventID).Scan(&pgCount)
			if err != nil {
				t.Fatalf("failed to count PG entry scans: %v", err)
			}
			if pgCount != int64(attendanceInt) {
				t.Errorf("PG count (%d) != Redis attendance (%d)", pgCount, attendanceInt)
			}

			// Simulate Redis restart: flush Redis counters
			checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
			infra.Redis.Del(infra.Ctx, countersKey)
			infra.Redis.Del(infra.Ctx, checkedInKey)

			// Re-seed counters from PG using the ReseedService
			pgStore := scan.NewPGStore(infra.PG)
			reseedSvc := scan.NewReseedService(infra.Redis, pgStore)
			if err := reseedSvc.ReseedEventCounters(infra.Ctx, eventID); err != nil {
				t.Fatalf("reseed failed: %v", err)
			}

			// Verify re-seeded counters match PG
			reseededAttendance, err := infra.Redis.HGet(infra.Ctx, countersKey, "attendance").Result()
			if err != nil {
				t.Fatalf("failed to get re-seeded attendance: %v", err)
			}
			reseededInt, _ := strconv.Atoi(reseededAttendance)
			if int64(reseededInt) != pgCount {
				t.Errorf("re-seeded attendance (%d) != PG count (%d)", reseededInt, pgCount)
			}

			// Verify duplicate detection works after re-seed
			reseededSetCard, err := infra.Redis.SCard(infra.Ctx, checkedInKey).Result()
			if err != nil {
				t.Fatalf("failed to get re-seeded set cardinality: %v", err)
			}
			if reseededSetCard != pgCount {
				t.Errorf("re-seeded set cardinality (%d) != PG count (%d)", reseededSetCard, pgCount)
			}

			// Scan an already-checked-in guest after re-seed: should be duplicate
			result, err := svc.ProcessEntryScan(infra.Ctx, scan.ScanRequest{
				QRPayload: guests[0].EntryQR,
				StallID:   "stall_entry_02",
				DeviceID:  "device_test_02",
			})
			if err != nil {
				t.Fatalf("post-reseed scan failed: %v", err)
			}
			if result.Status != "duplicate" {
				t.Errorf("post-reseed scan expected 'duplicate', got %q", result.Status)
			}
		})
	}
}

