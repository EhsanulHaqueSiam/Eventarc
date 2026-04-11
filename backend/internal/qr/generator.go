package qr

import (
	"bytes"
	"fmt"
	"io"
	"time"

	"github.com/yeqown/go-qrcode/v2"
	"github.com/yeqown/go-qrcode/writer/standard"
)

// nopCloser wraps an io.Writer to satisfy the io.WriteCloser interface
// required by standard.NewWithWriter. Close is a no-op.
type nopCloser struct{ io.Writer }

func (nopCloser) Close() error { return nil }

// GeneratorConfig holds visual configuration for QR code image generation.
type GeneratorConfig struct {
	QRWidth     uint8  // Pixel width per QR module block (default: 10)
	BorderWidth int    // Border padding in pixels (default: 20)
	FgColor     string // Foreground hex color (default: "#000000")
	BgColor     string // Background hex color (default: "#ffffff")
}

// DefaultGeneratorConfig returns a GeneratorConfig with sensible defaults
// that produce a clean, scannable QR code image approximately 300px wide.
func DefaultGeneratorConfig() GeneratorConfig {
	return GeneratorConfig{
		QRWidth:     10,
		BorderWidth: 20,
		FgColor:     "#000000",
		BgColor:     "#ffffff",
	}
}

// GenerateQRImage creates a QR code image from the given content string and
// returns the image as PNG bytes. The image is generated entirely in memory.
func GenerateQRImage(content string, cfg GeneratorConfig) ([]byte, error) {
	qrc, err := qrcode.NewWith(content,
		qrcode.WithEncodingMode(qrcode.EncModeByte),
		qrcode.WithErrorCorrectionLevel(qrcode.ErrorCorrectionQuart),
	)
	if err != nil {
		return nil, fmt.Errorf("qr: failed to create QR code: %w", err)
	}

	var buf bytes.Buffer
	w := standard.NewWithWriter(
		nopCloser{&buf},
		standard.WithQRWidth(cfg.QRWidth),
		standard.WithBorderWidth(cfg.BorderWidth),
		standard.WithFgColorRGBHex(cfg.FgColor),
		standard.WithBgColorRGBHex(cfg.BgColor),
		standard.WithBuiltinImageEncoder(standard.PNG_FORMAT),
	)

	if err := qrc.Save(w); err != nil {
		return nil, fmt.Errorf("qr: failed to save QR image: %w", err)
	}

	return buf.Bytes(), nil
}

// GenerateGuestQRCodes generates all QR code images for a single guest based
// on the requested QR types. It returns a map from QR type byte to PNG image
// bytes.
//
// Each QR code contains a signed payload with the guest's event ID, guest ID,
// the QR type, and a creation timestamp.
func GenerateGuestQRCodes(eventID, guestID string, qrTypes []byte, hmacSecret []byte, cfg GeneratorConfig) (map[byte][]byte, error) {
	result := make(map[byte][]byte, len(qrTypes))

	for _, qrType := range qrTypes {
		payload := Payload{
			Version:   PayloadVersion,
			QRType:    qrType,
			EventID:   eventID,
			GuestID:   guestID,
			Timestamp: time.Now().Unix(),
		}

		encoded, err := EncodePayload(payload, hmacSecret)
		if err != nil {
			return nil, fmt.Errorf("qr: failed to encode payload for type %s: %w", QRTypeName(qrType), err)
		}

		imgBytes, err := GenerateQRImage(encoded, cfg)
		if err != nil {
			return nil, fmt.Errorf("qr: failed to generate image for type %s: %w", QRTypeName(qrType), err)
		}

		result[qrType] = imgBytes
	}

	return result, nil
}
