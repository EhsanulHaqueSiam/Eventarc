package scan

// FoodScanRequest is the JSON body for POST /api/v1/scan/food.
type FoodScanRequest struct {
	QRPayload      string `json:"qr_payload"`
	StallID        string `json:"stall_id"`
	DeviceID       string `json:"device_id"`
	FoodCategoryID string `json:"food_category_id"`
}

// FoodScanResult is the JSON response for food scan endpoints.
type FoodScanResult struct {
	Status       string            `json:"status"`                  // "valid", "limit_reached", "no_rule"
	FoodCategory *FoodCategoryInfo `json:"food_category,omitempty"`
	Consumption  *ConsumptionInfo  `json:"consumption,omitempty"`
	Guest        *GuestInfo        `json:"guest,omitempty"`   // reuse from types.go
	Scan         *ScanInfo         `json:"scan,omitempty"`    // reuse from types.go
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
