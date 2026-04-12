package sse

import "time"

// SSEEvent represents a Server-Sent Event with id, event type, and JSON data.
type SSEEvent struct {
	ID    string `json:"id"`
	Event string `json:"event"` // "snapshot", "counters", "stall_activity", "alert", "heartbeat"
	Data  string `json:"data"`  // JSON-encoded payload
}

// DashboardSnapshot is the full state sent on initial connection.
type DashboardSnapshot struct {
	Attendance     AttendanceData      `json:"attendance"`
	Counters       map[string]int64    `json:"counters"`
	FoodCategories []FoodCategoryData  `json:"foodCategories"`
	Stalls         []StallActivityData `json:"stalls"`
	SystemHealth   SystemHealthData    `json:"systemHealth"`
}

// AttendanceData holds checked-in vs total counts and percentage.
type AttendanceData struct {
	CheckedIn    int64   `json:"checkedIn"`
	TotalInvited int64   `json:"totalInvited"`
	Percentage   float64 `json:"percentage"`
}

// FoodCategoryData holds per-category food consumption metrics.
type FoodCategoryData struct {
	Category       string           `json:"category"`
	Served         int64            `json:"served"`
	Limit          int64            `json:"limit,omitempty"` // 0 = unlimited
	StallBreakdown map[string]int64 `json:"stallBreakdown,omitempty"`
}

// StallActivityData holds per-stall scanning activity info.
type StallActivityData struct {
	StallID   string    `json:"stallId"`
	StallName string    `json:"stallName"`
	ScanCount int64     `json:"scanCount"`
	LastScan  time.Time `json:"lastScan"`
	Status    string    `json:"status"` // "active", "idle", "inactive"
}

// CounterUpdate carries incremental counter changes.
type CounterUpdate struct {
	Counters   map[string]int64 `json:"counters"`
	Attendance AttendanceData   `json:"attendance"`
}

// Alert represents a dashboard alert for admin attention.
type Alert struct {
	Type      string    `json:"type"`      // "duplicate_scan", "offline_device", "retroactive_rejection", "high_scan_rate", "counter_mismatch"
	Severity  string    `json:"severity"`  // "critical", "warning", "info"
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	Timestamp time.Time `json:"timestamp"`
}

// SystemHealthData holds system status for dashboard display.
type SystemHealthData struct {
	RedisConnected    bool  `json:"redisConnected"`
	PostgresConnected bool  `json:"postgresConnected"`
	ActiveSSEClients  int   `json:"activeSseClients"`
	UptimeSeconds     int64 `json:"uptimeSeconds"`
}
