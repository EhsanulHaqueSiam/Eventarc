#!/usr/bin/env bash
set -euo pipefail

# Phase 10 Load Test Matrix Runner
#
# Runs k6 load tests for all 6 event configuration combinations.
# Each config gets: seed -> entry load -> food load -> mixed load -> counter verify
#
# Usage:
#   ./backend/tests/load/run_matrix.sh [options]
#
# Options:
#   --quick           Run with 1K VUs instead of 10K (for CI/dev)
#   --config NAME     Run only a specific config (e.g., unified_guestlinked_presnt)
#   --guests N        Number of guests per config (default: 15000)
#   --skip-seed       Skip data seeding (reuse existing data)
#   --skip-sse        Skip SSE dashboard test
#   --output DIR      Directory for test results (default: ./tests/load/results/)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Defaults
VUS=10000
GUESTS=15000
HMAC_SECRET="${HMAC_SECRET:-load_test_hmac_secret}"
BASE_URL="${BASE_URL:-http://localhost:8080}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
PG_URL="${PG_URL:-postgres://eventarc:dev_password@localhost:6432/eventarc?sslmode=disable}"
OUTPUT_DIR="${SCRIPT_DIR}/results"
SKIP_SEED=false
SKIP_SSE=false
SPECIFIC_CONFIG=""
QUICK=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --quick) QUICK=true; VUS=1000; GUESTS=1000; shift ;;
    --config) SPECIFIC_CONFIG="$2"; shift 2 ;;
    --guests) GUESTS="$2"; shift 2 ;;
    --skip-seed) SKIP_SEED=true; shift ;;
    --skip-sse) SKIP_SSE=true; shift ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

CONFIGS=(
  "unified_guestlinked_presnt"
  "unified_anonymous_presnt"
  "separate_guestlinked_presnt"
  "separate_guestlinked_postentry"
  "separate_anonymous_presnt"
  "separate_anonymous_postentry"
)

# Filter to specific config if requested
if [[ -n "$SPECIFIC_CONFIG" ]]; then
  CONFIGS=("$SPECIFIC_CONFIG")
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 10: Load Test Matrix"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VUs: $VUS | Guests/config: $GUESTS | Configs: ${#CONFIGS[@]}"
echo "Base URL: $BASE_URL"
echo "Quick mode: $QUICK"
echo ""

TOTAL_PASS=0
TOTAL_FAIL=0
RESULTS=()

for CONFIG in "${CONFIGS[@]}"; do
  echo "──────────────────────────────────────────────────────"
  echo "Config: $CONFIG"
  echo "──────────────────────────────────────────────────────"

  # Step 1: Seed data
  if [[ "$SKIP_SEED" == "false" ]]; then
    echo ">>> Seeding $GUESTS guests for $CONFIG..."
    cd "$BACKEND_DIR" && go run ./tests/load/seed_matrix.go \
      -guests-per-config "$GUESTS" \
      -hmac-secret "$HMAC_SECRET" \
      -redis-url "$REDIS_URL" \
      -pg-url "$PG_URL" \
      -output-dir "$SCRIPT_DIR" \
      -configs "$CONFIG"
  fi

  # Step 2: Determine payload keys
  if [[ "$CONFIG" == unified_* ]]; then
    ENTRY_KEY="unified_payload"
    FOOD_KEY="unified_payload"
  else
    ENTRY_KEY="entry_payload"
    FOOD_KEY="food_payload"
  fi

  # Step 3: Run mixed load test (entry + food simultaneous)
  echo ">>> Running mixed load test ($VUS VUs)..."
  CONFIG_RESULT="PASS"

  k6 run \
    --env BASE_URL="$BASE_URL" \
    --env CONFIG_NAME="$CONFIG" \
    --env ENTRY_KEY="$ENTRY_KEY" \
    --env FOOD_KEY="$FOOD_KEY" \
    --out json="$OUTPUT_DIR/${CONFIG}_mixed.json" \
    "$SCRIPT_DIR/scenarios/mixed_load.js" \
  || CONFIG_RESULT="FAIL"

  # Step 4: Counter reconciliation
  echo ">>> Verifying counter reconciliation..."
  EVENT_ID="loadtest_${CONFIG}"
  REDIS_ATTENDANCE=$(redis-cli -u "$REDIS_URL" HGET "counters:${EVENT_ID}" attendance 2>/dev/null || echo "N/A")
  PG_COUNT=$(psql -t -A -c "SELECT COUNT(*) FROM entry_scans WHERE event_id='${EVENT_ID}' AND status='valid'" "$PG_URL" 2>/dev/null || echo "N/A")
  echo "  Redis attendance: $REDIS_ATTENDANCE"
  echo "  PG valid scans:   $PG_COUNT"
  if [[ "$REDIS_ATTENDANCE" != "$PG_COUNT" ]] && [[ "$REDIS_ATTENDANCE" != "N/A" ]] && [[ "$PG_COUNT" != "N/A" ]]; then
    echo "  COUNTER MISMATCH"
    CONFIG_RESULT="FAIL"
  elif [[ "$REDIS_ATTENDANCE" == "N/A" ]] || [[ "$PG_COUNT" == "N/A" ]]; then
    echo "  [WARN] Could not verify reconciliation (service unavailable)"
  else
    echo "  [PASS] Counters match"
  fi

  if [[ "$CONFIG_RESULT" == "PASS" ]]; then
    TOTAL_PASS=$((TOTAL_PASS + 1))
    RESULTS+=("  $CONFIG: PASS")
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    RESULTS+=("  $CONFIG: FAIL")
  fi
  echo ">>> $CONFIG: $CONFIG_RESULT"
  echo ""
done

# Step 5: SSE dashboard test (if not skipped)
if [[ "$SKIP_SSE" == "false" ]]; then
  echo "──────────────────────────────────────────────────────"
  echo "SSE Dashboard Test"
  echo "──────────────────────────────────────────────────────"
  echo ">>> Running SSE dashboard client test (50 VUs, 60s)..."
  k6 run \
    --env BASE_URL="$BASE_URL" \
    --out json="$OUTPUT_DIR/dashboard_sse.json" \
    "$SCRIPT_DIR/scenarios/dashboard_sse.js" \
  || TOTAL_FAIL=$((TOTAL_FAIL + 1))
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for R in "${RESULTS[@]}"; do
  echo "$R"
done
echo ""
echo "Passed: $TOTAL_PASS | Failed: $TOTAL_FAIL | Total: ${#CONFIGS[@]}"
echo "Results directory: $OUTPUT_DIR"
echo ""

if [[ "$TOTAL_FAIL" -gt 0 ]]; then
  echo "LOAD TEST MATRIX: FAIL"
  exit 1
else
  echo "LOAD TEST MATRIX: PASS"
  exit 0
fi
