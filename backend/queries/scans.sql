-- name: InsertEntryScan :one
INSERT INTO entry_scans (idempotency_key, event_id, guest_id, stall_id, scanned_at, device_id, status, guest_category)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;

-- name: GetEntryScanByGuest :one
SELECT * FROM entry_scans
WHERE event_id = $1 AND guest_id = $2
ORDER BY scanned_at DESC
LIMIT 1;

-- name: CountEntryScansByEvent :one
SELECT COUNT(*) as total FROM entry_scans
WHERE event_id = $1 AND status = 'valid';

-- name: CountEntryScansByCategory :many
SELECT guest_category, COUNT(*) as total
FROM entry_scans
WHERE event_id = $1 AND status = 'valid'
GROUP BY guest_category;

-- name: UpsertEventCounter :exec
INSERT INTO event_counters (event_id, counter_key, value, updated_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (event_id, counter_key) DO UPDATE
SET value = $3, updated_at = NOW();

-- name: GetCheckedInGuestIDs :many
SELECT guest_id FROM entry_scans
WHERE event_id = $1 AND status = 'valid';
