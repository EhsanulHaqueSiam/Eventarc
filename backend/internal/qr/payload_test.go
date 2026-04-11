package qr

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

var testSecret = []byte("test-hmac-secret-key-32-bytes!!")

func TestEncodeDecodePayload(t *testing.T) {
	original := Payload{
		Version:   PayloadVersion,
		QRType:    QRTypeEntry,
		EventID:   "jd7f2g3h4k5m6n",
		GuestID:   "km8n9p0q1r2s3t",
		Timestamp: time.Now().Unix(),
	}

	encoded, err := EncodePayload(original, testSecret)
	if err != nil {
		t.Fatalf("EncodePayload failed: %v", err)
	}

	if encoded == "" {
		t.Fatal("encoded string is empty")
	}

	decoded, err := DecodePayload(encoded, testSecret)
	if err != nil {
		t.Fatalf("DecodePayload failed: %v", err)
	}

	if decoded.Version != original.Version {
		t.Errorf("Version mismatch: got %d, want %d", decoded.Version, original.Version)
	}
	if decoded.QRType != original.QRType {
		t.Errorf("QRType mismatch: got %d, want %d", decoded.QRType, original.QRType)
	}
	if decoded.EventID != original.EventID {
		t.Errorf("EventID mismatch: got %q, want %q", decoded.EventID, original.EventID)
	}
	if decoded.GuestID != original.GuestID {
		t.Errorf("GuestID mismatch: got %q, want %q", decoded.GuestID, original.GuestID)
	}
	if decoded.Timestamp != original.Timestamp {
		t.Errorf("Timestamp mismatch: got %d, want %d", decoded.Timestamp, original.Timestamp)
	}
}

func TestPayloadRoundTrip(t *testing.T) {
	cases := []struct {
		name    string
		eventID string
		guestID string
	}{
		{"short IDs", "e1", "g1"},
		{"typical Convex IDs", "jd7f2g3h4k5m6n", "km8n9p0q1r2s3t"},
		{"long IDs", strings.Repeat("a", 100), strings.Repeat("b", 100)},
		{"max length IDs", strings.Repeat("x", 255), strings.Repeat("y", 255)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := Payload{
				Version:   PayloadVersion,
				QRType:    QRTypeUnified,
				EventID:   tc.eventID,
				GuestID:   tc.guestID,
				Timestamp: 1712345678,
			}

			encoded, err := EncodePayload(p, testSecret)
			if err != nil {
				t.Fatalf("EncodePayload failed: %v", err)
			}

			decoded, err := DecodePayload(encoded, testSecret)
			if err != nil {
				t.Fatalf("DecodePayload failed: %v", err)
			}

			if decoded.EventID != tc.eventID {
				t.Errorf("EventID mismatch: got len %d, want len %d", len(decoded.EventID), len(tc.eventID))
			}
			if decoded.GuestID != tc.guestID {
				t.Errorf("GuestID mismatch: got len %d, want len %d", len(decoded.GuestID), len(tc.guestID))
			}
		})
	}
}

func TestPayloadTamperDetection(t *testing.T) {
	p := Payload{
		Version:   PayloadVersion,
		QRType:    QRTypeEntry,
		EventID:   "event123",
		GuestID:   "guest456",
		Timestamp: 1712345678,
	}

	encoded, err := EncodePayload(p, testSecret)
	if err != nil {
		t.Fatalf("EncodePayload failed: %v", err)
	}

	// Decode the base64 to get raw bytes
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("base64 decode failed: %v", err)
	}

	// Flip a byte in the middle of the payload (not in the HMAC)
	tampered := make([]byte, len(raw))
	copy(tampered, raw)
	tampered[5] ^= 0xFF // Flip byte in the eventID region

	tamperedEncoded := base64.RawURLEncoding.EncodeToString(tampered)

	_, err = DecodePayload(tamperedEncoded, testSecret)
	if !errors.Is(err, ErrInvalidSignature) {
		t.Errorf("expected ErrInvalidSignature, got: %v", err)
	}
}

func TestPayloadWrongSecret(t *testing.T) {
	p := Payload{
		Version:   PayloadVersion,
		QRType:    QRTypeFood,
		EventID:   "event123",
		GuestID:   "guest456",
		Timestamp: 1712345678,
	}

	encoded, err := EncodePayload(p, testSecret)
	if err != nil {
		t.Fatalf("EncodePayload failed: %v", err)
	}

	wrongSecret := []byte("wrong-secret-key-different-val!")
	_, err = DecodePayload(encoded, wrongSecret)
	if !errors.Is(err, ErrInvalidSignature) {
		t.Errorf("expected ErrInvalidSignature, got: %v", err)
	}
}

func TestPayloadInvalidVersion(t *testing.T) {
	p := Payload{
		Version:   0x99, // Invalid version
		QRType:    QRTypeEntry,
		EventID:   "event123",
		GuestID:   "guest456",
		Timestamp: 1712345678,
	}

	// Encode with the invalid version (EncodePayload doesn't validate version)
	encoded, err := EncodePayload(p, testSecret)
	if err != nil {
		t.Fatalf("EncodePayload failed: %v", err)
	}

	_, err = DecodePayload(encoded, testSecret)
	if !errors.Is(err, ErrUnsupportedVersion) {
		t.Errorf("expected ErrUnsupportedVersion, got: %v", err)
	}
}

func TestPayloadInvalidQRType(t *testing.T) {
	p := Payload{
		Version:   PayloadVersion,
		QRType:    0xFF, // Invalid type
		EventID:   "event123",
		GuestID:   "guest456",
		Timestamp: 1712345678,
	}

	encoded, err := EncodePayload(p, testSecret)
	if err != nil {
		t.Fatalf("EncodePayload failed: %v", err)
	}

	_, err = DecodePayload(encoded, testSecret)
	if !errors.Is(err, ErrInvalidQRType) {
		t.Errorf("expected ErrInvalidQRType, got: %v", err)
	}
}

func TestPayloadEmptyFields(t *testing.T) {
	cases := []struct {
		name    string
		eventID string
		guestID string
	}{
		{"empty eventID", "", "guest456"},
		{"empty guestID", "event123", ""},
		{"both empty", "", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := Payload{
				Version:   PayloadVersion,
				QRType:    QRTypeEntry,
				EventID:   tc.eventID,
				GuestID:   tc.guestID,
				Timestamp: 1712345678,
			}

			_, err := EncodePayload(p, testSecret)
			if !errors.Is(err, ErrEmptyField) {
				t.Errorf("expected ErrEmptyField, got: %v", err)
			}
		})
	}
}

func TestPayloadTooShort(t *testing.T) {
	// Create a base64 string of only 10 bytes
	short := base64.RawURLEncoding.EncodeToString(make([]byte, 10))

	_, err := DecodePayload(short, testSecret)
	if !errors.Is(err, ErrInvalidPayload) {
		t.Errorf("expected ErrInvalidPayload, got: %v", err)
	}
}

func TestDetermineQRTypes_Unified(t *testing.T) {
	types := DetermineQRTypes("unified", "guestLinked")
	if len(types) != 1 {
		t.Fatalf("expected 1 type, got %d", len(types))
	}
	if types[0] != QRTypeUnified {
		t.Errorf("expected QRTypeUnified (0x%02x), got 0x%02x", QRTypeUnified, types[0])
	}
}

func TestDetermineQRTypes_Separate(t *testing.T) {
	types := DetermineQRTypes("separate", "guestLinked")
	if len(types) != 2 {
		t.Fatalf("expected 2 types, got %d", len(types))
	}
	if types[0] != QRTypeEntry {
		t.Errorf("expected QRTypeEntry (0x%02x) at index 0, got 0x%02x", QRTypeEntry, types[0])
	}
	if types[1] != QRTypeFood {
		t.Errorf("expected QRTypeFood (0x%02x) at index 1, got 0x%02x", QRTypeFood, types[1])
	}
}

func TestDetermineQRTypes_AllCombinations(t *testing.T) {
	cases := []struct {
		strategy string
		mode     string
		expected int
	}{
		{"unified", "guestLinked", 1},
		{"unified", "anonymous", 1},
		{"separate", "guestLinked", 2},
		{"separate", "anonymous", 2},
	}

	for _, tc := range cases {
		t.Run(tc.strategy+"_"+tc.mode, func(t *testing.T) {
			types := DetermineQRTypes(tc.strategy, tc.mode)
			if len(types) != tc.expected {
				t.Errorf("expected %d types for %s/%s, got %d", tc.expected, tc.strategy, tc.mode, len(types))
			}
		})
	}
}

func TestQRTypeName(t *testing.T) {
	if QRTypeName(QRTypeEntry) != "entry" {
		t.Errorf("expected 'entry', got %q", QRTypeName(QRTypeEntry))
	}
	if QRTypeName(QRTypeFood) != "food" {
		t.Errorf("expected 'food', got %q", QRTypeName(QRTypeFood))
	}
	if QRTypeName(QRTypeUnified) != "unified" {
		t.Errorf("expected 'unified', got %q", QRTypeName(QRTypeUnified))
	}
	if QRTypeName(0xFF) != "unknown" {
		t.Errorf("expected 'unknown', got %q", QRTypeName(0xFF))
	}
}
