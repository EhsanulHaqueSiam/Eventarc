package scan

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

var testSecret = []byte("test-hmac-secret-key-32-bytes!!")

const testEventID = "evt_test_001"

// seedTestGuest populates the Redis guest hash for testing.
func seedTestGuest(t *testing.T, rdb *redis.Client, eventID, guestID, name, category string) {
	t.Helper()
	ctx := context.Background()
	key := "guest:" + eventID + ":" + guestID
	err := rdb.HSet(ctx, key, map[string]interface{}{
		"name":     name,
		"category": category,
		"photoUrl": "",
	}).Err()
	if err != nil {
		t.Fatalf("failed to seed guest: %v", err)
	}
}

// makeValidPayload creates a valid QR payload string for testing.
func makeValidPayload(t *testing.T, eventID, guestID string, qrType byte) string {
	t.Helper()
	p := qr.Payload{
		Version:   qr.PayloadVersion,
		QRType:    qrType,
		EventID:   eventID,
		GuestID:   guestID,
		Timestamp: time.Now().Unix(),
	}
	encoded, err := qr.EncodePayload(p, testSecret)
	if err != nil {
		t.Fatalf("failed to encode payload: %v", err)
	}
	return encoded
}

func newTestService(t *testing.T) (*Service, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := NewService(rdb, nil, testSecret)
	return svc, mr
}

func TestProcessEntryScan_ValidScan(t *testing.T) {
	svc, _ := newTestService(t)
	guestID := "guest_valid_001"
	seedTestGuest(t, svc.redis, testEventID, guestID, "Alice Test", "vip")

	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeEntry)
	result, err := svc.ProcessEntryScan(context.Background(), ScanRequest{
		QRPayload: payload,
		StallID:   "stall_A",
		DeviceID:  "device_01",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "valid" {
		t.Errorf("expected status 'valid', got %q", result.Status)
	}
	if result.Guest == nil {
		t.Fatal("expected guest info, got nil")
	}
	if result.Guest.Name != "Alice Test" {
		t.Errorf("expected guest name 'Alice Test', got %q", result.Guest.Name)
	}
	if result.Guest.Category != "vip" {
		t.Errorf("expected category 'vip', got %q", result.Guest.Category)
	}
	if result.Scan == nil {
		t.Fatal("expected scan info, got nil")
	}
	if result.Scan.StallID != "stall_A" {
		t.Errorf("expected stall 'stall_A', got %q", result.Scan.StallID)
	}
}

func TestProcessEntryScan_DuplicateScan(t *testing.T) {
	svc, _ := newTestService(t)
	guestID := "guest_dup_001"
	seedTestGuest(t, svc.redis, testEventID, guestID, "Bob Dup", "regular")

	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeEntry)
	req := ScanRequest{
		QRPayload: payload,
		StallID:   "stall_B",
		DeviceID:  "device_02",
	}

	// First scan — valid
	result1, err := svc.ProcessEntryScan(context.Background(), req)
	if err != nil {
		t.Fatalf("first scan error: %v", err)
	}
	if result1.Status != "valid" {
		t.Fatalf("first scan expected 'valid', got %q", result1.Status)
	}

	// Second scan — duplicate
	result2, err := svc.ProcessEntryScan(context.Background(), req)
	if err != nil {
		t.Fatalf("second scan error: %v", err)
	}
	if result2.Status != "duplicate" {
		t.Errorf("expected status 'duplicate', got %q", result2.Status)
	}
	if result2.Message != "Already checked in" {
		t.Errorf("expected message 'Already checked in', got %q", result2.Message)
	}
	if result2.Original == nil {
		t.Fatal("expected original scan info for duplicate")
	}
	if result2.Original.StallID != "stall_B" {
		t.Errorf("expected original stall 'stall_B', got %q", result2.Original.StallID)
	}
}

func TestProcessEntryScan_InvalidHMAC(t *testing.T) {
	svc, _ := newTestService(t)

	// Encode with a different secret
	p := qr.Payload{
		Version:   qr.PayloadVersion,
		QRType:    qr.QRTypeEntry,
		EventID:   testEventID,
		GuestID:   "guest_hmac",
		Timestamp: time.Now().Unix(),
	}
	wrongSecret := []byte("wrong-secret-key-different-val!")
	encoded, err := qr.EncodePayload(p, wrongSecret)
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}

	_, err = svc.ProcessEntryScan(context.Background(), ScanRequest{
		QRPayload: encoded,
		StallID:   "stall_C",
		DeviceID:  "device_03",
	})
	if !errors.Is(err, qr.ErrInvalidSignature) {
		t.Errorf("expected ErrInvalidSignature, got: %v", err)
	}
}

func TestProcessEntryScan_GuestNotFound(t *testing.T) {
	svc, _ := newTestService(t)
	// Do NOT seed guest — should get ErrNotFound
	payload := makeValidPayload(t, testEventID, "guest_missing", qr.QRTypeEntry)

	_, err := svc.ProcessEntryScan(context.Background(), ScanRequest{
		QRPayload: payload,
		StallID:   "stall_D",
		DeviceID:  "device_04",
	})
	if !errors.Is(err, model.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got: %v", err)
	}
}

func TestProcessEntryScan_WrongQRType(t *testing.T) {
	svc, _ := newTestService(t)
	guestID := "guest_food"
	seedTestGuest(t, svc.redis, testEventID, guestID, "Carol Food", "regular")

	// Food QR type should be rejected at entry gate
	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeFood)

	_, err := svc.ProcessEntryScan(context.Background(), ScanRequest{
		QRPayload: payload,
		StallID:   "stall_E",
		DeviceID:  "device_05",
	})
	if !errors.Is(err, qr.ErrInvalidQRType) {
		t.Errorf("expected ErrInvalidQRType, got: %v", err)
	}
}

func TestProcessEntryScan_UnifiedQR(t *testing.T) {
	svc, _ := newTestService(t)
	guestID := "guest_unified"
	seedTestGuest(t, svc.redis, testEventID, guestID, "Dan Unified", "staff")

	// Unified QR type should be accepted at entry gate
	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeUnified)

	result, err := svc.ProcessEntryScan(context.Background(), ScanRequest{
		QRPayload: payload,
		StallID:   "stall_F",
		DeviceID:  "device_06",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "valid" {
		t.Errorf("expected status 'valid', got %q", result.Status)
	}
}

func TestLuaAtomicCheckIn(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	eventID := "evt_lua_test"
	guestID := "guest_lua_001"
	checkedInKey := "checkedin:" + eventID
	checkInKey := "checkin:" + eventID + ":" + guestID
	countersKey := "counters:" + eventID

	// Execute Lua script directly
	result, err := checkInScript.Run(ctx, rdb,
		[]string{checkedInKey, checkInKey, countersKey},
		guestID, "2026-04-12T10:00:00Z", "stall_test", "device_test", "vip",
	).Text()
	if err != nil {
		t.Fatalf("lua script error: %v", err)
	}
	if result != "OK" {
		t.Errorf("expected 'OK', got %q", result)
	}

	// Verify SADD happened
	isMember, err := rdb.SIsMember(ctx, checkedInKey, guestID).Result()
	if err != nil {
		t.Fatalf("SISMEMBER error: %v", err)
	}
	if !isMember {
		t.Error("guest should be in checked-in set")
	}

	// Verify HSET happened
	ts, err := rdb.HGet(ctx, checkInKey, "timestamp").Result()
	if err != nil {
		t.Fatalf("HGET timestamp error: %v", err)
	}
	if ts != "2026-04-12T10:00:00Z" {
		t.Errorf("expected timestamp '2026-04-12T10:00:00Z', got %q", ts)
	}

	// Verify HINCRBY happened
	attendance, err := rdb.HGet(ctx, countersKey, "attendance").Result()
	if err != nil {
		t.Fatalf("HGET attendance error: %v", err)
	}
	if attendance != "1" {
		t.Errorf("expected attendance '1', got %q", attendance)
	}

	// Verify per-category counter
	vipCount, err := rdb.HGet(ctx, countersKey, "vip:checkedin").Result()
	if err != nil {
		t.Fatalf("HGET vip:checkedin error: %v", err)
	}
	if vipCount != "1" {
		t.Errorf("expected vip:checkedin '1', got %q", vipCount)
	}

	// Execute again for same guest — should return DUPLICATE
	result2, err := checkInScript.Run(ctx, rdb,
		[]string{checkedInKey, checkInKey, countersKey},
		guestID, "2026-04-12T10:01:00Z", "stall_test2", "device_test2", "vip",
	).Text()
	if err != nil {
		t.Fatalf("lua script error on duplicate: %v", err)
	}
	if result2 != "DUPLICATE" {
		t.Errorf("expected 'DUPLICATE', got %q", result2)
	}

	// Verify counter did NOT increment on duplicate
	attendance2, _ := rdb.HGet(ctx, countersKey, "attendance").Result()
	if attendance2 != "1" {
		t.Errorf("attendance should still be '1' after duplicate, got %q", attendance2)
	}
}

func TestCounterIncrement(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	guests := []struct {
		id       string
		name     string
		category string
	}{
		{"g1", "Guest 1", "vip"},
		{"g2", "Guest 2", "regular"},
		{"g3", "Guest 3", "vip"},
		{"g4", "Guest 4", "staff"},
	}

	for _, g := range guests {
		seedTestGuest(t, svc.redis, testEventID, g.id, g.name, g.category)
		payload := makeValidPayload(t, testEventID, g.id, qr.QRTypeEntry)
		result, err := svc.ProcessEntryScan(ctx, ScanRequest{
			QRPayload: payload,
			StallID:   "stall_count",
			DeviceID:  "device_count",
		})
		if err != nil {
			t.Fatalf("scan %s error: %v", g.id, err)
		}
		if result.Status != "valid" {
			t.Fatalf("scan %s expected 'valid', got %q", g.id, result.Status)
		}
	}

	// Verify total attendance
	countersKey := "counters:" + testEventID
	attendance, err := svc.redis.HGet(ctx, countersKey, "attendance").Result()
	if err != nil {
		t.Fatalf("HGET attendance error: %v", err)
	}
	if attendance != "4" {
		t.Errorf("expected attendance '4', got %q", attendance)
	}

	// Verify per-category counters
	vip, _ := svc.redis.HGet(ctx, countersKey, "vip:checkedin").Result()
	if vip != "2" {
		t.Errorf("expected vip:checkedin '2', got %q", vip)
	}
	regular, _ := svc.redis.HGet(ctx, countersKey, "regular:checkedin").Result()
	if regular != "1" {
		t.Errorf("expected regular:checkedin '1', got %q", regular)
	}
	staff, _ := svc.redis.HGet(ctx, countersKey, "staff:checkedin").Result()
	if staff != "1" {
		t.Errorf("expected staff:checkedin '1', got %q", staff)
	}
}
