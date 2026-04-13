package scan

// ScanRequest is the JSON request body for POST /api/v1/scan/entry.
type ScanRequest struct {
	QRPayload        string `json:"qr_payload"`
	QRPayloadLegacy  string `json:"qrPayload,omitempty"`
	StallID          string `json:"stall_id,omitempty"`
	StallIDLegacy    string `json:"stallId,omitempty"`
	DeviceID         string `json:"device_id,omitempty"`
	DeviceIDLegacy   string `json:"deviceId,omitempty"`
	AdditionalGuests int    `json:"additional_guests,omitempty"`
	SessionEventID   string `json:"-"`
}

// Normalize accepts legacy camelCase scanner clients while keeping the API
// contract canonicalized to snake_case for internal processing.
func (r *ScanRequest) Normalize() {
	if r.QRPayload == "" {
		r.QRPayload = r.QRPayloadLegacy
	}
	if r.StallID == "" {
		r.StallID = r.StallIDLegacy
	}
	if r.DeviceID == "" {
		r.DeviceID = r.DeviceIDLegacy
	}
}

// ScanResult is the JSON response body for a processed scan.
type ScanResult struct {
	Status           string     `json:"status"` // "valid" or "duplicate"
	Guest            *GuestInfo `json:"guest,omitempty"`
	Scan             *ScanInfo  `json:"scan,omitempty"`
	Original         *ScanInfo  `json:"original_scan,omitempty"` // populated for duplicates
	Message          string     `json:"message,omitempty"`
	AdditionalGuests int        `json:"additional_guests,omitempty"`
	TotalPersons     int        `json:"total_persons,omitempty"` // 1 + additional_guests
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
