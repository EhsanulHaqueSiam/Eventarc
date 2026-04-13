package scan

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// ReseedService handles Redis counter re-seeding from PostgreSQL.
type ReseedService struct {
	redis   *redis.Client
	pgStore *PGStore
}

// NewReseedService creates a new counter re-seeding service.
func NewReseedService(redisClient *redis.Client, pgStore *PGStore) *ReseedService {
	return &ReseedService{
		redis:   redisClient,
		pgStore: pgStore,
	}
}

// ReseedEventCounters re-seeds all Redis counters for a given event from PG data.
// Uses MULTI/EXEC transaction (TxPipelined) to write all counter values atomically —
// prevents dashboard from reading partial state during re-seed.
//
// Re-seeds: attendance counter, per-category counters, checked-in set.
func (r *ReseedService) ReseedEventCounters(ctx context.Context, eventID string) error {
	// Query PG for total attendance
	totalCount, err := r.pgStore.CountByEvent(ctx, eventID)
	if err != nil {
		return fmt.Errorf("reseed: count by event: %w", err)
	}

	// Query PG for per-category counts
	categoryCounts, err := r.pgStore.CountByCategory(ctx, eventID)
	if err != nil {
		return fmt.Errorf("reseed: count by category: %w", err)
	}

	// Query PG for checked-in guest IDs
	guestIDs, err := r.pgStore.GetCheckedInGuestIDs(ctx, eventID)
	if err != nil {
		return fmt.Errorf("reseed: get guest ids: %w", err)
	}

	countersKey := CountersKey(eventID)
	checkedInKey := CheckedInKey(eventID)

	// Atomic re-seed using MULTI/EXEC pipeline
	_, err = r.redis.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		// Clean slate
		pipe.Del(ctx, countersKey)
		pipe.Del(ctx, checkedInKey)

		// Set attendance counter
		pipe.HSet(ctx, countersKey, "attendance", totalCount)

		// Set per-category counters
		for _, cat := range categoryCounts {
			if cat.GuestCategory != "" {
				pipe.HSet(ctx, countersKey, cat.GuestCategory+":checkedin", cat.Total)
			}
		}

		// Rebuild checked-in set
		for _, guestID := range guestIDs {
			pipe.SAdd(ctx, checkedInKey, guestID)
		}

		return nil
	})
	if err != nil {
		return fmt.Errorf("reseed: redis tx pipeline: %w", err)
	}

	slog.Info("counters re-seeded from PG",
		"event_id", eventID,
		"attendance", totalCount,
		"categories", len(categoryCounts),
		"guests", len(guestIDs),
	)
	return nil
}

// CheckAndReseed checks if counters exist for an event in Redis.
// If missing (Redis was restarted), triggers ReseedEventCounters.
// Returns true if re-seed was needed and performed.
func (r *ReseedService) CheckAndReseed(ctx context.Context, eventID string) (bool, error) {
	countersKey := CountersKey(eventID)
	checkedInKey := CheckedInKey(eventID)

	// Check if counters hash exists
	countersExist, err := r.redis.Exists(ctx, countersKey).Result()
	if err != nil {
		return false, fmt.Errorf("reseed: check counters exist: %w", err)
	}

	// Check if checked-in set exists
	setCard, err := r.redis.SCard(ctx, checkedInKey).Result()
	if err != nil {
		return false, fmt.Errorf("reseed: check set cardinality: %w", err)
	}

	// If counters exist and set has members, no re-seed needed
	if countersExist > 0 && setCard > 0 {
		return false, nil
	}

	// Check if PG actually has records for this event
	pgCount, err := r.pgStore.CountByEvent(ctx, eventID)
	if err != nil {
		return false, fmt.Errorf("reseed: pg count check: %w", err)
	}

	// If PG has no records either, nothing to re-seed
	if pgCount == 0 {
		return false, nil
	}

	// Counters missing but PG has data — re-seed needed
	slog.Info("counters missing, triggering re-seed",
		"event_id", eventID,
		"counters_exist", countersExist > 0,
		"set_card", setCard,
		"pg_count", pgCount,
	)

	if err := r.ReseedEventCounters(ctx, eventID); err != nil {
		return false, err
	}
	return true, nil
}

// ReseedCheckedInSet rebuilds the checkedin:{eventId} set from PG entry_scans.
// Critical for duplicate detection after Redis restart.
func (r *ReseedService) ReseedCheckedInSet(ctx context.Context, eventID string) error {
	guestIDs, err := r.pgStore.GetCheckedInGuestIDs(ctx, eventID)
	if err != nil {
		return fmt.Errorf("reseed set: get guest ids: %w", err)
	}

	checkedInKey := CheckedInKey(eventID)

	_, err = r.redis.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Del(ctx, checkedInKey)
		for _, guestID := range guestIDs {
			pipe.SAdd(ctx, checkedInKey, guestID)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("reseed set: redis tx pipeline: %w", err)
	}

	slog.Info("checked-in set re-seeded",
		"event_id", eventID,
		"guests", len(guestIDs),
	)
	return nil
}

// HandleReseedCounters returns an HTTP-compatible function for admin-triggered re-seeding.
// This is used by the admin endpoint POST /api/v1/admin/reseed-counters.
func (r *ReseedService) HandleReseedCounters(ctx context.Context, eventID string) (map[string]string, error) {
	if err := r.ReseedEventCounters(ctx, eventID); err != nil {
		return nil, err
	}

	// Read back the re-seeded values for confirmation
	countersKey := CountersKey(eventID)
	checkedInKey := CheckedInKey(eventID)

	attendance, _ := r.redis.HGet(ctx, countersKey, "attendance").Result()
	setCard, _ := r.redis.SCard(ctx, checkedInKey).Result()

	return map[string]string{
		"event_id":   eventID,
		"attendance": attendance,
		"set_size":   strconv.FormatInt(setCard, 10),
		"status":     "reseeded",
	}, nil
}
