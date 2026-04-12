package scan

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// TestConcurrentEntryScan_NoDuplicates verifies that N concurrent scans for N
// different guests produce exactly N successful check-ins and zero duplicates.
func TestConcurrentEntryScan_NoDuplicates(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := NewService(rdb, nil, testSecret)
	ctx := context.Background()

	const numGuests = 500

	// Seed guests
	for i := 0; i < numGuests; i++ {
		guestID := fmt.Sprintf("conc_guest_%04d", i)
		seedTestGuest(t, rdb, testEventID, guestID, fmt.Sprintf("Guest %d", i), "regular")
	}

	// Prepare payloads
	payloads := make([]string, numGuests)
	for i := 0; i < numGuests; i++ {
		guestID := fmt.Sprintf("conc_guest_%04d", i)
		payloads[i] = makeValidPayload(t, testEventID, guestID, qr.QRTypeEntry)
	}

	// Launch goroutines with barrier for simultaneous start
	var (
		wg      sync.WaitGroup
		barrier = make(chan struct{})
		mu      sync.Mutex
		valid   int
		dup     int
		errs    int
	)

	for i := 0; i < numGuests; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-barrier // Wait for all goroutines to be ready

			result, err := svc.ProcessEntryScan(ctx, ScanRequest{
				QRPayload: payloads[idx],
				StallID:   "stall_conc",
				DeviceID:  fmt.Sprintf("device_%04d", idx),
			})

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs++
			} else if result.Status == "valid" {
				valid++
			} else if result.Status == "duplicate" {
				dup++
			}
		}(i)
	}

	// Release all goroutines simultaneously
	close(barrier)
	wg.Wait()

	if errs != 0 {
		t.Errorf("expected 0 errors, got %d", errs)
	}
	if valid != numGuests {
		t.Errorf("expected %d valid scans, got %d", numGuests, valid)
	}
	if dup != 0 {
		t.Errorf("expected 0 duplicates, got %d", dup)
	}

	// Verify Redis state
	checkedInKey := fmt.Sprintf("checkedin:%s", testEventID)
	setCard, _ := rdb.SCard(ctx, checkedInKey).Result()
	if setCard != int64(numGuests) {
		t.Errorf("expected SCARD %d, got %d", numGuests, setCard)
	}

	countersKey := fmt.Sprintf("counters:%s", testEventID)
	attendance, _ := rdb.HGet(ctx, countersKey, "attendance").Result()
	if attendance != fmt.Sprintf("%d", numGuests) {
		t.Errorf("expected attendance '%d', got %q", numGuests, attendance)
	}
}

// TestConcurrentDuplicateScan_OnlyOneSucceeds verifies that N concurrent scans
// for the SAME guest produce exactly 1 successful check-in and N-1 "duplicate".
func TestConcurrentDuplicateScan_OnlyOneSucceeds(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := NewService(rdb, nil, testSecret)
	ctx := context.Background()

	const numConcurrent = 100
	guestID := "conc_same_guest"
	eventID := "evt_conc_dup"
	seedTestGuest(t, rdb, eventID, guestID, "Same Guest", "vip")

	payload := makeValidPayload(t, eventID, guestID, qr.QRTypeEntry)

	var (
		wg      sync.WaitGroup
		barrier = make(chan struct{})
		mu      sync.Mutex
		valid   int
		dup     int
		errs    int
	)

	for i := 0; i < numConcurrent; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-barrier

			result, err := svc.ProcessEntryScan(ctx, ScanRequest{
				QRPayload: payload,
				StallID:   "stall_same",
				DeviceID:  fmt.Sprintf("device_same_%03d", idx),
			})

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs++
			} else if result.Status == "valid" {
				valid++
			} else if result.Status == "duplicate" {
				dup++
			}
		}(i)
	}

	close(barrier)
	wg.Wait()

	if errs != 0 {
		t.Errorf("expected 0 errors, got %d", errs)
	}
	if valid != 1 {
		t.Errorf("expected exactly 1 valid scan, got %d", valid)
	}
	if dup != numConcurrent-1 {
		t.Errorf("expected %d duplicates, got %d", numConcurrent-1, dup)
	}

	// Verify Redis state
	checkedInKey := fmt.Sprintf("checkedin:%s", eventID)
	setCard, _ := rdb.SCard(ctx, checkedInKey).Result()
	if setCard != 1 {
		t.Errorf("expected SCARD 1, got %d", setCard)
	}

	countersKey := fmt.Sprintf("counters:%s", eventID)
	attendance, _ := rdb.HGet(ctx, countersKey, "attendance").Result()
	if attendance != "1" {
		t.Errorf("expected attendance '1', got %q", attendance)
	}
}

// TestConcurrentMixedScan_CorrectCounts verifies a mixed workload of unique
// and duplicate scans.
func TestConcurrentMixedScan_CorrectCounts(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := NewService(rdb, nil, testSecret)
	ctx := context.Background()

	const numGuests = 200
	const scansPerGuest = 5
	eventID := "evt_conc_mixed"

	// Seed guests and prepare payloads
	payloads := make([]string, numGuests)
	for i := 0; i < numGuests; i++ {
		guestID := fmt.Sprintf("mixed_guest_%04d", i)
		seedTestGuest(t, rdb, eventID, guestID, fmt.Sprintf("Mixed Guest %d", i), "regular")
		payloads[i] = makeValidPayload(t, eventID, guestID, qr.QRTypeEntry)
	}

	var (
		wg      sync.WaitGroup
		barrier = make(chan struct{})
		mu      sync.Mutex
		valid   int
		dup     int
		errs    int
	)

	// Each guest scanned 5 times concurrently
	totalGoroutines := numGuests * scansPerGuest
	for i := 0; i < totalGoroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-barrier

			guestIdx := idx % numGuests
			result, err := svc.ProcessEntryScan(ctx, ScanRequest{
				QRPayload: payloads[guestIdx],
				StallID:   "stall_mixed",
				DeviceID:  fmt.Sprintf("device_mixed_%04d", idx),
			})

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs++
			} else if result.Status == "valid" {
				valid++
			} else if result.Status == "duplicate" {
				dup++
			}
		}(i)
	}

	close(barrier)
	wg.Wait()

	if errs != 0 {
		t.Errorf("expected 0 errors, got %d", errs)
	}
	if valid != numGuests {
		t.Errorf("expected %d valid scans, got %d", numGuests, valid)
	}
	expectedDups := numGuests * (scansPerGuest - 1)
	if dup != expectedDups {
		t.Errorf("expected %d duplicates, got %d", expectedDups, dup)
	}

	// Verify Redis attendance counter
	countersKey := fmt.Sprintf("counters:%s", eventID)
	attendance, _ := rdb.HGet(ctx, countersKey, "attendance").Result()
	if attendance != fmt.Sprintf("%d", numGuests) {
		t.Errorf("expected attendance '%d', got %q", numGuests, attendance)
	}
}

// TestConcurrentCounterAccuracy verifies atomic counter accuracy under concurrent
// load with multiple categories.
func TestConcurrentCounterAccuracy(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := NewService(rdb, nil, testSecret)
	ctx := context.Background()

	eventID := "evt_conc_counter"

	// 3 categories with specific counts
	categories := []struct {
		name  string
		count int
	}{
		{"vip", 50},
		{"regular", 100},
		{"staff", 50},
	}

	var allPayloads []string
	guestNum := 0
	for _, cat := range categories {
		for i := 0; i < cat.count; i++ {
			guestID := fmt.Sprintf("counter_guest_%04d", guestNum)
			seedTestGuest(t, rdb, eventID, guestID, fmt.Sprintf("Counter Guest %d", guestNum), cat.name)
			payload := makeValidPayload(t, eventID, guestID, qr.QRTypeEntry)
			allPayloads = append(allPayloads, payload)
			guestNum++
		}
	}

	totalGuests := guestNum
	var (
		wg      sync.WaitGroup
		barrier = make(chan struct{})
		mu      sync.Mutex
		valid   int
		errs    int
	)

	for i := 0; i < totalGuests; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-barrier

			result, err := svc.ProcessEntryScan(ctx, ScanRequest{
				QRPayload: allPayloads[idx],
				StallID:   "stall_counter",
				DeviceID:  fmt.Sprintf("device_counter_%04d", idx),
			})

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs++
			} else if result.Status == "valid" {
				valid++
			}
		}(i)
	}

	close(barrier)
	wg.Wait()

	if errs != 0 {
		t.Errorf("expected 0 errors, got %d", errs)
	}
	if valid != totalGuests {
		t.Errorf("expected %d valid scans, got %d", totalGuests, valid)
	}

	// Verify total attendance
	countersKey := fmt.Sprintf("counters:%s", eventID)
	attendance, _ := rdb.HGet(ctx, countersKey, "attendance").Result()
	if attendance != fmt.Sprintf("%d", totalGuests) {
		t.Errorf("expected attendance '%d', got %q", totalGuests, attendance)
	}

	// Verify per-category counters
	for _, cat := range categories {
		val, err := rdb.HGet(ctx, countersKey, cat.name+":checkedin").Result()
		if err != nil {
			t.Fatalf("HGET %s:checkedin error: %v", cat.name, err)
		}
		if val != fmt.Sprintf("%d", cat.count) {
			t.Errorf("expected %s:checkedin '%d', got %q", cat.name, cat.count, val)
		}
	}
}
