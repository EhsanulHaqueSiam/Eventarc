package scan

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/ehsanul-haque-siam/eventarc/internal/convexsync"
	"github.com/hibiken/asynq"
)

const (
	// TaskPGWrite persists a scan record to PostgreSQL.
	TaskPGWrite = "scan:pg-write"
	// TaskConvexSync syncs check-in status back to Convex.
	TaskConvexSync = "scan:convex-sync"
)

// PGWritePayload is the asynq task payload for async PG writes.
type PGWritePayload struct {
	EventID          string `json:"event_id"`
	GuestID          string `json:"guest_id"`
	StallID          string `json:"stall_id"`
	DeviceID         string `json:"device_id"`
	ScannedAt        string `json:"scanned_at"` // ISO 8601
	GuestCategory    string `json:"guest_category"`
	Status           string `json:"status"`
	AdditionalGuests int    `json:"additional_guests,omitempty"`
}

// ConvexSyncPayload is the asynq task payload for Convex sync-back.
type ConvexSyncPayload struct {
	EventID   string `json:"event_id"`
	GuestID   string `json:"guest_id"`
	Status    string `json:"status"`
	ScannedAt string `json:"scanned_at"`
}

// NewPGWriteTask creates an asynq task for async PG write.
func NewPGWriteTask(p PGWritePayload) (*asynq.Task, error) {
	payload, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("scan: marshal pg-write payload: %w", err)
	}
	return asynq.NewTask(TaskPGWrite, payload,
		asynq.MaxRetry(5),
		asynq.Queue("pg-writes"),
		asynq.Timeout(30*time.Second),
		asynq.Unique(1*time.Hour),
	), nil
}

// NewConvexSyncTask creates an asynq task for Convex sync-back.
func NewConvexSyncTask(p ConvexSyncPayload) (*asynq.Task, error) {
	payload, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("scan: marshal convex-sync payload: %w", err)
	}
	return asynq.NewTask(TaskConvexSync, payload,
		asynq.MaxRetry(5),
		asynq.Queue("convex-sync"),
		asynq.Timeout(10*time.Second),
	), nil
}

// HandlePGWrite processes the async PG write task.
// Calls PGStore.InsertEntryScan. Idempotent — ON CONFLICT DO NOTHING.
func HandlePGWrite(pgStore *PGStore) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var p PGWritePayload
		if err := json.Unmarshal(task.Payload(), &p); err != nil {
			return fmt.Errorf("scan: unmarshal pg-write payload: %w", err)
		}

		scannedAt, err := time.Parse(time.RFC3339, p.ScannedAt)
		if err != nil {
			return fmt.Errorf("scan: parse scanned_at: %w", err)
		}

		_, err = pgStore.InsertEntryScan(ctx, InsertParams{
			EventID:          p.EventID,
			GuestID:          p.GuestID,
			StallID:          p.StallID,
			DeviceID:         p.DeviceID,
			ScannedAt:        scannedAt,
			GuestCategory:    p.GuestCategory,
			Status:           p.Status,
			AdditionalGuests: p.AdditionalGuests,
		})
		if err != nil {
			return fmt.Errorf("scan: pg write failed: %w", err)
		}

		slog.Info("scan persisted to PG",
			"event_id", p.EventID,
			"guest_id", p.GuestID,
			"status", p.Status,
		)
		return nil
	}
}

// HandleConvexSync processes the Convex sync-back task.
// It pushes accepted check-ins to Convex over HMAC-signed HTTP endpoints.
func HandleConvexSync(convexClient *convexsync.Client) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var p ConvexSyncPayload
		if err := json.Unmarshal(task.Payload(), &p); err != nil {
			return fmt.Errorf("scan: unmarshal convex-sync payload: %w", err)
		}

		if convexClient == nil || !convexClient.IsConfigured() {
			slog.Warn("convex sync skipped: client not configured",
				"event_id", p.EventID,
				"guest_id", p.GuestID,
			)
			return nil
		}

		if err := convexClient.SyncGuestCheckIn(ctx, p.EventID, p.GuestID, p.ScannedAt); err != nil {
			return fmt.Errorf("scan: convex sync failed: %w", err)
		}

		slog.Info("scan synced to Convex",
			"event_id", p.EventID,
			"guest_id", p.GuestID,
			"status", p.Status,
		)
		return nil
	}
}
