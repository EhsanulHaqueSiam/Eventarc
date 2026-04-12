-- Add guest_category column for per-category counter reconciliation
ALTER TABLE entry_scans ADD COLUMN IF NOT EXISTS guest_category TEXT NOT NULL DEFAULT '';

-- Unique compound index: one entry scan per guest per event (belt-and-suspenders with idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_entry_scans_event_guest ON entry_scans(event_id, guest_id);

-- Index for counter reconciliation queries (re-seed from PG)
CREATE INDEX IF NOT EXISTS idx_entry_scans_reconcile ON entry_scans(event_id, status, guest_category);

-- Index for looking up check-in details by guest (duplicate response)
CREATE INDEX IF NOT EXISTS idx_entry_scans_guest_lookup ON entry_scans(event_id, guest_id, scanned_at DESC);
