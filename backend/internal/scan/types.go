package scan

// ScanRequest is the JSON request body for POST /api/v1/scan/entry.
type ScanRequest struct {
	QRPayload string `json:"qr_payload"`
	StallID   string `json:"stall_id"`
	DeviceID  string `json:"device_id"`
}

// ScanResult is the JSON response body for a processed scan.
type ScanResult struct {
	Status   string    `json:"status"`                  // "valid" or "duplicate"
	Guest    *GuestInfo `json:"guest,omitempty"`
	Scan     *ScanInfo  `json:"scan,omitempty"`
	Original *ScanInfo  `json:"original_scan,omitempty"` // populated for duplicates
	Message  string    `json:"message,omitempty"`
}

// GuestInfo holds guest details returned in scan responses.
type GuestInfo struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	PhotoURL string `json:"photo_url"`
}

// ScanInfo holds scan metadata (timestamp, location).
type ScanInfo struct {
	CheckedInAt string `json:"checked_in_at"`
	StallID     string `json:"stall_id"`
	DeviceID    string `json:"device_id"`
}

// CheckInDetails holds the original check-in record retrieved from Redis.
type CheckInDetails struct {
	Timestamp string
	StallID   string
	DeviceID  string
	Status    string
}
