package worker

import (
	"encoding/json"
	"testing"
)

func TestNewGenerateBatchTask(t *testing.T) {
	payload := GenerateBatchPayload{
		EventID:      "evt_123abc",
		QRStrategy:   "unified",
		FoodQRMode:   "guestLinked",
		FoodQRTiming: "preSent",
	}

	task, err := NewGenerateBatchTask(payload)
	if err != nil {
		t.Fatalf("NewGenerateBatchTask returned error: %v", err)
	}

	if task.Type() != TaskQRGenerateBatch {
		t.Errorf("task type = %q, want %q", task.Type(), TaskQRGenerateBatch)
	}

	// Verify payload round-trips correctly
	var decoded GenerateBatchPayload
	if err := json.Unmarshal(task.Payload(), &decoded); err != nil {
		t.Fatalf("failed to unmarshal task payload: %v", err)
	}

	if decoded.EventID != payload.EventID {
		t.Errorf("eventId = %q, want %q", decoded.EventID, payload.EventID)
	}
	if decoded.QRStrategy != payload.QRStrategy {
		t.Errorf("qrStrategy = %q, want %q", decoded.QRStrategy, payload.QRStrategy)
	}
	if decoded.FoodQRMode != payload.FoodQRMode {
		t.Errorf("foodQrMode = %q, want %q", decoded.FoodQRMode, payload.FoodQRMode)
	}
	if decoded.FoodQRTiming != payload.FoodQRTiming {
		t.Errorf("foodQrTiming = %q, want %q", decoded.FoodQRTiming, payload.FoodQRTiming)
	}
}

func TestNewGenerateSingleTask(t *testing.T) {
	payload := GenerateSinglePayload{
		EventID: "evt_123abc",
		GuestID: "gst_456def",
		QRTypes: []byte{0x01, 0x02}, // entry + food
	}

	task, err := NewGenerateSingleTask(payload)
	if err != nil {
		t.Fatalf("NewGenerateSingleTask returned error: %v", err)
	}

	if task.Type() != TaskQRGenerateSingle {
		t.Errorf("task type = %q, want %q", task.Type(), TaskQRGenerateSingle)
	}

	// Verify payload round-trips correctly
	var decoded GenerateSinglePayload
	if err := json.Unmarshal(task.Payload(), &decoded); err != nil {
		t.Fatalf("failed to unmarshal task payload: %v", err)
	}

	if decoded.EventID != payload.EventID {
		t.Errorf("eventId = %q, want %q", decoded.EventID, payload.EventID)
	}
	if decoded.GuestID != payload.GuestID {
		t.Errorf("guestId = %q, want %q", decoded.GuestID, payload.GuestID)
	}
	if len(decoded.QRTypes) != len(payload.QRTypes) {
		t.Fatalf("qrTypes length = %d, want %d", len(decoded.QRTypes), len(payload.QRTypes))
	}
	for i, v := range decoded.QRTypes {
		if v != payload.QRTypes[i] {
			t.Errorf("qrTypes[%d] = 0x%02x, want 0x%02x", i, v, payload.QRTypes[i])
		}
	}
}

func TestProgressKey(t *testing.T) {
	tests := []struct {
		eventID string
		want    string
	}{
		{"evt123", "qr:progress:evt123"},
		{"abc_def", "qr:progress:abc_def"},
		{"", "qr:progress:"},
	}

	for _, tt := range tests {
		got := ProgressKey(tt.eventID)
		if got != tt.want {
			t.Errorf("ProgressKey(%q) = %q, want %q", tt.eventID, got, tt.want)
		}
	}
}

func TestGenerateSinglePayloadRoundTrip(t *testing.T) {
	original := GenerateSinglePayload{
		EventID: "evt_roundtrip",
		GuestID: "gst_roundtrip",
		QRTypes: []byte{0x01, 0x02, 0x03}, // entry + food + unified
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var decoded GenerateSinglePayload
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if decoded.EventID != original.EventID {
		t.Errorf("eventId = %q, want %q", decoded.EventID, original.EventID)
	}
	if decoded.GuestID != original.GuestID {
		t.Errorf("guestId = %q, want %q", decoded.GuestID, original.GuestID)
	}
	if len(decoded.QRTypes) != len(original.QRTypes) {
		t.Fatalf("qrTypes length = %d, want %d", len(decoded.QRTypes), len(original.QRTypes))
	}
	for i, v := range decoded.QRTypes {
		if v != original.QRTypes[i] {
			t.Errorf("qrTypes[%d] = 0x%02x, want 0x%02x", i, v, original.QRTypes[i])
		}
	}
}
