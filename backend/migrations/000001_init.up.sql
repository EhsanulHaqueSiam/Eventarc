CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS entry_scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    event_id        TEXT NOT NULL,
    guest_id        TEXT NOT NULL,
    stall_id        TEXT NOT NULL,
    scanned_at      TIMESTAMPTZ NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'valid'
);

CREATE INDEX idx_entry_scans_event ON entry_scans(event_id);
CREATE INDEX idx_entry_scans_guest ON entry_scans(event_id, guest_id);

CREATE TABLE IF NOT EXISTS event_counters (
    event_id    TEXT NOT NULL,
    counter_key TEXT NOT NULL,
    value       BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, counter_key)
);
