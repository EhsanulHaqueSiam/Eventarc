#!/usr/bin/env bash
set -euo pipefail

# Load Test Runner for Phase 4: Scan Processing Core
# Prerequisites: Docker, k6, Go
# Usage: ./backend/tests/load/run.sh [--count 15000] [--vus 10000] [--duration 30s]

COUNT="${1:-15000}"
EVENT_ID="load_test_$(date +%s)"
HMAC_SECRET="load_test_hmac_secret"
BASE_URL="http://localhost:8080"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_DIR="$(cd "$BACKEND_DIR/.." && pwd)"
DATABASE_URL="postgres://eventarc:dev_password@localhost:5432/eventarc?sslmode=disable"

echo "=== Phase 4 Load Test ==="
echo "Guests: $COUNT"
echo "Event: $EVENT_ID"
echo "Backend: $BACKEND_DIR"

# Step 1: Ensure infrastructure is running
echo ">>> Starting infrastructure..."
cd "$PROJECT_DIR"
docker compose up -d postgres pgbouncer redis
echo "Waiting for services to be healthy..."
sleep 5

# Step 2: Run migrations
echo ">>> Running migrations..."
# Apply migrations using psql or golang-migrate if available
if command -v migrate &> /dev/null; then
  migrate -path "$BACKEND_DIR/migrations" -database "$DATABASE_URL" up
else
  echo "  [WARN] golang-migrate not found. Ensure migrations are applied manually."
  # Fallback: apply via psql
  for f in "$BACKEND_DIR"/migrations/*.up.sql; do
    echo "  Applying: $(basename "$f")"
    psql "$DATABASE_URL" -f "$f" 2>/dev/null || true
  done
fi

# Step 3: Start server (background)
echo ">>> Starting server..."
cd "$BACKEND_DIR"
HMAC_SECRET=$HMAC_SECRET DATABASE_URL="$DATABASE_URL" go run ./cmd/server &
SERVER_PID=$!
sleep 3

# Verify server is running
if ! curl -sf "$BASE_URL/api/v1/health" > /dev/null 2>&1; then
  echo "ERROR: Server did not start successfully"
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi
echo "  Server running (PID: $SERVER_PID)"

# Step 4: Seed test data
echo ">>> Seeding $COUNT guests..."
cd "$BACKEND_DIR"
go run ./tests/load/seed.go \
  -count "$COUNT" \
  -event "$EVENT_ID" \
  -hmac-secret "$HMAC_SECRET" \
  -output "$SCRIPT_DIR/payloads.json"

# Step 5: Start worker (background)
echo ">>> Starting worker..."
cd "$BACKEND_DIR"
HMAC_SECRET=$HMAC_SECRET DATABASE_URL="$DATABASE_URL" go run ./cmd/worker &
WORKER_PID=$!
sleep 2
echo "  Worker running (PID: $WORKER_PID)"

# Step 6: Run k6 load test
echo ">>> Running k6 load test..."
k6 run --env BASE_URL="$BASE_URL" "$SCRIPT_DIR/scan_load_test.js"
K6_EXIT=$?

# Step 7: Wait for async PG writes to complete
echo ">>> Waiting for async PG writes (10s)..."
sleep 10

# Step 8: Verify counter reconciliation
echo ">>> Verifying counter reconciliation..."
REDIS_ATTENDANCE=$(redis-cli HGET "counters:$EVENT_ID" attendance 2>/dev/null || echo "UNAVAILABLE")
PG_COUNT=$(psql -t -A -c "SELECT COUNT(*) FROM entry_scans WHERE event_id='$EVENT_ID' AND status='valid'" "$DATABASE_URL" 2>/dev/null || echo "UNAVAILABLE")

echo "  Redis attendance: $REDIS_ATTENDANCE"
echo "  PG scan count: $PG_COUNT"

RECONCILIATION_PASS=true
if [ "$REDIS_ATTENDANCE" = "UNAVAILABLE" ] || [ "$PG_COUNT" = "UNAVAILABLE" ]; then
  echo "  [WARN] Could not verify reconciliation (service unavailable)"
  RECONCILIATION_PASS=false
elif [ "$REDIS_ATTENDANCE" != "$PG_COUNT" ]; then
  echo "  [FAIL] Counter mismatch (Redis=$REDIS_ATTENDANCE, PG=$PG_COUNT)"
  RECONCILIATION_PASS=false
else
  echo "  [PASS] Counters match"
fi

# Cleanup
echo ">>> Cleaning up..."
kill $SERVER_PID $WORKER_PID 2>/dev/null || true

# Clean up test data
rm -f "$SCRIPT_DIR/payloads.json"

echo ""
echo "=== Load Test Complete ==="
echo "  k6 exit code: $K6_EXIT"
echo "  Reconciliation: $([ "$RECONCILIATION_PASS" = true ] && echo "PASS" || echo "FAIL/SKIP")"

if [ "$K6_EXIT" -ne 0 ] || [ "$RECONCILIATION_PASS" = false ]; then
  exit 1
fi
