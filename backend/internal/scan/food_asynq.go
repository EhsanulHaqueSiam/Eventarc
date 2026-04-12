package scan

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// TaskFoodScanPGWrite is the asynq task type for writing food scans to PG.
	TaskFoodScanPGWrite = "food_scan:pg_write"

	// TaskFoodScanConvexSync is the asynq task type for syncing food scans to Convex.
	TaskFoodScanConvexSync = "food_scan:convex_sync"
)

// FoodScanPGPayload is the asynq task payload for PG write.
type FoodScanPGPayload struct {
	IdempotencyKey   string `json:"idempotency_key"`
	EventID          string `json:"event_id"`
	GuestID          string `json:"guest_id"`
	FoodCategoryID   string `json:"food_category_id"`
	StallID          string `json:"stall_id"`
	ScannedAt        string `json:"scanned_at"`
	DeviceID         string `json:"device_id"`
	GuestCategory    string `json:"guest_category"`
	IsAnonymous      bool   `json:"is_anonymous"`
	ConsumptionCount int    `json:"consumption_count"`
	Status           string `json:"status"`
}

// NewFoodScanPGWriteTask creates an asynq task for writing a food scan to PG.
func NewFoodScanPGWriteTask(payload FoodScanPGPayload) (*asynq.Task, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal food scan pg payload: %w", err)
	}
	return asynq.NewTask(TaskFoodScanPGWrite, data,
		asynq.MaxRetry(5),
		asynq.Queue("pg-writes"),
		asynq.Timeout(10*time.Second),
	), nil
}

// HandleFoodScanPGWrite processes the asynq task to write a food scan to PG.
// Uses INSERT ON CONFLICT (idempotency_key) DO NOTHING for idempotent writes.
func HandleFoodScanPGWrite(pool *pgxpool.Pool) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var payload FoodScanPGPayload
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return fmt.Errorf("unmarshal food scan pg payload: %w", err)
		}

		scannedAt, err := time.Parse(time.RFC3339, payload.ScannedAt)
		if err != nil {
			return fmt.Errorf("parse scanned_at: %w", err)
		}

		// Use raw query matching sqlc InsertFoodScan pattern
		_, err = pool.Exec(ctx,
			`INSERT INTO food_scans (idempotency_key, event_id, guest_id, food_category_id, stall_id, scanned_at, device_id, guest_category, is_anonymous, consumption_count, status)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			 ON CONFLICT (idempotency_key) DO NOTHING`,
			payload.IdempotencyKey,
			payload.EventID,
			payload.GuestID,
			payload.FoodCategoryID,
			payload.StallID,
			scannedAt,
			payload.DeviceID,
			payload.GuestCategory,
			payload.IsAnonymous,
			payload.ConsumptionCount,
			payload.Status,
		)
		if err != nil {
			slog.Error("food scan pg write failed", "error", err, "idempotency_key", payload.IdempotencyKey)
			return err // asynq will retry
		}

		slog.Info("food scan pg write complete",
			"event_id", payload.EventID,
			"guest_id", payload.GuestID,
			"food_category_id", payload.FoodCategoryID,
		)
		return nil
	}
}
