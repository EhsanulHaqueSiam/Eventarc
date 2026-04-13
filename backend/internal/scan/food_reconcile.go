package scan

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// ReconcileFoodCounters re-seeds Redis food counters and consumption state from PG.
// Called on server startup when Redis food counter keys are missing, or manually
// via POST /api/v1/admin/reseed-food-counters.
//
// Re-seed order:
//  1. Per-guest consumption counts (critical — prevents over-serving after Redis restart)
//  2. Dashboard food counters (per-category served, per-stall served)
//  3. Consumption log is NOT re-seeded (it's a convenience feature, not critical for correctness)
//
// Note: Food rules and anonymous token metadata come from Convex sync, not PG.
// The sync endpoint must be called separately to re-seed those.
func (s *Service) ReconcileFoodCounters(ctx context.Context, eventID string) error {
	if s.pgPool == nil {
		return fmt.Errorf("food reconcile: pgPool is nil")
	}

	// Step 1: Re-seed per-guest consumption from PG
	guestRecordCount, err := s.reseedGuestConsumption(ctx, eventID)
	if err != nil {
		return fmt.Errorf("food reconcile: guest consumption: %w", err)
	}

	// Step 2: Re-seed dashboard food counters
	categoryCount, stallCount, err := s.reseedDashboardFoodCounters(ctx, eventID)
	if err != nil {
		return fmt.Errorf("food reconcile: dashboard counters: %w", err)
	}

	// Step 3: Mark food counters as initialized
	if err := s.MarkFoodCountersInitialized(ctx, eventID); err != nil {
		return fmt.Errorf("food reconcile: mark initialized: %w", err)
	}

	slog.Info("food counters reconciled",
		"event_id", eventID,
		"guest_consumption_records", guestRecordCount,
		"category_counters", categoryCount,
		"stall_counters", stallCount,
	)
	return nil
}

// reseedGuestConsumption rebuilds per-guest per-food-category consumption hashes.
func (s *Service) reseedGuestConsumption(ctx context.Context, eventID string) (int, error) {
	rows, err := s.pgPool.Query(ctx,
		`SELECT guest_id, food_category_id, COUNT(*)::integer as consumed
		 FROM food_scans WHERE event_id = $1 AND status = 'valid'
		 GROUP BY guest_id, food_category_id`, eventID)
	if err != nil {
		return 0, fmt.Errorf("query guest consumption: %w", err)
	}
	defer rows.Close()

	pipe := s.redis.Pipeline()
	count := 0
	for rows.Next() {
		var guestID, foodCategoryID string
		var consumed int
		if err := rows.Scan(&guestID, &foodCategoryID, &consumed); err != nil {
			return 0, fmt.Errorf("scan guest consumption row: %w", err)
		}

		// Use same key format as food_service.go
		// Guest-linked: food:{eventId}:{guestId}
		// Anonymous guests have their guestID prefixed differently in PG,
		// but for reconciliation we use the stored guest_id as-is
		key := FoodConsumptionKey(eventID, guestID)
		pipe.HSet(ctx, key, foodCategoryID, consumed)
		count++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate guest consumption rows: %w", err)
	}

	if count > 0 {
		_, err = pipe.Exec(ctx)
		if err != nil {
			return 0, fmt.Errorf("pipeline exec guest consumption: %w", err)
		}
	}

	return count, nil
}

// reseedDashboardFoodCounters rebuilds per-category and per-stall served totals.
func (s *Service) reseedDashboardFoodCounters(ctx context.Context, eventID string) (int, int, error) {
	counterKey := CountersKey(eventID)
	pipe := s.redis.Pipeline()

	// Per-category totals
	catRows, err := s.pgPool.Query(ctx,
		`SELECT food_category_id, COUNT(*)::integer as total_served
		 FROM food_scans WHERE event_id = $1 AND status = 'valid'
		 GROUP BY food_category_id`, eventID)
	if err != nil {
		return 0, 0, fmt.Errorf("query category counters: %w", err)
	}
	defer catRows.Close()

	categoryCount := 0
	for catRows.Next() {
		var categoryID string
		var count int
		if err := catRows.Scan(&categoryID, &count); err != nil {
			return 0, 0, fmt.Errorf("scan category counter row: %w", err)
		}
		pipe.HSet(ctx, counterKey, fmt.Sprintf("food:%s:served", categoryID), count)
		categoryCount++
	}
	if err := catRows.Err(); err != nil {
		return 0, 0, fmt.Errorf("iterate category counter rows: %w", err)
	}

	// Per-stall totals
	stallRows, err := s.pgPool.Query(ctx,
		`SELECT stall_id, COUNT(*)::integer as total_served
		 FROM food_scans WHERE event_id = $1 AND status = 'valid'
		 GROUP BY stall_id`, eventID)
	if err != nil {
		return 0, 0, fmt.Errorf("query stall counters: %w", err)
	}
	defer stallRows.Close()

	stallCount := 0
	for stallRows.Next() {
		var stallID string
		var count int
		if err := stallRows.Scan(&stallID, &count); err != nil {
			return 0, 0, fmt.Errorf("scan stall counter row: %w", err)
		}
		pipe.HSet(ctx, counterKey, fmt.Sprintf("stall:%s:served", stallID), count)
		stallCount++
	}
	if err := stallRows.Err(); err != nil {
		return 0, 0, fmt.Errorf("iterate stall counter rows: %w", err)
	}

	if categoryCount > 0 || stallCount > 0 {
		_, err = pipe.Exec(ctx)
		if err != nil {
			return 0, 0, fmt.Errorf("pipeline exec dashboard counters: %w", err)
		}
	}

	return categoryCount, stallCount, nil
}

// CheckFoodCountersExist returns true if food counter fields exist for the given event.
// Used to detect Redis restart and trigger reconciliation.
func (s *Service) CheckFoodCountersExist(ctx context.Context, eventID string) (bool, error) {
	counterKey := CountersKey(eventID)
	exists, err := s.redis.HExists(ctx, counterKey, "food:initialized").Result()
	return exists, err
}

// MarkFoodCountersInitialized sets a marker field after reconciliation completes.
func (s *Service) MarkFoodCountersInitialized(ctx context.Context, eventID string) error {
	counterKey := CountersKey(eventID)
	return s.redis.HSet(ctx, counterKey, "food:initialized", "1").Err()
}

// Ensure pgxpool and redis are used (compile-time check)
var (
	_ *pgxpool.Pool  = nil
	_ redis.Cmdable = (*redis.Client)(nil)
)
