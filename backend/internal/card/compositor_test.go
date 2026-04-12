package card

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// makeTestImage creates a solid-color PNG image of the given dimensions.
func makeTestImage(width, height int, c color.Color) []byte {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

func TestComposite_OverlayPosition(t *testing.T) {
	background := makeTestImage(800, 600, color.RGBA{R: 0, G: 0, B: 255, A: 255}) // blue
	qr := makeTestImage(100, 100, color.RGBA{R: 255, G: 0, B: 0, A: 255})         // red

	result, err := Composite(background, qr, OverlayConfig{
		Left:   350,
		Top:    250,
		Width:  100,
		Height: 100,
	})
	if err != nil {
		t.Fatalf("Composite failed: %v", err)
	}

	// Decode result
	img, err := png.Decode(bytes.NewReader(result))
	if err != nil {
		t.Fatalf("Failed to decode result PNG: %v", err)
	}

	// Verify output dimensions match background
	bounds := img.Bounds()
	if bounds.Dx() != 800 || bounds.Dy() != 600 {
		t.Errorf("Expected 800x600, got %dx%d", bounds.Dx(), bounds.Dy())
	}

	// Verify pixel at QR overlay position has QR color (red-ish)
	r, g, _, _ := img.At(350, 250).RGBA()
	if r>>8 < 200 || g>>8 > 50 {
		t.Errorf("Pixel at (350,250) should be red-ish, got R=%d G=%d", r>>8, g>>8)
	}

	// Verify pixel outside QR area is still blue
	r2, _, b2, _ := img.At(10, 10).RGBA()
	if r2>>8 > 50 || b2>>8 < 200 {
		t.Errorf("Pixel at (10,10) should be blue, got R=%d B=%d", r2>>8, b2>>8)
	}
}

func TestComposite_QRResize(t *testing.T) {
	background := makeTestImage(800, 600, color.RGBA{R: 100, G: 100, B: 100, A: 255})
	qr := makeTestImage(300, 300, color.RGBA{R: 255, G: 0, B: 0, A: 255})

	result, err := Composite(background, qr, OverlayConfig{
		Left:   100,
		Top:    100,
		Width:  150,
		Height: 150,
	})
	if err != nil {
		t.Fatalf("Composite failed: %v", err)
	}

	img, err := png.Decode(bytes.NewReader(result))
	if err != nil {
		t.Fatalf("Failed to decode result PNG: %v", err)
	}

	// Output dimensions should match background, not be affected by QR resize
	bounds := img.Bounds()
	if bounds.Dx() != 800 || bounds.Dy() != 600 {
		t.Errorf("Expected 800x600, got %dx%d", bounds.Dx(), bounds.Dy())
	}

	// Pixel inside resized QR area (100+75, 100+75) should be red-ish
	r, g, _, _ := img.At(175, 175).RGBA()
	if r>>8 < 150 || g>>8 > 100 {
		t.Errorf("Pixel at (175,175) in QR area should be red-ish, got R=%d G=%d", r>>8, g>>8)
	}

	// Pixel just outside resized QR area (100+160, 100+160) = (260,260) should be gray
	r2, g2, b2, _ := img.At(260, 260).RGBA()
	if r2>>8 < 80 || g2>>8 < 80 || b2>>8 < 80 {
		t.Errorf("Pixel at (260,260) outside QR should be gray-ish, got R=%d G=%d B=%d", r2>>8, g2>>8, b2>>8)
	}
}

func TestComposite_InvalidBackground(t *testing.T) {
	invalidBytes := []byte("not an image at all")
	qr := makeTestImage(100, 100, color.White)

	_, err := Composite(invalidBytes, qr, OverlayConfig{
		Left:   0,
		Top:    0,
		Width:  100,
		Height: 100,
	})
	if err == nil {
		t.Error("Expected error for invalid background, got nil")
	}
}

func TestComposite_InvalidQR(t *testing.T) {
	background := makeTestImage(800, 600, color.White)
	invalidBytes := []byte("not a valid image")

	_, err := Composite(background, invalidBytes, OverlayConfig{
		Left:   0,
		Top:    0,
		Width:  100,
		Height: 100,
	})
	if err == nil {
		t.Error("Expected error for invalid QR, got nil")
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
			expected: "evt123/gst456/card.png",
		},
		{
			name:     "Convex-style IDs",
			eventID:  "jd7f2g3h4k5m6n",
			guestID:  "km8n9p0q1r2s3t",
			expected: "jd7f2g3h4k5m6n/km8n9p0q1r2s3t/card.png",
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
