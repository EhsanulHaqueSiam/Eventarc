package r2

import (
	"testing"
)

func TestBuildKey_Entry(t *testing.T) {
	key := BuildKey("evt123", "gst456", 0x01)
	expected := "events/evt123/guests/gst456/qr/entry.png"
	if key != expected {
		t.Errorf("BuildKey entry: got %q, want %q", key, expected)
	}
}

func TestBuildKey_Food(t *testing.T) {
	key := BuildKey("evt123", "gst456", 0x02)
	expected := "events/evt123/guests/gst456/qr/food.png"
	if key != expected {
		t.Errorf("BuildKey food: got %q, want %q", key, expected)
	}
}

func TestBuildKey_Unified(t *testing.T) {
	key := BuildKey("evt123", "gst456", 0x03)
	expected := "events/evt123/guests/gst456/qr/unified.png"
	if key != expected {
		t.Errorf("BuildKey unified: got %q, want %q", key, expected)
	}
}

func TestBuildKey_ConvexIDs(t *testing.T) {
	// Test with Convex-style IDs
	key := BuildKey("jd7f2g3h4k5m6n", "km8n9p0q1r2s3t", 0x01)
	expected := "events/jd7f2g3h4k5m6n/guests/km8n9p0q1r2s3t/qr/entry.png"
	if key != expected {
		t.Errorf("BuildKey Convex IDs: got %q, want %q", key, expected)
	}
}

func TestPublicURL(t *testing.T) {
	client := &Client{publicURL: "https://cdn.example.com"}
	url := client.PublicURL("events/evt123/guests/gst456/qr/entry.png")
	expected := "https://cdn.example.com/events/evt123/guests/gst456/qr/entry.png"
	if url != expected {
		t.Errorf("PublicURL: got %q, want %q", url, expected)
	}
}

func TestPublicURL_TrailingSlash(t *testing.T) {
	// Constructor trims trailing slash, but test the edge case directly
	client := &Client{publicURL: "https://cdn.example.com"}
	url := client.PublicURL("events/evt123/guests/gst456/qr/food.png")

	// Should NOT have double slash
	if url != "https://cdn.example.com/events/evt123/guests/gst456/qr/food.png" {
		t.Errorf("PublicURL trailing slash: got %q", url)
	}

	// Simulate what NewClient does — trim trailing slash
	client2 := &Client{publicURL: "https://cdn.example.com"} // already trimmed
	url2 := client2.PublicURL("test.png")
	if url2 != "https://cdn.example.com/test.png" {
		t.Errorf("PublicURL after trim: got %q", url2)
	}
}

func TestBuildEventPrefix(t *testing.T) {
	prefix := BuildEventPrefix("evt123")
	expected := "events/evt123/"
	if prefix != expected {
		t.Errorf("BuildEventPrefix: got %q, want %q", prefix, expected)
	}
}

func TestNewClient_ValidConfig(t *testing.T) {
	// This tests initialization with dummy credentials. It does NOT
	// attempt to connect to R2 — just verifies the client is created
	// without error.
	client, err := NewClient(
		"test-account-id",
		"test-access-key",
		"test-secret-key",
		"test-bucket",
		"https://cdn.test.com",
	)
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	if client == nil {
		t.Fatal("client is nil")
	}
	if client.bucketName != "test-bucket" {
		t.Errorf("bucketName: got %q, want %q", client.bucketName, "test-bucket")
	}
	if client.publicURL != "https://cdn.test.com" {
		t.Errorf("publicURL: got %q, want %q", client.publicURL, "https://cdn.test.com")
	}
}

func TestBuildCardKey(t *testing.T) {
	tests := []struct {
		name     string
		eventID  string
		guestID  string
		expected string
	}{
		{
			name:     "standard IDs",
			eventID:  "evt123",
			guestID:  "gst456",
			expected: "events/evt123/guests/gst456/cards/card.png",
		},
		{
			name:     "Convex-style IDs",
			eventID:  "jd7f2g3h4k5m6n",
			guestID:  "km8n9p0q1r2s3t",
			expected: "events/jd7f2g3h4k5m6n/guests/km8n9p0q1r2s3t/cards/card.png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := BuildCardKey(tt.eventID, tt.guestID)
			if key != tt.expected {
				t.Errorf("BuildCardKey(%q, %q) = %q, want %q", tt.eventID, tt.guestID, key, tt.expected)
			}
		})
	}
}

func TestNewClient_TrailingSlashTrimmed(t *testing.T) {
	client, err := NewClient(
		"test-account-id",
		"test-access-key",
		"test-secret-key",
		"test-bucket",
		"https://cdn.test.com/",
	)
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	if client.publicURL != "https://cdn.test.com" {
		t.Errorf("trailing slash not trimmed: got %q", client.publicURL)
	}
}
