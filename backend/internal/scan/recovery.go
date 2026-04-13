package scan

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
)

func (s *Service) ensureEntryCountersRecovered(ctx context.Context, eventID string) error {
	if s.pgStore == nil {
		return nil
	}
	reseedSvc := NewReseedService(s.redis, s.pgStore)
	if _, err := reseedSvc.CheckAndReseed(ctx, eventID); err != nil {
		return fmt.Errorf("entry counter recovery failed: %w", err)
	}
	return nil
}

func (s *Service) ensureFoodCountersRecovered(ctx context.Context, eventID string) error {
	if s.pgPool == nil {
		return nil
	}
	exists, err := s.CheckFoodCountersExist(ctx, eventID)
	if err != nil {
		return fmt.Errorf("food counter marker check failed: %w", err)
	}
	if exists {
		return nil
	}
	if err := s.ReconcileFoodCounters(ctx, eventID); err != nil {
		return fmt.Errorf("food counter recovery failed: %w", err)
	}
	return nil
}

// RunStartupRecovery performs automatic drift-recovery for all known events.
// It is safe to run at startup and idempotent across restarts.
func (s *Service) RunStartupRecovery(ctx context.Context) error {
	if s.pgStore == nil || s.pgPool == nil {
		return nil
	}

	eventIDs, err := s.collectRecoveryEventIDs(ctx)
	if err != nil {
		return err
	}
	if len(eventIDs) == 0 {
		return nil
	}

	reseedSvc := NewReseedService(s.redis, s.pgStore)
	var hadErrors bool

	for _, eventID := range eventIDs {
		if _, err := reseedSvc.CheckAndReseed(ctx, eventID); err != nil {
			hadErrors = true
			slog.Warn("startup entry counter recovery failed", "event_id", eventID, "error", err)
		}
		if err := s.ensureFoodCountersRecovered(ctx, eventID); err != nil {
			hadErrors = true
			slog.Warn("startup food counter recovery failed", "event_id", eventID, "error", err)
		}
	}

	slog.Info("startup drift recovery complete", "event_count", len(eventIDs))
	if hadErrors {
		return fmt.Errorf("startup drift recovery had one or more event-level failures")
	}
	return nil
}

func (s *Service) collectRecoveryEventIDs(ctx context.Context) ([]string, error) {
	eventSet := map[string]struct{}{}

	iter := s.redis.Scan(ctx, 0, "event:*", 1000).Iterator()
	for iter.Next(ctx) {
		key := iter.Val()
		if !strings.HasPrefix(key, "event:") {
			continue
		}
		eventID := strings.TrimPrefix(key, "event:")
		if eventID != "" {
			eventSet[eventID] = struct{}{}
		}
	}
	if err := iter.Err(); err != nil {
		return nil, fmt.Errorf("collect recovery event ids from redis: %w", err)
	}

	rows, err := s.pgPool.Query(ctx, `
		SELECT DISTINCT event_id FROM entry_scans
		UNION
		SELECT DISTINCT event_id FROM food_scans
	`)
	if err != nil {
		return nil, fmt.Errorf("collect recovery event ids from pg: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var eventID string
		if err := rows.Scan(&eventID); err != nil {
			return nil, fmt.Errorf("scan recovery event id: %w", err)
		}
		if eventID != "" {
			eventSet[eventID] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recovery event ids: %w", err)
	}

	eventIDs := make([]string, 0, len(eventSet))
	for eventID := range eventSet {
		eventIDs = append(eventIDs, eventID)
	}
	sort.Strings(eventIDs)
	return eventIDs, nil
}
