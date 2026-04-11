package qr

import (
	"testing"
)

// PNG magic number: the first 8 bytes of any valid PNG file.
var pngMagic = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}

func TestGenerateQRImage(t *testing.T) {
	imgBytes, err := GenerateQRImage("hello-world-test-content", DefaultGeneratorConfig())
	if err != nil {
		t.Fatalf("GenerateQRImage failed: %v", err)
	}

	if len(imgBytes) == 0 {
		t.Fatal("generated image is empty")
	}

	// Verify PNG magic number
	if len(imgBytes) < 8 {
		t.Fatalf("image too small to be a valid PNG: %d bytes", len(imgBytes))
	}
	for i := 0; i < 8; i++ {
		if imgBytes[i] != pngMagic[i] {
			t.Fatalf("PNG magic number mismatch at byte %d: got 0x%02x, want 0x%02x", i, imgBytes[i], pngMagic[i])
		}
	}
}

func TestGenerateQRImageLongContent(t *testing.T) {
	// Simulate a typical Base64URL-encoded payload (~96 chars)
	longContent := "AQEOamQ3ZjJnM2g0azVtNm4Oa204bjlwMHExcjJzM3QAAAGOXcH2gA5zb21lLWhtYWMtc2lnbmF0dXJlLWhlcmU"

	imgBytes, err := GenerateQRImage(longContent, DefaultGeneratorConfig())
	if err != nil {
		t.Fatalf("GenerateQRImage failed with long content: %v", err)
	}

	if len(imgBytes) == 0 {
		t.Fatal("generated image is empty for long content")
	}

	// Verify PNG magic
	for i := 0; i < 8; i++ {
		if imgBytes[i] != pngMagic[i] {
			t.Fatalf("PNG magic number mismatch at byte %d", i)
		}
	}
}

func TestGenerateQRImageDefaultConfig(t *testing.T) {
	cfg := DefaultGeneratorConfig()
	if cfg.QRWidth != 10 {
		t.Errorf("default QRWidth: got %d, want 10", cfg.QRWidth)
	}
	if cfg.BorderWidth != 20 {
		t.Errorf("default BorderWidth: got %d, want 20", cfg.BorderWidth)
	}
	if cfg.FgColor != "#000000" {
		t.Errorf("default FgColor: got %q, want #000000", cfg.FgColor)
	}
	if cfg.BgColor != "#ffffff" {
		t.Errorf("default BgColor: got %q, want #ffffff", cfg.BgColor)
	}

	imgBytes, err := GenerateQRImage("test", cfg)
	if err != nil {
		t.Fatalf("GenerateQRImage with defaults failed: %v", err)
	}
	if len(imgBytes) == 0 {
		t.Fatal("empty output with default config")
	}
}

func TestGenerateGuestQRCodes_Unified(t *testing.T) {
	secret := []byte("test-generation-secret-key-here")
	images, err := GenerateGuestQRCodes("event123", "guest456", []byte{QRTypeUnified}, secret, DefaultGeneratorConfig())
	if err != nil {
		t.Fatalf("GenerateGuestQRCodes failed: %v", err)
	}

	if len(images) != 1 {
		t.Fatalf("expected 1 image for unified, got %d", len(images))
	}

	unifiedImg, ok := images[QRTypeUnified]
	if !ok {
		t.Fatal("missing QRTypeUnified key in result")
	}
	if len(unifiedImg) == 0 {
		t.Fatal("unified QR image is empty")
	}

	// Verify PNG
	for i := 0; i < 8; i++ {
		if unifiedImg[i] != pngMagic[i] {
			t.Fatalf("unified image PNG magic mismatch at byte %d", i)
		}
	}
}

func TestGenerateGuestQRCodes_Separate(t *testing.T) {
	secret := []byte("test-generation-secret-key-here")
	images, err := GenerateGuestQRCodes("event123", "guest456", []byte{QRTypeEntry, QRTypeFood}, secret, DefaultGeneratorConfig())
	if err != nil {
		t.Fatalf("GenerateGuestQRCodes failed: %v", err)
	}

	if len(images) != 2 {
		t.Fatalf("expected 2 images for separate, got %d", len(images))
	}

	entryImg, ok := images[QRTypeEntry]
	if !ok {
		t.Fatal("missing QRTypeEntry key in result")
	}
	if len(entryImg) == 0 {
		t.Fatal("entry QR image is empty")
	}

	foodImg, ok := images[QRTypeFood]
	if !ok {
		t.Fatal("missing QRTypeFood key in result")
	}
	if len(foodImg) == 0 {
		t.Fatal("food QR image is empty")
	}

	// Entry and food images should be different (different payload content)
	if len(entryImg) == len(foodImg) {
		// They could have the same length by chance, so check content
		same := true
		for i := range entryImg {
			if entryImg[i] != foodImg[i] {
				same = false
				break
			}
		}
		if same {
			t.Error("entry and food QR images are identical — they should have different payloads")
		}
	}
}

func TestGenerateGuestQRCodes_PayloadDecodable(t *testing.T) {
	secret := []byte("test-generation-secret-key-here")

	// Verify the payload encoding works by testing a round-trip
	// (we cannot decode the QR image in tests, but we can verify the
	// payload that EncodePayload produces is decodable)
	p := Payload{
		Version:   PayloadVersion,
		QRType:    QRTypeEntry,
		EventID:   "event123",
		GuestID:   "guest456",
		Timestamp: 1712345678,
	}

	encoded, err := EncodePayload(p, secret)
	if err != nil {
		t.Fatalf("EncodePayload failed: %v", err)
	}

	decoded, err := DecodePayload(encoded, secret)
	if err != nil {
		t.Fatalf("DecodePayload failed: %v", err)
	}

	if decoded.EventID != p.EventID || decoded.GuestID != p.GuestID {
		t.Error("payload round-trip failed: IDs don't match")
	}

	// Also verify the full pipeline produces images
	images, err := GenerateGuestQRCodes(p.EventID, p.GuestID, []byte{QRTypeEntry}, secret, DefaultGeneratorConfig())
	if err != nil {
		t.Fatalf("GenerateGuestQRCodes failed: %v", err)
	}
	if len(images) != 1 {
		t.Fatalf("expected 1 image, got %d", len(images))
	}
}
