package model

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

// DeviceSession represents a vendor scanning device session.
// Stored in Redis as JSON at key "session:{token}".
type DeviceSession struct {
	Token            string    `json:"token"`
	StallID          string    `json:"stallId"`
	EventID          string    `json:"eventId"`
	VendorCategoryID string    `json:"vendorCategoryId"`
	VendorTypeID     string    `json:"vendorTypeId"`
	CreatedAt        time.Time `json:"createdAt"`
}

// GenerateSessionToken creates a cryptographically random 64-character hex string (32 bytes).
func GenerateSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	return hex.EncodeToString(b), nil
}
