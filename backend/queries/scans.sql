-- name: InsertEntryScan :one
INSERT INTO entry_scans (idempotency_key, event_id, guest_id, stall_id, scanned_at, device_id, status)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;

-- name: GetEntryScanByGuest :one
SELECT * FROM entry_scans
WHERE event_id = $1 AND guest_id = $2
LIMIT 1;
