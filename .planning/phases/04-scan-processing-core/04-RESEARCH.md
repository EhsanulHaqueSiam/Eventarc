# Phase 4: Scan Processing Core - Research

**Researched:** 2026-04-11
**Phase Goal:** Entry scans are processed correctly under 10K concurrent load with zero race conditions, zero false positives, and zero false negatives
**Requirements:** SCAN-01, SCAN-02, SCAN-04, SCAN-05, SCAN-06, SCAN-07, SCAN-08, SCAN-09, INFR-03, INFR-04

## Research Questions

### Q1: How should the scan validation pipeline be structured for sub-second response with dual-write atomicity?

**Answer:** The scan endpoint (`POST /api/v1/scan/entry`) follows a strict pipeline:

1. **QR Decode + HMAC Verify** — Use existing `qr.DecodePayload()` from Phase 3. Rejects forged/tampered QR codes immediately (zero false positives). O(1) cryptographic check.

2. **Guest Lookup (Redis primary, PG fallback)** — Redis HGETALL on `guest:{eventId}:{guestId}` hash. If Redis miss, query PG `entry_scans` table and Convex sync data. On PG hit, backfill Redis cache (self-healing). This prevents false negatives from incomplete Convex-to-Redis syncs.

3. **Check-In State Check (Redis)** — Redis SISMEMBER on `checkedin:{eventId}` set with `guestId`. If already present, return "already checked in" with original timestamp from Redis hash `checkin:{eventId}:{guestId}` (idempotent duplicate detection, SCAN-02).

4. **Atomic Check-In (Redis Lua Script)** — Single Lua script atomically: (a) SISMEMBER check, (b) if not member SADD to checked-in set, (c) HSET check-in details (timestamp, stall, device), (d) HINCRBY attendance counter. Lua scripts execute atomically in Redis — no race conditions between check and set.

5. **PG Durable Write (background)** — Enqueue asynq task for INSERT ON CONFLICT into `entry_scans` table. Redis has correct state immediately; PG catches up within seconds. On PG failure, asynq retries with idempotency key.

6. **Convex Sync-Back (async)** — Separate asynq task to notify Convex of check-in via HTTP action. Dashboard reads from Redis counters, not Convex, so this is eventually consistent and acceptable.

**Key insight:** The Lua script is the atomicity guarantee for the hot path. Individual Redis commands (SISMEMBER then SADD) have a TOCTOU race window under concurrency. A Lua script eliminates this because Redis executes Lua atomically — no other command runs between the check and the set.

**Evidence:**
- Redis documentation confirms: "Redis guarantees the script's atomic execution; while executing, all server activities are blocked during its entire runtime"
- go-redis v9 supports `client.Eval()` and `redis.NewScript()` for Lua execution
- HINCRBY is O(1) and atomic, suitable for counter increments

### Q2: What Redis data structures should be used for guest cache, check-in tracking, and counters?

**Answer:**

| Purpose | Redis Type | Key Pattern | Fields/Values |
|---------|-----------|-------------|---------------|
| Guest cache | Hash | `guest:{eventId}:{guestId}` | name, category, categoryLabel, photoUrl, qrType |
| Check-in set | Set | `checkedin:{eventId}` | guestId members |
| Check-in details | Hash | `checkin:{eventId}:{guestId}` | timestamp, stallId, deviceId, status |
| Event counters | Hash | `counters:{eventId}` | attendance, totalGuests, {categoryId}:checkedin |
| Event metadata | Hash | `event:{eventId}` | name, status, qrStrategy, foodQrMode |

**Rationale:**
- **Hash for guest data**: HGETALL retrieves all fields in one O(N) call (N = field count, typically 5-6). Compared to individual STRING keys, a hash saves memory and reduces round trips.
- **Set for checked-in tracking**: SISMEMBER is O(1) and provides the boolean "is this guest checked in?" check needed for duplicate detection.
- **Separate hash for check-in details**: Keeps the check-in timestamp, stall, and device info separate from the guest cache. The duplicate response (SCAN-02) needs this data.
- **Hash for counters**: HINCRBY on a hash field is atomic. Multiple counter types (attendance, per-category) in one hash per event. Dashboard reads all counters with HGETALL.

### Q3: How should idempotency be implemented at the PG level to prevent race conditions?

**Answer:** PostgreSQL INSERT ON CONFLICT is the sole correctness mechanism at the database level.

```sql
INSERT INTO entry_scans (idempotency_key, event_id, guest_id, stall_id, scanned_at, device_id, status)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;
```

**Idempotency key format:** `entry:{eventId}:{guestId}` — one entry per guest per event. The UNIQUE constraint on `idempotency_key` column guarantees that concurrent INSERTs for the same guest will have exactly one succeed and the rest return no rows (DO NOTHING).

**PostgreSQL atomicity guarantees:** "ON CONFLICT DO NOTHING guarantees an atomic INSERT or no-op outcome; provided there is no independent error, one of those two outcomes is guaranteed, even under high concurrency." This means no application-level check-then-act is needed — the database handles it.

**Additional index needed:** `CREATE UNIQUE INDEX idx_entry_scans_event_guest ON entry_scans(event_id, guest_id)` — enforces one entry scan per guest per event at the DB level as a secondary safety net (belt and suspenders with idempotency key).

### Q4: How should atomic Redis counters work with PG reconciliation for dashboard accuracy?

**Answer:**

**Counter increment:** Inside the Lua check-in script, after SADD succeeds:
```lua
redis.call('HINCRBY', KEYS[3], 'attendance', 1)
redis.call('HINCRBY', KEYS[3], ARGV[4] .. ':checkedin', 1)  -- per-category
```

**Counter re-seeding on Redis restart (SCAN-09):**

1. **Detection:** The health endpoint already checks Redis connectivity. On Redis reconnect after restart, the Go service detects empty counter keys.

2. **Re-seed process:**
   ```sql
   SELECT 
     event_id,
     COUNT(*) as attendance,
     guest_category,
     COUNT(*) as category_count
   FROM entry_scans
   WHERE event_id = $1 AND status = 'valid'
   GROUP BY event_id, guest_category;
   ```

3. **Atomic re-seed:** Use Redis MULTI/EXEC transaction to set all counter values at once, preventing partial state from being visible to dashboard readers.

4. **Trigger:** On server startup, check if counter keys exist for active events. If not, run re-seed. Also expose `POST /api/v1/admin/reseed-counters` for manual trigger.

**Key insight:** The checked-in set (`checkedin:{eventId}`) must also be re-seeded — not just counters. Otherwise, duplicate detection fails after Redis restart.

### Q5: How should the Convex sync-back work without affecting scan hot path latency?

**Answer:** Async bridge via asynq task queue.

After successful Redis check-in, enqueue an asynq task:
```go
task := asynq.NewTask("scan:convex-sync", payload, 
    asynq.MaxRetry(5),
    asynq.Queue("convex-sync"),
    asynq.Timeout(10*time.Second),
)
```

The handler calls a Convex HTTP action to update guest status. This is fire-and-forget from the scan hot path perspective. If Convex is down, asynq retries. Dashboard reads Redis counters (not Convex), so Convex sync delay has zero impact on real-time metrics.

### Q6: What load testing approach validates 10K concurrent with zero race conditions?

**Answer:** k6 (Grafana k6 1.0, released 2025) for external HTTP load testing + Go race detector for internal race detection.

**k6 test structure:**
```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    concurrent_scans: {
      executor: 'constant-vus',
      vus: 10000,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],     // zero errors
    http_req_duration: ['p(95)<200'], // p95 < 200ms
  },
};
```

**Pre-seed requirement:** Before load test, seed Redis with 10K+ guest records and generate valid QR payloads for each.

**Validation criteria (from CONTEXT.md D-10):**
1. Zero HTTP errors across all 10K concurrent requests
2. p95 latency < 200ms
3. Go race detector (`-race` flag) shows zero data races
4. After test: PG entry_scans count matches Redis checked-in set count (counter reconciliation)
5. No duplicate entries: `SELECT idempotency_key, COUNT(*) FROM entry_scans GROUP BY idempotency_key HAVING COUNT(*) > 1` returns zero rows

**Go integration test with race detector:**
```go
func TestConcurrentScans(t *testing.T) {
    // Spin up testcontainers for PG + Redis
    // Seed test data
    // Launch 100+ goroutines hitting scan handler
    // Verify: no duplicates, correct counter values
}
```

Run with `go test -race ./...` to detect data races in shared state.

### Q7: What is the exact scan endpoint request/response contract?

**Answer:**

**Request:** `POST /api/v1/scan/entry`
```json
{
  "qr_payload": "base64url-encoded-qr-data",
  "stall_id": "stall_abc123",
  "device_id": "device_xyz789"
}
```

Note: This endpoint does NOT use the existing HMAC middleware (that's for Convex-to-Go sync). Vendor devices are unauthenticated (passwordless device sessions, Phase 6). The QR payload's embedded HMAC signature IS the authentication — the scan validates the QR itself.

**Success Response (200):**
```json
{
  "status": "valid",
  "guest": {
    "name": "John Doe",
    "category": "VIP",
    "photo_url": ""
  },
  "scan": {
    "checked_in_at": "2026-04-11T18:30:00Z",
    "stall_id": "stall_abc123",
    "device_id": "device_xyz789"
  }
}
```

**Duplicate Response (409):**
```json
{
  "status": "duplicate",
  "message": "Already checked in",
  "original_scan": {
    "checked_in_at": "2026-04-11T18:25:00Z",
    "stall_id": "stall_entry01",
    "device_id": "device_gate1"
  }
}
```

**Error Responses:**
- 400: Invalid QR payload (malformed, wrong version)
- 401: Invalid HMAC signature (forged QR)
- 404: Guest not found (not in Redis or PG)
- 422: Wrong QR type (food QR at entry gate)
- 500: Internal error (Redis/PG connectivity)

### Q8: What PG schema changes are needed beyond the existing migration?

**Answer:** The existing `000001_init.up.sql` has `entry_scans` and `event_counters` tables. Needed additions:

**New migration `000002_scan_processing.up.sql`:**

1. **Add guest_category column** to entry_scans (needed for per-category counter re-seeding):
   ```sql
   ALTER TABLE entry_scans ADD COLUMN guest_category TEXT NOT NULL DEFAULT '';
   ```

2. **Add unique compound index** for belt-and-suspenders with idempotency:
   ```sql
   CREATE UNIQUE INDEX idx_entry_scans_event_guest ON entry_scans(event_id, guest_id);
   ```

3. **Add counter reconciliation query support:**
   ```sql
   CREATE INDEX idx_entry_scans_reconcile ON entry_scans(event_id, status, guest_category);
   ```

4. **Event counter upsert for re-seeding:**
   ```sql
   -- Used during counter re-seed from PG
   INSERT INTO event_counters (event_id, counter_key, value, updated_at)
   VALUES ($1, $2, $3, NOW())
   ON CONFLICT (event_id, counter_key) DO UPDATE
   SET value = $3, updated_at = NOW();
   ```

## Validation Architecture

### Correctness Validation
- **Zero false positives:** Invalid HMAC always rejected; only valid QR payloads proceed past decode step
- **Zero false negatives:** Redis miss triggers PG fallback; PG miss triggers Convex cache rebuild check  
- **Zero race conditions:** Lua script atomicity for check-and-set; PG INSERT ON CONFLICT for durable writes
- **Idempotency:** Same scan request produces identical result regardless of retry count

### Performance Validation  
- **Throughput:** k6 at 10K VUs for 30s, zero HTTP errors
- **Latency:** p95 < 200ms for scan endpoint
- **Race detection:** `go test -race` passes with 100+ concurrent goroutines

### Data Integrity Validation
- **Counter accuracy:** After load test, Redis counter == PG COUNT(*) for each event
- **No duplicates:** PG idempotency_key uniqueness + compound unique index on (event_id, guest_id)
- **Re-seed correctness:** After Redis flush + re-seed, counters match PG aggregates exactly

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Lua script complexity causing bugs | Medium | Keep Lua minimal (check + set + increment only). Unit test with embedded Redis (miniredis). |
| Redis restart during live event | High | Auto-detect empty counters on health check. Re-seed from PG before accepting scans. Block scans until re-seed complete. |
| PG write backlog under sustained load | Medium | Asynq with dedicated queue, configurable concurrency. Monitor queue depth. Alert if > 1000 pending. |
| Network partition between Go and Redis | High | Circuit breaker pattern. If Redis unreachable, reject scans with 503 (fail closed, not fail open). |
| k6 test environment not matching production | Low | Use Docker Compose with same PG + PgBouncer + Redis setup. Test on same hardware class. |

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Atomicity mechanism | Redis Lua script | Single atomic operation for check + set + increment. No TOCTOU race window. |
| Load testing tool | k6 | Go-based, JavaScript scripting, built-in thresholds, 10K VU support. Grafana k6 1.0 (2025) is stable. |
| PG write strategy | Async via asynq | Redis-first for speed, PG via background job for durability. Decouples hot path from PG latency. |
| Convex sync strategy | Async via asynq | Separate queue, separate retry policy. Scan hot path is Convex-independent. |
| Counter re-seed | PG aggregate queries | PG is source of truth for scan records. MULTI/EXEC for atomic Redis write. |
| Guest cache miss | PG fallback + Redis backfill | Self-healing prevents false negatives. One-time PG query, then Redis serves subsequent requests. |

## Existing Code Reuse

| Asset | Location | Reuse |
|-------|----------|-------|
| QR decode + HMAC verify | `backend/internal/qr/payload.go` | `DecodePayload()` called directly in scan handler |
| Domain errors | `backend/internal/model/errors.go` | `ErrAlreadyCheckedIn`, `ErrNotFound` for scan responses |
| Health check pattern | `backend/internal/handler/health.go` | Redis/PG connectivity check pattern for scan handler |
| HMAC middleware | `backend/internal/middleware/hmac.go` | NOT used for scan endpoint (vendor devices are unauthenticated) |
| Config | `backend/internal/config/config.go` | Extend with scan-specific config (timeouts, queue names) |
| SQL queries | `backend/queries/scans.sql` | Extend with reconciliation queries, counter upserts |
| Migration | `backend/migrations/000001_init.up.sql` | New migration 000002 for schema additions |
| sqlc config | `backend/sqlc.yaml` | Generate Go code from updated SQL queries |
| chi router | `backend/cmd/server/main.go` | Add scan route group |
| go.mod | `backend/go.mod` | asynq already in dependencies |

## RESEARCH COMPLETE
