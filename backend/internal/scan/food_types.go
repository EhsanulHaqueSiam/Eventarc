package scan

// FoodScanRequest is the JSON body for POST /api/v1/scan/food.
type FoodScanRequest struct {
	QRPayload            string `json:"qr_payload"`
	QRPayloadLegacy      string `json:"qrPayload,omitempty"`
	StallID              string `json:"stall_id,omitempty"`
	StallIDLegacy        string `json:"stallId,omitempty"`
	DeviceID             string `json:"device_id,omitempty"`
	DeviceIDLegacy       string `json:"deviceId,omitempty"`
	FoodCategoryID       string `json:"food_category_id,omitempty"`
	FoodCategoryIDLegacy string `json:"foodCategoryId,omitempty"`
	SessionEventID       string `json:"-"`
}

// Normalize accepts legacy camelCase scanner clients while keeping the API
// contract canonicalized to snake_case for internal processing.
func (r *FoodScanRequest) Normalize() {
	if r.QRPayload == "" {
		r.QRPayload = r.QRPayloadLegacy
	}
	if r.StallID == "" {
		r.StallID = r.StallIDLegacy
	}
	if r.DeviceID == "" {
		r.DeviceID = r.DeviceIDLegacy
	}
	if r.FoodCategoryID == "" {
		r.FoodCategoryID = r.FoodCategoryIDLegacy
	}
}

// FoodScanResult is the JSON response for food scan endpoints.
type FoodScanResult struct {
	Status       string            `json:"status"` // "valid", "limit_reached", "no_rule"
	FoodCategory *FoodCategoryInfo `json:"food_category,omitempty"`
	Consumption  *ConsumptionInfo  `json:"consumption,omitempty"`
	Guest        *GuestInfo        `json:"guest,omitempty"` // reuse from types.go
	Scan         *ScanInfo         `json:"scan,omitempty"`  // reuse from types.go
	Message      string            `json:"message,omitempty"`
	History      []HistoryEntry    `json:"history,omitempty"` // populated on rejection
}

// FoodCategoryInfo identifies the food category being scanned.
type FoodCategoryInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ConsumptionInfo shows current consumption state against the limit.
type ConsumptionInfo struct {
	Current   int `json:"current"`   // how many servings consumed so far
	Limit     int `json:"limit"`     // max allowed (-1 for unlimited)
	Remaining int `json:"remaining"` // how many left (-1 for unlimited)
}

// HistoryEntry is a single consumption record shown in rejection responses.
type HistoryEntry struct {
	StallName  string `json:"stall_name"`
	StallID    string `json:"stall_id"`
	ConsumedAt string `json:"consumed_at"`
}
