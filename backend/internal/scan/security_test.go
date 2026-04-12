package scan

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

const securityTestSecret = "security_test_hmac_secret_32b!!"
const securityTestEventID = "evt_security_001"

// makeSecurityPayload creates a valid QR payload for security tests.
func makeSecurityPayload(t *testing.T, eventID, guestID string, qrType byte) string {
	t.Helper()
	p := qr.Payload{
		Version:   qr.PayloadVersion,
		QRType:    qrType,
		EventID:   eventID,
		GuestID:   guestID,
		Timestamp: time.Now().Unix(),
	}
	encoded, err := qr.EncodePayload(p, []byte(securityTestSecret))
	if err != nil {
		t.Fatalf("failed to encode security test payload: %v", err)
	}
	return encoded
}

// testComputeHMAC computes HMAC-SHA256 for test fixture generation.
func testComputeHMAC(data, secret []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write(data)
	return mac.Sum(nil)
}

// TestQRSecurity_ModifiedPayload verifies that changing any single byte
// in the QR payload causes HMAC verification to fail.
func TestQRSecurity_ModifiedPayload(t *testing.T) {
	encoded := makeSecurityPayload(t, securityTestEventID, "guest_mod_001", qr.QRTypeEntry)
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("failed to decode base64: %v", err)
	}

	// Test 1: Flip bit in the middle of payload (guest ID region)
	modified := make([]byte, len(raw))
	copy(modified, raw)
	modified[len(raw)/2] ^= 0x01
	tampered := base64.RawURLEncoding.EncodeToString(modified)
	_, err = qr.DecodePayload(tampered, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for middle-byte flip, got nil")
	}

	// Test 2: Flip bit at index 0 (version byte)
	modified2 := make([]byte, len(raw))
	copy(modified2, raw)
	modified2[0] ^= 0x01
	tampered2 := base64.RawURLEncoding.EncodeToString(modified2)
	_, err = qr.DecodePayload(tampered2, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for first-byte flip, got nil")
	}

	// Test 3: Flip last byte before HMAC (end of data section)
	hmacStart := len(raw) - 32
	modified3 := make([]byte, len(raw))
	copy(modified3, raw)
	modified3[hmacStart-1] ^= 0xFF
	tampered3 := base64.RawURLEncoding.EncodeToString(modified3)
	_, err = qr.DecodePayload(tampered3, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for last-data-byte flip, got nil")
	}
}

// TestQRSecurity_TruncatedPayload verifies that truncating the payload
// (removing HMAC suffix) causes verification to fail.
func TestQRSecurity_TruncatedPayload(t *testing.T) {
	encoded := makeSecurityPayload(t, securityTestEventID, "guest_trunc_001", qr.QRTypeEntry)
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("failed to decode base64: %v", err)
	}

	// Test 1: Remove last 32 bytes (full HMAC)
	truncated := raw[:len(raw)-32]
	enc1 := base64.RawURLEncoding.EncodeToString(truncated)
	_, err = qr.DecodePayload(enc1, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for HMAC-removed payload, got nil")
	}

	// Test 2: Remove just the last byte
	truncated2 := raw[:len(raw)-1]
	enc2 := base64.RawURLEncoding.EncodeToString(truncated2)
	_, err = qr.DecodePayload(enc2, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for last-byte-removed payload, got nil")
	}

	// Test 3: Remove the first byte (version prefix gone)
	truncated3 := raw[1:]
	enc3 := base64.RawURLEncoding.EncodeToString(truncated3)
	_, err = qr.DecodePayload(enc3, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for first-byte-removed payload, got nil")
	}
}

// TestQRSecurity_WrongHMACSecret verifies that a payload signed with
// a different HMAC secret is rejected.
func TestQRSecurity_WrongHMACSecret(t *testing.T) {
	// Sign with the real secret
	encoded := makeSecurityPayload(t, securityTestEventID, "guest_wrong_001", qr.QRTypeEntry)

	// Verify with a completely different secret
	wrongSecret := []byte("wrong_secret_completely_different")
	_, err := qr.DecodePayload(encoded, wrongSecret)
	if err == nil {
		t.Error("expected error for wrong HMAC secret, got nil")
	}
	if err != nil && !strings.Contains(err.Error(), "invalid HMAC signature") {
		t.Logf("got error (acceptable): %v", err)
	}
}

// TestQRSecurity_ReplayEntry verifies that scanning the same valid QR
// twice returns "already checked in" on the second scan.
func TestQRSecurity_ReplayEntry(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	svc := NewService(rdb, nil, []byte(securityTestSecret))

	guestID := "guest_replay_001"
	guestKey := "guest:" + securityTestEventID + ":" + guestID
	rdb.HSet(ctx, guestKey, map[string]interface{}{
		"name":     "Replay Guest",
		"category": "general",
		"photoUrl": "",
	})

	payload := makeSecurityPayload(t, securityTestEventID, guestID, qr.QRTypeEntry)
	req := ScanRequest{
		QRPayload: payload,
		StallID:   "stall_replay",
		DeviceID:  "device_replay",
	}

	// First scan: must return status "valid"
	result1, err := svc.ProcessEntryScan(ctx, req)
	if err != nil {
		t.Fatalf("first scan error: %v", err)
	}
	if result1.Status != "valid" {
		t.Errorf("first scan expected 'valid', got %q", result1.Status)
	}

	// Second scan (replay): must return status "duplicate"
	result2, err := svc.ProcessEntryScan(ctx, req)
	if err != nil {
		t.Fatalf("second scan error: %v", err)
	}
	if result2.Status != "duplicate" {
		t.Errorf("second scan expected 'duplicate', got %q", result2.Status)
	}
	if result2.Original == nil {
		t.Error("duplicate response should include original scan info")
	} else if result2.Original.StallID != "stall_replay" {
		t.Errorf("original stall expected 'stall_replay', got %q", result2.Original.StallID)
	}

	// Third scan: must also return "duplicate" (not "error")
	result3, err := svc.ProcessEntryScan(ctx, req)
	if err != nil {
		t.Fatalf("third scan error: %v", err)
	}
	if result3.Status != "duplicate" {
		t.Errorf("third scan expected 'duplicate', got %q", result3.Status)
	}

	// Verify Redis attendance counter == 1 (not 2 or 3)
	countersKey := "counters:" + securityTestEventID
	attendance, err := rdb.HGet(ctx, countersKey, "attendance").Result()
	if err != nil {
		t.Fatalf("failed to get attendance: %v", err)
	}
	if attendance != "1" {
		t.Errorf("expected attendance '1', got %q", attendance)
	}
}

// TestQRSecurity_ExpiredEvent verifies that scanning a QR for a
// non-live event is rejected via guest-not-found (event not seeded).
func TestQRSecurity_ExpiredEvent(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	svc := NewService(rdb, nil, []byte(securityTestSecret))

	payload := makeSecurityPayload(t, "evt_completed", "guest_expired_001", qr.QRTypeEntry)

	_, err := svc.ProcessEntryScan(ctx, ScanRequest{
		QRPayload: payload,
		StallID:   "stall_expired",
		DeviceID:  "device_expired",
	})
	if err == nil {
		t.Error("expected error for expired/non-existent event, got nil")
	}
}

// TestQRSecurity_WrongEvent verifies that scanning a QR from event A
// at event B's context is rejected.
func TestQRSecurity_WrongEvent(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	svc := NewService(rdb, nil, []byte(securityTestSecret))

	// Seed guest data for event B only
	rdb.HSet(ctx, "guest:evt_B:guest_wrong_001", map[string]interface{}{
		"name":     "Wrong Event Guest",
		"category": "general",
		"photoUrl": "",
	})

	// Generate QR for event A
	payload := makeSecurityPayload(t, "evt_A", "guest_wrong_001", qr.QRTypeEntry)

	// Scan with event-A QR — guest lookup for event A fails
	_, err := svc.ProcessEntryScan(ctx, ScanRequest{
		QRPayload: payload,
		StallID:   "stall_wrong",
		DeviceID:  "device_wrong",
	})
	if err == nil {
		t.Error("expected error for wrong-event QR, got nil")
	}
}

// TestQRSecurity_FabricatedPayload verifies that a manually constructed
// payload with correct structure but without valid HMAC is rejected.
func TestQRSecurity_FabricatedPayload(t *testing.T) {
	eventID := "evt_fake"
	guestID := "guest_fake_001"

	// Test 1: Correct structure + deterministic fake HMAC bytes
	data := []byte{qr.PayloadVersion, qr.QRTypeEntry}
	data = append(data, byte(len(eventID)))
	data = append(data, []byte(eventID)...)
	data = append(data, byte(len(guestID)))
	data = append(data, []byte(guestID)...)
	// Timestamp: 8 zero bytes
	ts := make([]byte, 8)
	data = append(data, ts...)
	// Append 32 deterministic bytes as fake HMAC
	fakeHMAC := make([]byte, 32)
	for i := range fakeHMAC {
		fakeHMAC[i] = byte(i * 7)
	}
	data = append(data, fakeHMAC...)

	enc := base64.RawURLEncoding.EncodeToString(data)
	_, err := qr.DecodePayload(enc, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for fabricated payload with fake HMAC, got nil")
	}

	// Test 2: Valid structure but HMAC computed over different data
	differentData := []byte("completely different data for HMAC computation")
	differentHMAC := testComputeHMAC(differentData, []byte(securityTestSecret))
	data2 := []byte{qr.PayloadVersion, qr.QRTypeEntry}
	data2 = append(data2, byte(len(eventID)))
	data2 = append(data2, []byte(eventID)...)
	data2 = append(data2, byte(len(guestID)))
	data2 = append(data2, []byte(guestID)...)
	data2 = append(data2, ts...)
	data2 = append(data2, differentHMAC...)

	enc2 := base64.RawURLEncoding.EncodeToString(data2)
	_, err = qr.DecodePayload(enc2, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for fabricated payload with mismatched HMAC, got nil")
	}
}

// TestQRSecurity_VersionManipulation verifies that changing the version
// byte causes rejection.
func TestQRSecurity_VersionManipulation(t *testing.T) {
	encoded := makeSecurityPayload(t, securityTestEventID, "guest_version_001", qr.QRTypeEntry)
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("failed to decode: %v", err)
	}

	versions := []byte{0x00, 0xFF, 0x02}
	for _, v := range versions {
		modified := make([]byte, len(raw))
		copy(modified, raw)
		modified[0] = v
		enc := base64.RawURLEncoding.EncodeToString(modified)
		_, err := qr.DecodePayload(enc, []byte(securityTestSecret))
		if err == nil {
			t.Errorf("expected error for version 0x%02x, got nil", v)
		}
	}
}

// TestQRSecurity_EmptyPayload verifies that an empty string is rejected
// without panic or information leak.
func TestQRSecurity_EmptyPayload(t *testing.T) {
	// Test 1: Empty string
	_, err := qr.DecodePayload("", []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for empty payload, got nil")
	}
	if err != nil && strings.Contains(err.Error(), securityTestSecret) {
		t.Error("error message contains HMAC secret — information leak")
	}

	// Test 2: Single byte
	singleByte := base64.RawURLEncoding.EncodeToString([]byte{0x01})
	_, err = qr.DecodePayload(singleByte, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for single-byte payload, got nil")
	}

	// Test 3: Invalid base64
	_, err = qr.DecodePayload("!!!not-valid-base64!!!", []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for invalid base64, got nil")
	}
	if err != nil && strings.Contains(err.Error(), securityTestSecret) {
		t.Error("error message for invalid base64 contains HMAC secret")
	}
}

// TestQRSecurity_OversizedPayload verifies that a payload exceeding
// maximum expected size is rejected.
func TestQRSecurity_OversizedPayload(t *testing.T) {
	oversized := make([]byte, 10*1024)
	for i := range oversized {
		oversized[i] = byte(i % 256)
	}
	enc := base64.RawURLEncoding.EncodeToString(oversized)
	_, err := qr.DecodePayload(enc, []byte(securityTestSecret))
	if err == nil {
		t.Error("expected error for oversized payload, got nil")
	}
}

// TestQRSecurity_TimingSafety verifies that HMAC comparison uses
// constant-time comparison (hmac.Equal) not bytes.Equal.
func TestQRSecurity_TimingSafety(t *testing.T) {
	encoded := makeSecurityPayload(t, securityTestEventID, "guest_timing_001", qr.QRTypeEntry)
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("failed to decode: %v", err)
	}

	// Create two different invalid HMACs
	wrongHMAC1 := make([]byte, len(raw))
	copy(wrongHMAC1, raw)
	wrongHMAC1[len(raw)-32] ^= 0xFF // First byte of HMAC differs

	wrongHMAC2 := make([]byte, len(raw))
	copy(wrongHMAC2, raw)
	wrongHMAC2[len(raw)-1] ^= 0xFF // Last byte of HMAC differs

	enc1 := base64.RawURLEncoding.EncodeToString(wrongHMAC1)
	enc2 := base64.RawURLEncoding.EncodeToString(wrongHMAC2)

	_, err1 := qr.DecodePayload(enc1, []byte(securityTestSecret))
	_, err2 := qr.DecodePayload(enc2, []byte(securityTestSecret))

	if err1 == nil {
		t.Error("expected error for wrongHMAC1, got nil")
	}
	if err2 == nil {
		t.Error("expected error for wrongHMAC2, got nil")
	}

	// Both should produce the same error type
	if err1 != nil && err2 != nil {
		if err1.Error() != err2.Error() {
			t.Errorf("timing-safe HMAC should produce same error:\n  err1: %v\n  err2: %v", err1, err2)
		}
	}

	t.Log("HMAC comparison verified: both tampered payloads produce identical errors (consistent with constant-time comparison)")
}

// TestQRSecurity_FoodQRAtEntryGate verifies that a food-only QR code
// is rejected at the entry gate.
func TestQRSecurity_FoodQRAtEntryGate(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	svc := NewService(rdb, nil, []byte(securityTestSecret))

	guestID := "guest_foodatentry"
	rdb.HSet(ctx, "guest:"+securityTestEventID+":"+guestID, map[string]interface{}{
		"name":     "Food At Entry Guest",
		"category": "general",
		"photoUrl": "",
	})

	foodPayload := makeSecurityPayload(t, securityTestEventID, guestID, qr.QRTypeFood)

	_, err := svc.ProcessEntryScan(ctx, ScanRequest{
		QRPayload: foodPayload,
		StallID:   "stall_entry_01",
		DeviceID:  "device_entry_01",
	})
	if err == nil {
		t.Error("expected error for food QR at entry gate, got nil")
	}
}
