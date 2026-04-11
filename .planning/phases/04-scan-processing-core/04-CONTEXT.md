# Phase 4: Scan Processing Core - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the entry scan processing pipeline in the Go microservice: QR HMAC validation, guest existence check (Redis primary, PG fallback), atomic check-in with dual write (Redis first, PG via background retry), idempotent duplicate detection via INSERT ON CONFLICT, atomic Redis counters (HINCRBY), counter re-seeding from PG on Redis restart, and load testing at 10K concurrent requests. No food scanning (Phase 5), no vendor UI (Phase 6), no offline handling (Phase 7).

Requirements: SCAN-01, SCAN-02, SCAN-04, SCAN-05, SCAN-06, SCAN-07, SCAN-08, SCAN-09, INFR-03, INFR-04

</domain>

<decisions>
## Implementation Decisions

### Scan Validation Pipeline
- **D-01:** Claude's discretion on Redis-only vs Redis-primary-with-PG-fallback for scan-time validation. Should consider the architecture constraint (D-03 from Phase 1: zero Convex calls during scanning, Redis is fast read path).
- **D-02:** On Redis miss (valid HMAC but guest not in cache): check PG as fallback, and if found, add to Redis cache and proceed with scan. Self-healing approach to prevent false negatives from incomplete syncs.
- **D-03:** Claude's discretion on Convex sync-back strategy after successful scans. Should consider latency impact — scan hot path must not be affected by Convex availability. Async bridge (asynq job or Redis pub/sub to Convex HTTP action) is the recommended approach.

### Dual-Write Atomicity
- **D-04:** Write order: Redis first (fastest acknowledgment to vendor), then PostgreSQL. Vendor device gets immediate confirmation. PG write follows.
- **D-05:** On PG write failure after Redis success: retry via asynq background job with idempotency key. Redis has correct state immediately. PG catches up within seconds. Idempotency key prevents duplicate records on retry.
- **D-06:** Idempotent PG writes via INSERT ON CONFLICT with client-generated idempotency keys (SCAN-05). No check-then-act patterns — the database enforces uniqueness atomically.

### Scan Response & Feedback
- **D-07:** Successful entry scan returns: guest name, guest category label, and a photo placeholder field (for future feature). Vendor sees who they scanned.
- **D-08:** Duplicate scan ("already checked in") returns: rejection status, original check-in timestamp, and gate/stall info where guest originally checked in. Helps vendor explain to guest.

### Load Testing & Verification
- **D-09:** External load testing tool: k6 or vegeta (Go-based). Not Go benchmark goroutines — external HTTP load for realistic testing.
- **D-10:** Passing criteria: zero errors across 10K concurrent requests + p95 latency under 200ms. Also: Go race detector (-race) must show no data races.
- **D-11:** Counter reconciliation test: verify that after Redis restart, counters are re-seeded from PG and match expected values.

### Claude's Discretion
Claude has flexibility on: Redis validation strategy (D-01), Convex sync-back mechanism (D-03), exact Redis data structures for guest cache and check-in tracking, PG schema for entry_scans table (building on Phase 1 migration placeholder), Redis counter key naming, idempotency key format, load test script details, k6 vs vegeta choice.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Architecture
- `.planning/PROJECT.md` — Core value (zero race conditions, zero false positives/negatives)
- `.planning/REQUIREMENTS.md` — SCAN-01 through SCAN-09, INFR-03, INFR-04
- `.planning/ROADMAP.md` — Phase 4 success criteria, dependency graph

### Upstream Dependencies
- `.planning/phases/01-foundation-domain-model/01-CONTEXT.md` — Go microservice architecture, HMAC auth (D-14), Redis sync (D-03/D-09), domain errors (D-24), slog logging (D-25)
- `.planning/phases/01-foundation-domain-model/01-RESEARCH.md` — Go project structure, chi router patterns, pgx/v5 usage, go-redis patterns, HMAC middleware implementation
- `.planning/phases/03-qr-code-generation-pipeline/03-CONTEXT.md` — QR payload format (D-01: compact binary with version byte + HMAC), guest-linked vs anonymous modes
- `backend/internal/middleware/hmac.go` — Existing HMAC verification middleware
- `backend/internal/handler/sync.go` — Sync endpoint stub (data arrives here from Convex)
- `backend/internal/model/errors.go` — Domain error types (ErrNotFound, ErrAlreadyCheckedIn, etc.)
- `backend/migrations/000001_init.up.sql` — Existing PG schema (entry_scans, event_counters tables)
- `docker-compose.yml` — PG + PgBouncer + Redis infrastructure

### External Documentation (researcher should fetch latest)
- PostgreSQL INSERT ON CONFLICT documentation — idempotent upsert patterns
- Redis HINCRBY / HSET documentation — atomic counter and hash operations
- go-redis v9 pipelining documentation — batch Redis operations for performance
- k6 or vegeta load testing documentation — HTTP load generation, result analysis
- asynq task handler documentation — background job retry patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/internal/middleware/hmac.go` — HMAC verification (reuse for QR payload HMAC validation)
- `backend/internal/handler/health.go` — Health endpoint pattern (Redis + PG connectivity checks)
- `backend/internal/handler/sync.go` — Sync handler stub (receives event data from Convex)
- `backend/internal/model/errors.go` — Domain errors (ErrNotFound, ErrAlreadyCheckedIn, ErrDuplicate)
- `backend/internal/config/config.go` — Environment config loading

### Established Patterns
- chi router with middleware chain (logging, CORS, HMAC)
- slog structured logging with request_id, method, path, duration_ms
- JSON error response envelope: `{"error": {"code": "...", "message": "...", "details": {...}}}`
- pgx/v5 with pgxpool for PG connection management
- go-redis/v9 for Redis operations

### Integration Points
- `POST /api/v1/scan/entry` — the main scan endpoint to implement
- Redis hash/set structures for guest cache and check-in tracking
- PG entry_scans table for durable scan records
- asynq for background PG write retries and Convex sync-back
- Redis pub/sub for broadcasting scan events to SSE (Phase 9)

</code_context>

<specifics>
## Specific Ideas

- Redis-first write order means vendor gets sub-200ms response — PG durability follows via background retry
- INSERT ON CONFLICT is the core correctness mechanism — no application-level check-then-act
- The photo placeholder in scan response is forward-looking (no photo system exists yet)
- Gate/stall info in duplicate response helps vendors at large events with multiple entry points
- p95 < 200ms is stricter than the "sub-second" requirement but ensures snappy vendor experience
- Counter re-seeding from PG on Redis restart is critical for dashboard accuracy after infrastructure incidents

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-scan-processing-core*
*Context gathered: 2026-04-11*
