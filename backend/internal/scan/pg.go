package scan

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ehsanul-haque-siam/eventarc/internal/db"
)

// PGStore wraps the sqlc-generated Queries for scan-specific operations.
type PGStore struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

// NewPGStore creates a new PG persistence layer for scan records.
func NewPGStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{
		pool:    pool,
		queries: db.New(pool),
	}
}

// InsertParams holds the parameters for inserting a scan record.
type InsertParams struct {
	EventID       string
	GuestID       string
	StallID       string
	DeviceID      string
	ScannedAt     time.Time
	GuestCategory string
	Status        string
}

// InsertEntryScan writes a scan record to PG using INSERT ON CONFLICT DO NOTHING.
// Returns the inserted row if new, or nil if conflict (idempotent).
// Idempotency key format: "entry:{eventId}:{guestId}"
func (s *PGStore) InsertEntryScan(ctx context.Context, params InsertParams) (*db.EntryScan, error) {
	idempotencyKey := fmt.Sprintf("entry:%s:%s", params.EventID, params.GuestID)

	row, err := s.queries.InsertEntryScan(ctx, db.InsertEntryScanParams{
		IdempotencyKey: idempotencyKey,
		EventID:        params.EventID,
		GuestID:        params.GuestID,
		StallID:        params.StallID,
		ScannedAt:      pgtype.Timestamptz{Time: params.ScannedAt, Valid: true},
		DeviceID:       params.DeviceID,
		Status:         params.Status,
		GuestCategory:  params.GuestCategory,
	})
	if err != nil {
		// ON CONFLICT DO NOTHING returns no rows — pgx returns ErrNoRows
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("pg insert entry scan: %w", err)
	}
	return &row, nil
}

// GetExistingCheckIn looks up an existing check-in for duplicate detection fallback.
// Used when Redis has no data (after restart) but PG has the record.
func (s *PGStore) GetExistingCheckIn(ctx context.Context, eventID, guestID string) (*db.EntryScan, error) {
	row, err := s.queries.GetEntryScanByGuest(ctx, db.GetEntryScanByGuestParams{
		EventID: eventID,
		GuestID: guestID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("pg get existing check-in: %w", err)
	}
	return &row, nil
}

// CountByEvent returns the total number of valid scans for an event.
func (s *PGStore) CountByEvent(ctx context.Context, eventID string) (int64, error) {
	count, err := s.queries.CountEntryScansByEvent(ctx, eventID)
	if err != nil {
		return 0, fmt.Errorf("pg count entry scans: %w", err)
	}
	return count, nil
}

// CountByCategory returns per-category scan counts for an event.
func (s *PGStore) CountByCategory(ctx context.Context, eventID string) ([]db.CountEntryScansByCategoryRow, error) {
	rows, err := s.queries.CountEntryScansByCategory(ctx, eventID)
	if err != nil {
		return nil, fmt.Errorf("pg count by category: %w", err)
	}
	return rows, nil
}

// GetCheckedInGuestIDs returns all guest IDs with valid check-ins for an event.
func (s *PGStore) GetCheckedInGuestIDs(ctx context.Context, eventID string) ([]string, error) {
	ids, err := s.queries.GetCheckedInGuestIDs(ctx, eventID)
	if err != nil {
		return nil, fmt.Errorf("pg get checked-in guest ids: %w", err)
	}
	return ids, nil
}
