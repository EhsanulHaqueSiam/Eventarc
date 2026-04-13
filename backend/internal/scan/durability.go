package scan

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/ehsanul-haque-siam/eventarc/internal/convexsync"
)

// persistEntryScanDurably ensures accepted entry scans are persisted beyond Redis.
// It prefers asynq enqueue for throughput and falls back to direct writes on enqueue failure.
func (s *Service) persistEntryScanDurably(
	ctx context.Context,
	pgPayload PGWritePayload,
	convexPayload ConvexSyncPayload,
) error {
	pgQueued := false
	var pgErr error
	if s.asynqClient != nil {
		pgTask, taskErr := NewPGWriteTask(pgPayload)
		if taskErr != nil {
			pgErr = taskErr
		} else if _, enqErr := s.asynqClient.Enqueue(pgTask); enqErr != nil {
			pgErr = enqErr
			slog.Warn(
				"failed to enqueue PG write task; falling back to direct write",
				"error",
				enqErr,
				"event_id",
				pgPayload.EventID,
				"guest_id",
				pgPayload.GuestID,
			)
		} else {
			pgQueued = true
		}
	}

	if !pgQueued && s.pgStore != nil {
		scannedAt, parseErr := time.Parse(time.RFC3339, pgPayload.ScannedAt)
		if parseErr != nil {
			return fmt.Errorf("parse entry scanned_at: %w", parseErr)
		}
		_, err := s.pgStore.InsertEntryScan(ctx, InsertParams{
			EventID:          pgPayload.EventID,
			GuestID:          pgPayload.GuestID,
			StallID:          pgPayload.StallID,
			DeviceID:         pgPayload.DeviceID,
			ScannedAt:        scannedAt,
			GuestCategory:    pgPayload.GuestCategory,
			Status:           pgPayload.Status,
			AdditionalGuests: pgPayload.AdditionalGuests,
		})
		if err != nil {
			return fmt.Errorf("entry durable PG write failed: %w", err)
		}
		pgQueued = true
	}
	if !pgQueued && s.pgStore != nil && pgErr != nil {
		return fmt.Errorf("entry durable PG enqueue failed: %w", pgErr)
	}

	convexQueued := false
	var convexErr error
	if s.asynqClient != nil {
		convexTask, taskErr := NewConvexSyncTask(convexPayload)
		if taskErr != nil {
			convexErr = taskErr
		} else if _, enqErr := s.asynqClient.Enqueue(convexTask); enqErr != nil {
			convexErr = enqErr
			slog.Warn(
				"failed to enqueue Convex sync task; falling back to direct sync",
				"error",
				enqErr,
				"event_id",
				convexPayload.EventID,
				"guest_id",
				convexPayload.GuestID,
			)
		} else {
			convexQueued = true
		}
	}

	if !convexQueued && s.convexClient != nil && s.convexClient.IsConfigured() {
		if err := s.convexClient.SyncGuestCheckIn(
			ctx,
			convexPayload.EventID,
			convexPayload.GuestID,
			convexPayload.ScannedAt,
		); err != nil {
			return fmt.Errorf("entry durable Convex sync failed: %w", err)
		}
		convexQueued = true
	}
	if !convexQueued && s.convexClient != nil && s.convexClient.IsConfigured() && convexErr != nil {
		return fmt.Errorf("entry durable Convex enqueue failed: %w", convexErr)
	}

	if !pgQueued {
		slog.Warn(
			"entry scan accepted without PG durability sink",
			"event_id",
			pgPayload.EventID,
			"guest_id",
			pgPayload.GuestID,
		)
	}
	if !convexQueued {
		slog.Warn(
			"entry scan accepted without Convex durability sink",
			"event_id",
			convexPayload.EventID,
			"guest_id",
			convexPayload.GuestID,
		)
	}

	return nil
}

// persistFoodScanDurably ensures accepted food scans are persisted beyond Redis.
// It prefers asynq enqueue for throughput and falls back to direct writes on enqueue failure.
func (s *Service) persistFoodScanDurably(
	ctx context.Context,
	pgPayload FoodScanPGPayload,
	convexPayload FoodScanConvexPayload,
) error {
	pgQueued := false
	var pgErr error
	if s.asynqClient != nil {
		pgTask, taskErr := NewFoodScanPGWriteTask(pgPayload)
		if taskErr != nil {
			pgErr = taskErr
		} else if _, enqErr := s.asynqClient.Enqueue(pgTask); enqErr != nil {
			pgErr = enqErr
			slog.Warn(
				"failed to enqueue food scan PG write; falling back to direct write",
				"error",
				enqErr,
				"event_id",
				pgPayload.EventID,
				"guest_id",
				pgPayload.GuestID,
				"food_category_id",
				pgPayload.FoodCategoryID,
			)
		} else {
			pgQueued = true
		}
	}

	if !pgQueued && s.pgPool != nil {
		if err := writeFoodScanToPG(ctx, s.pgPool, pgPayload); err != nil {
			return fmt.Errorf("food durable PG write failed: %w", err)
		}
		pgQueued = true
	}
	if !pgQueued && s.pgPool != nil && pgErr != nil {
		return fmt.Errorf("food durable PG enqueue failed: %w", pgErr)
	}

	convexQueued := false
	var convexErr error
	if s.asynqClient != nil {
		convexTask, taskErr := NewFoodScanConvexSyncTask(convexPayload)
		if taskErr != nil {
			convexErr = taskErr
		} else if _, enqErr := s.asynqClient.Enqueue(convexTask); enqErr != nil {
			convexErr = enqErr
			slog.Warn(
				"failed to enqueue food scan Convex sync; falling back to direct sync",
				"error",
				enqErr,
				"event_id",
				convexPayload.EventID,
				"guest_id",
				convexPayload.GuestID,
				"food_category_id",
				convexPayload.FoodCategoryID,
			)
		} else {
			convexQueued = true
		}
	}

	if !convexQueued && s.convexClient != nil && s.convexClient.IsConfigured() {
		if err := s.convexClient.SyncFoodConsumption(ctx, convexsync.FoodConsumptionSyncPayload{
			IdempotencyKey:   convexPayload.IdempotencyKey,
			EventID:          convexPayload.EventID,
			GuestID:          convexPayload.GuestID,
			FoodCategoryID:   convexPayload.FoodCategoryID,
			StallID:          convexPayload.StallID,
			ScannedAt:        convexPayload.ScannedAt,
			DeviceID:         convexPayload.DeviceID,
			GuestCategory:    convexPayload.GuestCategory,
			IsAnonymous:      convexPayload.IsAnonymous,
			ConsumptionCount: convexPayload.ConsumptionCount,
			Status:           convexPayload.Status,
		}); err != nil {
			return fmt.Errorf("food durable Convex sync failed: %w", err)
		}
		convexQueued = true
	}
	if !convexQueued && s.convexClient != nil && s.convexClient.IsConfigured() && convexErr != nil {
		return fmt.Errorf("food durable Convex enqueue failed: %w", convexErr)
	}

	if !pgQueued {
		slog.Warn(
			"food scan accepted without PG durability sink",
			"event_id",
			pgPayload.EventID,
			"guest_id",
			pgPayload.GuestID,
			"food_category_id",
			pgPayload.FoodCategoryID,
		)
	}
	if !convexQueued {
		slog.Warn(
			"food scan accepted without Convex durability sink",
			"event_id",
			convexPayload.EventID,
			"guest_id",
			convexPayload.GuestID,
			"food_category_id",
			convexPayload.FoodCategoryID,
		)
	}

	return nil
}
