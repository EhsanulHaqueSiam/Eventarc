-- name: InsertFoodScan :one
INSERT INTO food_scans (
    idempotency_key, event_id, guest_id, food_category_id,
    stall_id, scanned_at, device_id, guest_category,
    is_anonymous, consumption_count, status
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;

-- name: GetFoodConsumptionHistory :many
SELECT food_category_id, stall_id, scanned_at
FROM food_scans
WHERE event_id = $1
  AND guest_id = $2
  AND food_category_id = $3
  AND status = 'valid'
ORDER BY scanned_at DESC
LIMIT 10;

-- name: GetFoodConsumptionCounts :many
SELECT food_category_id, COUNT(*)::integer as count
FROM food_scans
WHERE event_id = $1
  AND guest_id = $2
  AND status = 'valid'
GROUP BY food_category_id;

-- name: GetFoodCountersByCategory :many
SELECT food_category_id, COUNT(*)::integer as total_served
FROM food_scans
WHERE event_id = $1
  AND status = 'valid'
GROUP BY food_category_id;

-- name: GetFoodCountersByStall :many
SELECT stall_id, COUNT(*)::integer as total_served
FROM food_scans
WHERE event_id = $1
  AND status = 'valid'
GROUP BY stall_id;

-- name: GetFoodConsumptionPerGuest :many
SELECT guest_id, food_category_id, COUNT(*)::integer as consumed
FROM food_scans
WHERE event_id = $1
  AND status = 'valid'
GROUP BY guest_id, food_category_id;
