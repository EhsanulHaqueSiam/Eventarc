package card

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg" // Register JPEG decoder
	"image/png"

	"github.com/disintegration/imaging"
)

// OverlayConfig specifies where and how to place the QR overlay on the background.
type OverlayConfig struct {
	Left   int // X position of QR overlay on background
	Top    int // Y position of QR overlay on background
	Width  int // Target width to resize QR overlay to
	Height int // Target height to resize QR overlay to (0 = preserve aspect ratio)
}

// Composite overlays a QR code image onto a background image at the specified
// position and size. Both images are provided as raw bytes (PNG or JPEG).
// The result is returned as PNG bytes.
//
// The QR image is resized to cfg.Width x cfg.Height using CatmullRom
// interpolation for quality/speed balance. If cfg.Height is 0, the aspect
// ratio is preserved.
func Composite(backgroundBytes, qrBytes []byte, cfg OverlayConfig) ([]byte, error) {
	// Decode background image
	background, _, err := image.Decode(bytes.NewReader(backgroundBytes))
	if err != nil {
		return nil, fmt.Errorf("card: failed to decode background image: %w", err)
	}

	// Decode QR overlay image
	qrImg, _, err := image.Decode(bytes.NewReader(qrBytes))
	if err != nil {
		return nil, fmt.Errorf("card: failed to decode QR image: %w", err)
	}

	// Resize QR overlay to target dimensions using CatmullRom for quality
	resizedQR := imaging.Resize(qrImg, cfg.Width, cfg.Height, imaging.CatmullRom)

	// Overlay QR onto background at specified position with full opacity
	composite := imaging.Overlay(background, resizedQR, image.Pt(cfg.Left, cfg.Top), 1.0)

	// Encode result as PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, composite); err != nil {
		return nil, fmt.Errorf("card: failed to encode composite image: %w", err)
	}

	return buf.Bytes(), nil
}

// BuildCardKey constructs the R2 object key for a guest's composite card image.
// Format: {eventID}/{guestID}/card.png
func BuildCardKey(eventID, guestID string) string {
	return fmt.Sprintf("%s/%s/card.png", eventID, guestID)
}
