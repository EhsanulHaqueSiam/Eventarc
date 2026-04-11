# Phase 5: Food Scan & Rules Engine - Research

**Researched:** 2026-04-12
**Phase Goal:** Food scans enforce per-person and per-category consumption limits across all stalls in real-time, in both guest-linked and anonymous modes
**Requirements:** SCAN-03, FOOD-01, FOOD-02, FOOD-03, FOOD-04

## Research Questions

### Q1: What Redis data structures should be used for food consumption tracking with per-guest-per-category limits?

**Answer:**

Use a Redis Hash per guest (or token) per event to track consumption counts per food category:

| Purpose | Redis Type | Key Pattern | Fields/Values |
|---------|-----------|-------------|---------------|
| Guest food consumption | Hash | `food:{eventId}:{guestId}` | `{categoryId}:count` = current consumption count per food category |
| Anonymous token consumption | Hash | `food:{eventId}:anon:{tokenId}` | `{categoryId}:count` = current consumption count per food category |
| Food scan details (last scan) | Hash | `foodscan:{eventId}:{guestId}:{categoryId}:{scanId}` | timestamp, stallId, deviceId |
| Food rules cache | Hash | `foodrules:{eventId}` | `{guestCategoryId}:{foodCategoryId}` = limit (integer, -1 for unlimited) |
| Food counters (dashboard) | Hash | `counters:{eventId}` | `food:{categoryId}:served` = total servings per food category, `food:{stallId}:served` = total per stall |
| Consumption log (per guest) | List | `foodlog:{eventId}:{guestId}` | JSON entries: `{"categoryId":"...","stallId":"...","ts":"..."}` |

**Rationale:**

- **Hash for per-guest consumption** (`food:{eventId}:{guestId}`): Each field is a food category ID, value is the current count. HINCRBY atomically increments. HGET retrieves current count for a single category. This supports O(1) lookup and O(1) increment per category check.

- **Separate key namespace for anonymous tokens**: Anonymous tokens use `food:{eventId}:anon:{tokenId}` instead of `food:{eventId}:{guestId}`. The token ID comes from the QR payload's guestID field (Phase 3 uses the same binary format for both modes — in anonymous mode, the "guestID" field holds the token identifier). This means the Lua script can use the same logic for both modes — only the key changes.

- **Food rules as a Redis Hash**: `foodrules:{eventId}` stores all limits for an event as `{guestCategoryId}:{foodCategoryId}` → limit. This is pushed from Convex during go-live sync (same pattern as event data sync from Phase 1 D-03). The Lua script reads the limit with a single HGET inside the atomic operation.

- **Consumption log (List)**: LPUSH for O(1) append. Used for the rejection response (D-08) that shows consumption history. Capped with LTRIM to prevent unbounded growth (keep last 50 entries per guest).

- **Dashboard counters**: Reuse the existing `counters:{eventId}` hash from Phase 4. Add food-specific fields like `food:{categoryId}:served` and `food:{stallId}:served`. HINCRBY inside the Lua script, same pattern as the entry attendance counter.

**Key insight:** The consumption hash per guest is the critical data structure. A single HGET checks the current count for a category, and HINCRBY increments it — both O(1). The Lua script wraps these in an atomic check-and-increment. No Sets or Sorted Sets needed for food tracking (unlike entry scanning which uses a Set for boolean checked-in state).

### Q2: How should the Redis Lua script for atomic food scan check-and-increment work?

**Answer:**

The food scan Lua script must atomically: (1) read current consumption for the food category, (2) read the limit from the rules cache, (3) compare count vs limit, (4) increment if allowed, (5) update dashboard counters, (6) log the consumption.

```lua
-- Food Scan Check-and-Increment Lua Script
--
-- KEYS[1] = food:{eventId}:{guestOrTokenId}     (HASH — consumption counts)
-- KEYS[2] = foodrules:{eventId}                   (HASH — food rules cache)
-- KEYS[3] = counters:{eventId}                    (HASH — dashboard counters)
-- KEYS[4] = foodlog:{eventId}:{guestOrTokenId}   (LIST — consumption log)
--
-- ARGV[1] = guestCategoryId (guest's category for rule lookup)
-- ARGV[2] = foodCategoryId (food category being scanned)
-- ARGV[3] = stallId
-- ARGV[4] = timestamp (ISO 8601)
-- ARGV[5] = deviceId
-- ARGV[6] = stallName (for log entry)
--
-- Returns (multi-value via table):
--   [1] = "OK" or "LIMIT_REACHED"
--   [2] = current count (after increment if OK)
--   [3] = limit value (-1 for unlimited)

-- Step 1: Read the limit for this guest-category + food-category combination
local ruleKey = ARGV[1] .. ':' .. ARGV[2]
local limit = tonumber(redis.call('HGET', KEYS[2], ruleKey))

-- If no rule found, default to 0 (deny — fail closed)
if limit == nil then
  return {'NO_RULE', 0, 0}
end

-- Step 2: If unlimited (-1), skip count check
if limit == -1 then
  -- Unlimited: increment consumption counter and counters, return OK
  local newCount = redis.call('HINCRBY', KEYS[1], ARGV[2], 1)
  redis.call('HINCRBY', KEYS[3], 'food:' .. ARGV[2] .. ':served', 1)
  redis.call('HINCRBY', KEYS[3], 'food:' .. ARGV[3] .. ':served', 1)
  -- Log the consumption
  local logEntry = ARGV[4] .. '|' .. ARGV[3] .. '|' .. ARGV[6]
  redis.call('LPUSH', KEYS[4], logEntry)
  redis.call('LTRIM', KEYS[4], 0, 49)
  return {'OK', newCount, -1}
end

-- Step 3: Read current consumption count for this food category
local current = tonumber(redis.call('HGET', KEYS[1], ARGV[2]) or '0')

-- Step 4: Check against limit
if current >= limit then
  return {'LIMIT_REACHED', current, limit}
end

-- Step 5: Increment consumption (allowed)
local newCount = redis.call('HINCRBY', KEYS[1], ARGV[2], 1)

-- Step 6: Increment dashboard counters
redis.call('HINCRBY', KEYS[3], 'food:' .. ARGV[2] .. ':served', 1)
redis.call('HINCRBY', KEYS[3], 'food:' .. ARGV[3] .. ':served', 1)

-- Step 7: Log consumption for history
local logEntry = ARGV[4] .. '|' .. ARGV[3] .. '|' .. ARGV[6]
redis.call('LPUSH', KEYS[4], logEntry)
redis.call('LTRIM', KEYS[4], 0, 49)

return {'OK', newCount, limit}
```

**Why this works for 10K concurrent:**

- Redis executes Lua scripts atomically — no other command runs between the HGET (read count) and HINCRBY (increment). This eliminates the TOCTOU race condition that would occur with separate HGET + conditional HINCRBY commands.
- All operations are O(1) hash operations, so the script executes in microseconds.
- The script operates on 4 keys — Redis cluster compatibility requires all keys to hash to the same slot. For single-node Redis (our architecture), this is not a concern.

**Fail-closed design:** If no rule is found in the rules cache (`NO_RULE` return), the scan is rejected. This prevents unauthorized food distribution if rules haven't been synced yet.

**go-redis v9 integration pattern:**

```go
var foodScanScript = redis.NewScript(foodScanLua)

// go-redis internally uses EVALSHA with fallback to EVAL
result, err := foodScanScript.Run(ctx, rdb, 
    []string{consumptionKey, rulesKey, countersKey, logKey},
    guestCategoryID, foodCategoryID, stallID, timestamp, deviceID, stallName,
).StringSlice()
```

### Q3: How should anonymous mode food scanning differ from guest-linked mode?

**Answer:**

Anonymous mode uses the exact same Lua script and food rules. The only difference is the Redis key for consumption tracking:

| Mode | Consumption Key | Identity Source |
|------|----------------|-----------------|
| Guest-linked | `food:{eventId}:{guestId}` | `guestId` from QR payload |
| Anonymous | `food:{eventId}:anon:{guestId}` | `guestId` from QR payload (holds token ID in anonymous mode) |

**How it works end-to-end:**

1. **QR generation (Phase 3):** When event uses anonymous food mode, the food QR's `guestID` field in the binary payload contains a token identifier (not a real guest ID). The token is assigned to a guest category during generation (D-06 from CONTEXT.md).

2. **Food scan processing:** The Go handler decodes the QR payload. It determines the food mode from the event config cached in Redis (`event:{eventId}` hash, field `foodQrMode`). Based on mode:
   - **Guest-linked:** Use `food:{eventId}:{payload.GuestID}` as consumption key. Look up `guest:{eventId}:{payload.GuestID}` for guest category.
   - **Anonymous:** Use `food:{eventId}:anon:{payload.GuestID}` as consumption key. Look up `anontoken:{eventId}:{payload.GuestID}` for assigned guest category.

3. **Guest category for rules:** In guest-linked mode, the guest's category comes from the guest cache hash. In anonymous mode, the token's assigned category comes from a separate token metadata hash `anontoken:{eventId}:{tokenId}` (pushed during go-live sync when anonymous tokens are generated).

4. **Same Lua script:** Once the correct consumption key and guest category are resolved, the same Lua script runs. The script doesn't know or care whether it's tracking a person or a token.

**Key insight from CONTEXT.md D-06:** "Anonymous tokens use the same food rules matrix as guest-linked mode. When an anonymous QR is generated, it inherits the limits of the guest category it was assigned to." This means the Lua script's `ARGV[1]` (guestCategoryId) is always valid — it comes from the guest record in guest-linked mode or from the token metadata in anonymous mode.

### Q4: How should food rules be stored in Convex and synced to Redis?

**Answer:**

**Convex schema — `foodRules` table:**

```typescript
foodRules: defineTable({
  eventId: v.id("events"),
  guestCategoryId: v.id("guestCategories"),
  foodCategoryId: v.id("vendorCategories"),  // food categories are vendorCategories under "food" vendorType
  limit: v.number(),  // -1 for unlimited, 0+ for specific limit
})
  .index("by_event", ["eventId"])
  .index("by_event_guest_food", ["eventId", "guestCategoryId", "foodCategoryId"])
```

**Why a separate table (not nested on events):**

- The food rules matrix can have `N * M` entries (guest categories x food categories). For a large event with 5 guest categories and 10 food categories, that's 50 rule entries. Storing these as a nested array on the event document would make event reads expensive and mutations conflict-prone under OCC.
- A separate table allows individual rule mutations without touching the event document. Admin can change one cell in the matrix without OCC conflicts on the event.
- Convex indexes enable efficient queries: "get all rules for event X" or "get the specific rule for guest-category Y, food-category Z in event X".

**Redis sync pattern (same as Phase 1 D-03/D-04 go-live sync):**

When event goes live, Convex pushes food rules to Go via the sync endpoint. Go writes to Redis:

```
HSET foodrules:{eventId} {guestCategoryId}:{foodCategoryId} {limit}
```

For example, an event with VIP (cat_123) and General (cat_456) guest categories, plus fuchka (fcat_789) and biryani (fcat_012) food categories:

```
HSET foodrules:evt_abc cat_123:fcat_789 3    -- VIP gets 3 fuchka
HSET foodrules:evt_abc cat_123:fcat_012 -1   -- VIP gets unlimited biryani
HSET foodrules:evt_abc cat_456:fcat_789 1    -- General gets 1 fuchka
HSET foodrules:evt_abc cat_456:fcat_012 1    -- General gets 1 biryani
```

Mid-event rule changes: Convex mutation triggers push-on-change HTTP action to Go. Go updates the specific Redis hash field. The Lua script reads the latest value on each scan (HGET inside the script).

**Anonymous token metadata sync:**

When anonymous tokens are generated (Phase 3), their assigned guest category must be synced to Redis alongside guest data:

```
HSET anontoken:{eventId}:{tokenId} category {guestCategoryId}
```

### Q5: What PostgreSQL schema changes are needed for food scan records?

**Answer:**

**New migration `000003_food_scans.up.sql`:**

```sql
-- Food scan records (durable storage, same dual-write pattern as entry scans)
CREATE TABLE IF NOT EXISTS food_scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    event_id        TEXT NOT NULL,
    guest_id        TEXT NOT NULL,    -- guestId or tokenId for anonymous mode
    food_category_id TEXT NOT NULL,
    stall_id        TEXT NOT NULL,
    scanned_at      TIMESTAMPTZ NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id       TEXT NOT NULL,
    guest_category  TEXT NOT NULL DEFAULT '',
    is_anonymous    BOOLEAN NOT NULL DEFAULT FALSE,
    consumption_count INTEGER NOT NULL DEFAULT 1,  -- which serving this was (1st, 2nd, etc.)
    status          TEXT NOT NULL DEFAULT 'valid'   -- 'valid' or 'rejected'
);

-- Index for per-event queries and reconciliation
CREATE INDEX idx_food_scans_event ON food_scans(event_id);

-- Index for per-guest-per-category consumption queries (reconciliation)
CREATE INDEX idx_food_scans_reconcile ON food_scans(event_id, guest_id, food_category_id, status);

-- Index for per-stall metrics
CREATE INDEX idx_food_scans_stall ON food_scans(event_id, stall_id, status);

-- Compound index for consumption history (D-08: show where guest consumed)
CREATE INDEX idx_food_scans_history ON food_scans(event_id, guest_id, food_category_id, scanned_at DESC);
```

**Idempotency key format:** `food:{eventId}:{guestId}:{foodCategoryId}:{stallId}:{timestamp}`

Unlike entry scans (one per guest per event), a guest can have multiple food scans — one per category per allowance. The idempotency key includes the timestamp to allow multiple valid scans for the same guest/category (up to the limit), while preventing exact duplicate submissions from retry logic.

**sqlc queries (`backend/queries/food_scans.sql`):**

```sql
-- name: InsertFoodScan :one
INSERT INTO food_scans (idempotency_key, event_id, guest_id, food_category_id, stall_id, scanned_at, device_id, guest_category, is_anonymous, consumption_count, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;

-- name: GetFoodConsumptionHistory :many
SELECT food_category_id, stall_id, scanned_at
FROM food_scans
WHERE event_id = $1 AND guest_id = $2 AND food_category_id = $3 AND status = 'valid'
ORDER BY scanned_at DESC
LIMIT 10;

-- name: GetFoodConsumptionCounts :many
SELECT food_category_id, COUNT(*) as count
FROM food_scans
WHERE event_id = $1 AND guest_id = $2 AND status = 'valid'
GROUP BY food_category_id;

-- name: GetFoodCounterReconciliation :many
SELECT food_category_id, stall_id, COUNT(*) as count
FROM food_scans
WHERE event_id = $1 AND status = 'valid'
GROUP BY food_category_id, stall_id;
```

### Q6: What should the food scan endpoint request/response contract look like?

**Answer:**

**Request:** `POST /api/v1/scan/food`

```json
{
  "qr_payload": "base64url-encoded-qr-data",
  "stall_id": "stall_fuchka01",
  "device_id": "device_abc123",
  "food_category_id": "fcat_789"
}
```

Note: `food_category_id` is required — the vendor device knows which food category it's serving (configured when vendor selects their stall in Phase 6). The stall has an associated food category from the vendor hierarchy (vendorType → vendorCategory → stall).

**Success Response (200):**

```json
{
  "status": "valid",
  "food_category": {
    "id": "fcat_789",
    "name": "Fuchka"
  },
  "consumption": {
    "current": 1,
    "limit": 3,
    "remaining": 2
  },
  "guest": {
    "name": "John Doe",
    "category": "VIP"
  },
  "scan": {
    "scanned_at": "2026-04-12T18:30:00Z",
    "stall_id": "stall_fuchka01",
    "device_id": "device_abc123"
  }
}
```

For unlimited items, `limit` is -1 and `remaining` is -1.

**Rejection Response — Limit Reached (200 with status "rejected"):**

```json
{
  "status": "limit_reached",
  "message": "Fuchka limit reached (1/1)",
  "food_category": {
    "id": "fcat_789",
    "name": "Fuchka"
  },
  "consumption": {
    "current": 1,
    "limit": 1,
    "remaining": 0
  },
  "history": [
    {
      "stall_name": "Fuchka Stall 2",
      "stall_id": "stall_fuchka02",
      "consumed_at": "2026-04-12T14:30:00Z"
    }
  ]
}
```

Note: Using HTTP 200 (not 409) for limit-reached because this is a valid business response, not an error. The vendor device needs to parse the response body for display regardless. 409 is reserved for actual conflicts (Phase 4 uses it for duplicate entry scans which are a system-level concern).

**Error Responses:**
- 400: Invalid QR payload (malformed, wrong version)
- 401: Invalid HMAC signature (forged QR)
- 404: Guest/token not found in Redis or PG
- 422: Wrong QR type (entry QR at food stall, or QR type doesn't include food capability)
- 500: Internal error (Redis/PG connectivity)

### Q7: How should food counter reconciliation work after Redis restart?

**Answer:**

Same pattern as entry counter reconciliation from Phase 4 (SCAN-09), extended for food counters:

**Detection:** On server startup or health check, verify food counter keys exist for active events. If `counters:{eventId}` is missing food-specific fields, trigger re-seed.

**Re-seed query:**

```sql
SELECT food_category_id, COUNT(*) as total_served
FROM food_scans
WHERE event_id = $1 AND status = 'valid'
GROUP BY food_category_id;

SELECT stall_id, COUNT(*) as total_served
FROM food_scans
WHERE event_id = $1 AND status = 'valid'
GROUP BY stall_id;
```

**Re-seed consumption tracking (critical — without this, guests can exceed limits after Redis restart):**

```sql
SELECT guest_id, food_category_id, COUNT(*) as consumed
FROM food_scans
WHERE event_id = $1 AND status = 'valid'
GROUP BY guest_id, food_category_id;
```

For each row, set: `HSET food:{eventId}:{guestId} {foodCategoryId} {consumed}`

This is more expensive than entry counter re-seeding because it rebuilds per-guest consumption state, not just aggregate counters. For 60K guests with 5 food categories each, that's up to 300K hash field writes. At Redis's throughput (500K+ ops/sec), this completes in under a second using pipelining.

**Re-seed order:**
1. Food rules (from Convex sync data or PG cache)
2. Per-guest consumption counts (from PG food_scans)
3. Dashboard food counters (from PG aggregates)
4. Anonymous token metadata (from Convex sync data)
5. Block food scans until re-seed complete (return 503 with retry hint)

### Q8: How should the food scan service integrate with the existing scan package from Phase 4?

**Answer:**

Extend the existing `backend/internal/scan/` package rather than creating a separate package:

**New files:**
- `backend/internal/scan/food_service.go` — Food scan processing logic
- `backend/internal/scan/food_lua.go` — Food scan Lua script
- `backend/internal/scan/food_handler.go` — HTTP handler for `POST /api/v1/scan/food`
- `backend/internal/scan/food_types.go` — Food-specific request/response types
- `backend/internal/scan/food_service_test.go` — Unit tests
- `backend/internal/scan/food_handler_test.go` — Handler tests

**Reuse from Phase 4:**
- `Service` struct gains food-related methods (or a `FoodService` wrapping the same Redis/PG clients)
- QR payload decode (`qr.DecodePayload`) — same function, but validates QR type is `QRTypeFood` or `QRTypeUnified`
- Domain errors (`model.ErrLimitReached` already exists)
- JSON error response envelope (same format)
- asynq PG write pattern (same dual-write: Redis-first, PG via background job)
- Redis client injection pattern

**Food scan pipeline (mirrors entry scan pipeline):**
1. Decode QR payload, verify HMAC → reuse `qr.DecodePayload()`
2. Validate QR type (`QRTypeFood` or `QRTypeUnified`)
3. Determine food mode from event config (`event:{eventId}` → `foodQrMode` field)
4. Resolve identity: guest-linked → guest cache lookup; anonymous → token metadata lookup
5. Resolve guest category ID (for rules lookup)
6. Execute food scan Lua script atomically
7. Build response (success with consumption info, or rejection with history)
8. Enqueue asynq task for PG durable write
9. Enqueue asynq task for Convex sync-back (fire-and-forget)

### Q9: How should food rules be loaded and cached for scan-time performance?

**Answer:**

Food rules must be in Redis at scan time — they cannot be fetched from Convex or PG during the hot path.

**Loading strategies:**

1. **Go-live sync (primary):** When event goes live, Convex pushes all food rules to Go via the sync endpoint. Go writes each rule to `foodrules:{eventId}` hash. This is the same pattern as Phase 1's go-live data sync.

2. **Mid-event rule change:** Admin changes a limit in the Convex dashboard. Convex mutation triggers push-on-change HTTP action to Go. Go updates the specific field in `foodrules:{eventId}`.

3. **Redis restart recovery:** Food rules must be re-seeded. Since food rules are configuration data (not derived from scan records), they come from Convex, not PG. The re-seed endpoint fetches current rules from Convex via HTTP action and writes to Redis.

**Convex sync endpoint extension:**

The existing `POST /api/v1/sync/event` endpoint (Phase 4) needs to accept food rules as part of the sync payload:

```json
{
  "type": "food_rules",
  "event_id": "evt_abc",
  "rules": [
    {"guest_category_id": "cat_123", "food_category_id": "fcat_789", "limit": 3},
    {"guest_category_id": "cat_123", "food_category_id": "fcat_012", "limit": -1},
    {"guest_category_id": "cat_456", "food_category_id": "fcat_789", "limit": 1}
  ]
}
```

Go handler writes each rule to Redis hash.

**Vendor category to food category mapping:**

The vendor hierarchy from Phase 1 (vendorType → vendorCategory → stall) naturally maps food categories. A `vendorCategory` under the "food" `vendorType` IS a food category. The `food_category_id` in scan requests maps to `vendorCategory._id`.

## Validation Architecture

### Correctness Validation
- **Zero over-serving (false positive):** Lua script atomic check-and-increment eliminates race condition between checking count and incrementing. If limit is 1, exactly 1 serving is allowed even with 10K concurrent requests for the same guest/category.
- **Zero false negatives:** Guest with remaining allowance always gets served. Lua script reads current count and limit in the same atomic operation.
- **Cross-stall consistency (SCAN-07):** All stalls read from the same Redis hash. After stall-1 increments, stall-2's next Lua script execution sees the updated count immediately (Redis single-threaded execution).
- **Fail-closed on missing rules:** NO_RULE return rejects the scan, preventing unauthorized food distribution.

### Performance Validation
- **Throughput:** Same k6 load test pattern as Phase 4, targeting food endpoint. 10K VUs, 30s duration, zero errors.
- **Latency:** p95 < 200ms for food scan endpoint (same as entry scan).
- **Script complexity:** 5-7 Redis operations inside Lua (~50 microseconds). Well within Redis's single-threaded execution budget.

### Data Integrity Validation
- **Counter accuracy:** After load test, sum of Redis `food:{eventId}:{guestId}` consumption values == PG `SELECT food_category_id, COUNT(*) FROM food_scans WHERE status='valid' GROUP BY food_category_id`
- **Limit enforcement:** After load test with limit=1 guests, PG has exactly 1 valid food_scan per guest per category. Run: `SELECT guest_id, food_category_id, COUNT(*) FROM food_scans WHERE status='valid' GROUP BY guest_id, food_category_id HAVING COUNT(*) > 1` — must return zero rows.
- **Re-seed correctness:** After Redis flush + re-seed, per-guest consumption counts match PG.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Food rules not synced before first scan | High | Fail-closed design (NO_RULE rejects). Go-live sync pushes rules before event starts. Health check verifies rules exist. |
| Redis restart loses consumption state | High | Re-seed from PG food_scans table. Block food scans until re-seed complete (503). |
| Lua script too complex causing Redis slowdown | Low | Script has 5-7 O(1) hash operations. Benchmarks show <100μs execution. Redis handles 500K+ scripts/sec. |
| Anonymous token category lookup miss | Medium | Fail-closed (reject if token metadata missing). Re-seed includes token metadata from Convex sync. |
| Consumption log (List) growing unbounded | Low | LTRIM to 50 entries inside Lua script. Older history available from PG if needed. |
| Mid-event food rule change race condition | Low | HSET on Redis hash field is atomic. Lua script reads latest value on each scan. No stale cache. |
| PG food_scans write backlog | Medium | Same asynq pattern as Phase 4. Dedicated queue with configurable concurrency. Monitor queue depth. |

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Consumption tracking | Redis Hash per guest per event | O(1) HGET/HINCRBY per category. Single key per guest avoids key explosion. |
| Atomicity mechanism | Redis Lua script | Same proven pattern as Phase 4 entry scan. Atomic check-and-increment eliminates TOCTOU races. |
| Food rules storage (Convex) | Separate `foodRules` table | Avoids OCC conflicts on event document. Supports matrix CRUD without touching event. |
| Food rules cache (Redis) | Single Hash per event | Compact: all rules for an event in one hash. Lua script HGET is O(1). |
| PG write strategy | Async via asynq (same as Phase 4) | Redis-first for speed, PG via background job for durability. Proven pattern. |
| Anonymous vs guest-linked | Same Lua script, different key prefix | Minimizes code duplication. Token metadata stored separately for category lookup. |
| Rejection response | HTTP 200 with status field | Business response (limit reached), not a system error. Vendor device parses body regardless. |
| Idempotency key | Includes timestamp | Allows multiple valid scans per guest/category (up to limit). Prevents retry duplicates. |

## Existing Code Reuse

| Asset | Location | Reuse |
|-------|----------|-------|
| QR decode + HMAC verify | `backend/internal/qr/payload.go` | `DecodePayload()` called directly, validate QRType is Food or Unified |
| Domain errors | `backend/internal/model/errors.go` | `ErrLimitReached` for food limit, `ErrNotFound` for missing guest/token |
| Entry scan Lua pattern | `backend/internal/scan/lua.go` (Phase 4) | Food Lua script follows same structure: KEYS/ARGV convention, atomic check-set-increment |
| Entry scan service | `backend/internal/scan/service.go` (Phase 4) | Food service follows same pipeline: decode → validate → Redis Lua → response → asynq enqueue |
| Entry scan handler | `backend/internal/scan/handler.go` (Phase 4) | Food handler follows same pattern: JSON decode → service call → response encode |
| asynq PG write worker | Phase 4 asynq patterns | Same dual-write pattern: enqueue PG write task after Redis success |
| Scan types | `backend/internal/scan/types.go` (Phase 4) | Extend with FoodScanRequest, FoodScanResult types |
| Event config cache | `event:{eventId}` Redis hash (Phase 4) | Read foodQrMode field to determine anonymous vs guest-linked |
| Guest cache | `guest:{eventId}:{guestId}` Redis hash (Phase 4) | Read category field for guest-linked mode rule lookup |
| Dashboard counters | `counters:{eventId}` Redis hash (Phase 4) | Add food-specific counter fields |
| SQL migration pattern | `backend/migrations/` | New 000003 migration for food_scans table |
| sqlc queries | `backend/queries/` | New food_scans.sql for food-specific queries |

## RESEARCH COMPLETE
