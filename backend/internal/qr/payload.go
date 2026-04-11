package qr

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
)

// PayloadVersion is the current QR payload format version.
// Scanners check this first byte to determine how to parse the rest.
const PayloadVersion byte = 0x01

// QR type constants identify what kind of scan this QR code enables.
const (
	QRTypeEntry   byte = 0x01 // Entry gate scan
	QRTypeFood    byte = 0x02 // Food stall scan
	QRTypeUnified byte = 0x03 // Combined entry + food scan
)

// Minimum payload size: version(1) + type(1) + eventIDLen(1) + eventID(1 min) +
// guestIDLen(1) + guestID(1 min) + timestamp(8) + hmac(32) = 46 bytes
const minPayloadSize = 46

// hmacSize is the length of an HMAC-SHA256 digest.
const hmacSize = 32

var (
	// ErrInvalidSignature indicates the HMAC signature does not match the payload.
	ErrInvalidSignature = errors.New("qr: invalid HMAC signature")

	// ErrUnsupportedVersion indicates the payload version byte is not recognized.
	ErrUnsupportedVersion = errors.New("qr: unsupported payload version")

	// ErrInvalidQRType indicates the QR type byte is not a valid type.
	ErrInvalidQRType = errors.New("qr: invalid QR type")

	// ErrInvalidPayload indicates the payload bytes are malformed or too short.
	ErrInvalidPayload = errors.New("qr: malformed payload")

	// ErrEmptyField indicates a required field (EventID or GuestID) is empty.
	ErrEmptyField = errors.New("qr: empty required field")
)

// Payload holds the decoded contents of a QR code.
type Payload struct {
	Version   byte   // Always PayloadVersion
	QRType    byte   // QRTypeEntry, QRTypeFood, or QRTypeUnified
	EventID   string // Convex event document ID (variable length)
	GuestID   string // Convex guest document ID (variable length)
	Timestamp int64  // Unix epoch seconds (creation time)
}

// EncodePayload encodes a Payload into a compact binary format, signs it with
// HMAC-SHA256 using the provided secret, and returns the result as a
// Base64URL-encoded string suitable for embedding in a QR code.
//
// Binary layout:
//
//	[version:1][qrType:1][eventIDLen:1][eventID:N][guestIDLen:1][guestID:N][timestamp:8][hmac:32]
func EncodePayload(p Payload, hmacSecret []byte) (string, error) {
	if p.EventID == "" || p.GuestID == "" {
		return "", ErrEmptyField
	}
	if len(p.EventID) > 255 {
		return "", fmt.Errorf("%w: eventID exceeds 255 bytes", ErrInvalidPayload)
	}
	if len(p.GuestID) > 255 {
		return "", fmt.Errorf("%w: guestID exceeds 255 bytes", ErrInvalidPayload)
	}

	var buf bytes.Buffer

	// Version
	buf.WriteByte(p.Version)

	// QR Type
	buf.WriteByte(p.QRType)

	// EventID (length-prefixed)
	buf.WriteByte(byte(len(p.EventID)))
	buf.WriteString(p.EventID)

	// GuestID (length-prefixed)
	buf.WriteByte(byte(len(p.GuestID)))
	buf.WriteString(p.GuestID)

	// Timestamp (uint64 big-endian)
	ts := make([]byte, 8)
	binary.BigEndian.PutUint64(ts, uint64(p.Timestamp))
	buf.Write(ts)

	// Compute HMAC-SHA256 over the data portion
	sig := computeHMAC(buf.Bytes(), hmacSecret)
	buf.Write(sig)

	return base64.RawURLEncoding.EncodeToString(buf.Bytes()), nil
}

// DecodePayload decodes a Base64URL-encoded QR payload string, verifies its
// HMAC-SHA256 signature, and returns the parsed Payload.
func DecodePayload(encoded string, hmacSecret []byte) (Payload, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return Payload{}, fmt.Errorf("%w: base64 decode failed: %v", ErrInvalidPayload, err)
	}

	if len(raw) < minPayloadSize {
		return Payload{}, fmt.Errorf("%w: payload too short (%d bytes)", ErrInvalidPayload, len(raw))
	}

	// Split data and signature
	data := raw[:len(raw)-hmacSize]
	receivedMAC := raw[len(raw)-hmacSize:]

	// Verify HMAC (constant-time comparison)
	expectedMAC := computeHMAC(data, hmacSecret)
	if !hmac.Equal(expectedMAC, receivedMAC) {
		return Payload{}, ErrInvalidSignature
	}

	// Parse fields
	offset := 0

	// Version
	version := data[offset]
	offset++
	if version != PayloadVersion {
		return Payload{}, fmt.Errorf("%w: got 0x%02x", ErrUnsupportedVersion, version)
	}

	// QR Type
	qrType := data[offset]
	offset++
	if !isValidQRType(qrType) {
		return Payload{}, fmt.Errorf("%w: got 0x%02x", ErrInvalidQRType, qrType)
	}

	// EventID
	eventIDLen := int(data[offset])
	offset++
	if offset+eventIDLen > len(data) {
		return Payload{}, fmt.Errorf("%w: eventID length overflows", ErrInvalidPayload)
	}
	eventID := string(data[offset : offset+eventIDLen])
	offset += eventIDLen

	// GuestID
	if offset >= len(data) {
		return Payload{}, fmt.Errorf("%w: missing guestID length", ErrInvalidPayload)
	}
	guestIDLen := int(data[offset])
	offset++
	if offset+guestIDLen > len(data) {
		return Payload{}, fmt.Errorf("%w: guestID length overflows", ErrInvalidPayload)
	}
	guestID := string(data[offset : offset+guestIDLen])
	offset += guestIDLen

	// Timestamp
	if offset+8 > len(data) {
		return Payload{}, fmt.Errorf("%w: missing timestamp", ErrInvalidPayload)
	}
	timestamp := int64(binary.BigEndian.Uint64(data[offset : offset+8]))

	return Payload{
		Version:   version,
		QRType:    qrType,
		EventID:   eventID,
		GuestID:   guestID,
		Timestamp: timestamp,
	}, nil
}

// DetermineQRTypes returns the QR type bytes that should be generated for a
// guest based on the event's QR strategy and food QR mode.
//
// - "unified" strategy: one QR code (QRTypeUnified) regardless of food mode
// - "separate" strategy: two QR codes (QRTypeEntry + QRTypeFood)
func DetermineQRTypes(qrStrategy, foodQrMode string) []byte {
	if qrStrategy == "unified" {
		return []byte{QRTypeUnified}
	}
	// separate strategy: entry + food
	return []byte{QRTypeEntry, QRTypeFood}
}

// QRTypeName returns a human-readable name for a QR type byte.
func QRTypeName(qrType byte) string {
	switch qrType {
	case QRTypeEntry:
		return "entry"
	case QRTypeFood:
		return "food"
	case QRTypeUnified:
		return "unified"
	default:
		return "unknown"
	}
}

// computeHMAC calculates the HMAC-SHA256 of data using the given secret.
func computeHMAC(data, secret []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write(data)
	return mac.Sum(nil)
}

// isValidQRType checks if a byte is a recognized QR type.
func isValidQRType(t byte) bool {
	return t == QRTypeEntry || t == QRTypeFood || t == QRTypeUnified
}
