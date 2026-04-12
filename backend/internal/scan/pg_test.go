//go:build integration

package scan

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// setupTestPG creates a real PostgreSQL connection for integration tests.
// Requires DATABASE_URL environment variable or defaults to local dev.
// These tests require Docker with PostgreSQL running (via docker-compose).
func setupTestPG(t *testing.T) *PGStore {
	t.Helper()
	ctx := context.Background()

	dbURL := "postgres://eventarc:dev_password@localhost:5432/eventarc?sslmode=disable"
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Skipf("PostgreSQL not available: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("PostgreSQL not reachable: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
	})

	return NewPGStore(pool)
}

func TestPGInsertEntryScan_New(t *testing.T) {
	store := setupTestPG(t)
	ctx := context.Background()

	params := InsertParams{
		EventID:       "pg_test_event_001",
		GuestID:       "pg_test_guest_001",
		StallID:       "pg_stall_A",
		DeviceID:      "pg_device_01",
		ScannedAt:     time.Now().UTC(),
		GuestCategory: "vip",
		Status:        "valid",
	}

	row, err := store.InsertEntryScan(ctx, params)
	if err != nil {
		t.Fatalf("insert failed: %v", err)
	}
	if row == nil {
		t.Fatal("expected non-nil row for new insert")
	}
	if row.EventID != params.EventID {
		t.Errorf("expected event_id %q, got %q", params.EventID, row.EventID)
	}
	if row.GuestID != params.GuestID {
		t.Errorf("expected guest_id %q, got %q", params.GuestID, row.GuestID)
	}
	if row.GuestCategory != "vip" {
		t.Errorf("expected guest_category 'vip', got %q", row.GuestCategory)
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", params.EventID)
}

func TestPGInsertEntryScan_Duplicate(t *testing.T) {
	store := setupTestPG(t)
	ctx := context.Background()

	params := InsertParams{
		EventID:       "pg_test_event_dup",
		GuestID:       "pg_test_guest_dup",
		StallID:       "pg_stall_B",
		DeviceID:      "pg_device_02",
		ScannedAt:     time.Now().UTC(),
		GuestCategory: "regular",
		Status:        "valid",
	}

	// First insert
	row1, err := store.InsertEntryScan(ctx, params)
	if err != nil {
		t.Fatalf("first insert failed: %v", err)
	}
	if row1 == nil {
		t.Fatal("first insert should return row")
	}

	// Second insert — same idempotency key, should return nil (DO NOTHING)
	row2, err := store.InsertEntryScan(ctx, params)
	if err != nil {
		t.Fatalf("second insert error: %v", err)
	}
	if row2 != nil {
		t.Error("expected nil for duplicate insert (ON CONFLICT DO NOTHING)")
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", params.EventID)
}

func TestPGInsertEntryScan_SameGuestDifferentEvent(t *testing.T) {
	store := setupTestPG(t)
	ctx := context.Background()

	guestID := "pg_test_guest_multi"

	params1 := InsertParams{
		EventID:       "pg_test_event_A",
		GuestID:       guestID,
		StallID:       "pg_stall_C",
		DeviceID:      "pg_device_03",
		ScannedAt:     time.Now().UTC(),
		GuestCategory: "staff",
		Status:        "valid",
	}
	params2 := InsertParams{
		EventID:       "pg_test_event_B",
		GuestID:       guestID,
		StallID:       "pg_stall_D",
		DeviceID:      "pg_device_04",
		ScannedAt:     time.Now().UTC(),
		GuestCategory: "staff",
		Status:        "valid",
	}

	row1, err := store.InsertEntryScan(ctx, params1)
	if err != nil {
		t.Fatalf("event A insert failed: %v", err)
	}
	if row1 == nil {
		t.Fatal("event A insert should return row")
	}

	row2, err := store.InsertEntryScan(ctx, params2)
	if err != nil {
		t.Fatalf("event B insert failed: %v", err)
	}
	if row2 == nil {
		t.Fatal("event B insert should return row (different event)")
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id IN ($1, $2)", params1.EventID, params2.EventID)
}

func TestPGGetExistingCheckIn(t *testing.T) {
	store := setupTestPG(t)
	ctx := context.Background()

	params := InsertParams{
		EventID:       "pg_test_event_get",
		GuestID:       "pg_test_guest_get",
		StallID:       "pg_stall_E",
		DeviceID:      "pg_device_05",
		ScannedAt:     time.Now().UTC(),
		GuestCategory: "vip",
		Status:        "valid",
	}

	_, err := store.InsertEntryScan(ctx, params)
	if err != nil {
		t.Fatalf("insert failed: %v", err)
	}

	existing, err := store.GetExistingCheckIn(ctx, params.EventID, params.GuestID)
	if err != nil {
		t.Fatalf("get existing failed: %v", err)
	}
	if existing == nil {
		t.Fatal("expected non-nil existing check-in")
	}
	if existing.StallID != "pg_stall_E" {
		t.Errorf("expected stall 'pg_stall_E', got %q", existing.StallID)
	}

	// Cleanup
	store.pool.Exec(ctx, "DELETE FROM entry_scans WHERE event_id = $1", params.EventID)
}

func TestPGGetExistingCheckIn_NotFound(t *testing.T) {
	store := setupTestPG(t)
	ctx := context.Background()

	existing, err := store.GetExistingCheckIn(ctx, "nonexistent_event", "nonexistent_guest")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if existing != nil {
		t.Error("expected nil for non-existent guest")
	}
}
