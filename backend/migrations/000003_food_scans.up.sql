-- Food scan records — durable storage for food consumption events.
-- Same dual-write pattern as entry_scans: Redis-first for speed, PG via background job.
CREATE TABLE IF NOT EXISTS food_scans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key   TEXT NOT NULL UNIQUE,
    event_id          TEXT NOT NULL,
    guest_id          TEXT NOT NULL,
    food_category_id  TEXT NOT NULL,
    stall_id          TEXT NOT NULL,
    scanned_at        TIMESTAMPTZ NOT NULL,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id         TEXT NOT NULL,
    guest_category    TEXT NOT NULL DEFAULT '',
    is_anonymous      BOOLEAN NOT NULL DEFAULT FALSE,
    consumption_count INTEGER NOT NULL DEFAULT 1,
    status            TEXT NOT NULL DEFAULT 'valid'
);

-- Per-event queries and dashboard metrics
CREATE INDEX idx_food_scans_event ON food_scans(event_id);

-- Per-guest per-category consumption reconciliation (re-seeding Redis after restart)
CREATE INDEX idx_food_scans_reconcile ON food_scans(event_id, guest_id, food_category_id, status);

-- Per-stall metrics
CREATE INDEX idx_food_scans_stall ON food_scans(event_id, stall_id, status);

-- Consumption history ordered by time (for rejection response D-08)
CREATE INDEX idx_food_scans_history ON food_scans(event_id, guest_id, food_category_id, scanned_at DESC);
