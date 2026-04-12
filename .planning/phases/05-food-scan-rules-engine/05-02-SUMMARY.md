---
phase: 05-food-scan-rules-engine
plan: "05-02"
subsystem: api
tags: [convex, postgresql, redis, asynq, sync, reconciliation, food-rules]

requires:
  - phase: 05-food-scan-rules-engine
    plan: "05-01"
    provides: Food scan Lua script, Service struct, ProcessFoodScan pipeline
provides:
  - Convex foodRules table with CRUD mutations (listByEvent, setRule, setBulkRules, deleteRule)
  - Food rules sync from Convex to Redis via SyncFoodRules pipeline
  - Anonymous token sync via SyncAnonymousTokens
  - PostgreSQL food_scans table with 4 indexes for reconciliation and metrics
  - sqlc-generated Go queries (6 named queries)
  - asynq food_scan:pg_write background worker with idempotent PG writes
  - Food counter reconciliation (ReconcileFoodCounters) for Redis restart recovery
affects: [06-vendor-scanning, 09-real-time-dashboard, 10-hardening]

tech-stack:
  added: []
  patterns:
    - "Full-replace food rules sync (DEL + pipeline HSET) for stale-proof Redis state"
    - "Dual-write pattern: Redis-first for speed, PG via asynq background job for durability"
    - "Counter reconciliation re-seeds per-guest consumption + dashboard counters from PG"

key-files:
  created:
    - convex/foodRules.ts
    - backend/internal/scan/food_sync.go
    - backend/internal/scan/food_reconcile.go
    - backend/internal/scan/food_asynq.go
    - backend/internal/scan/food_sync_test.go
    - backend/internal/scan/food_reconcile_test.go
    - backend/migrations/000003_food_scans.up.sql
    - backend/migrations/000003_food_scans.down.sql
    - backend/queries/food_scans.sql
    - backend/internal/db/food_scans.sql.go
  modified:
    - convex/schema.ts
    - convex/sync.ts
    - backend/internal/scan/food_service.go
    - backend/cmd/worker/main.go
    - backend/internal/db/models.go
    - backend/internal/db/querier.go

key-decisions:
  - "Food rules sync uses full-replace (DEL + HSET) not incremental update — simpler, stale-proof"
  - "food_scans idempotency_key includes timestamp (food:{eventId}:{guestId}:{categoryId}:{timestamp}) since multiple valid scans per guest are allowed"
  - "Reconciliation re-seeds consumption + dashboard counters but NOT consumption log (convenience, not correctness)"
  - "food:initialized marker field in counters hash detects Redis restart"

patterns-established:
  - "Convex internal query + internal action for sync: query fetches data, action POSTs to Go"
  - "sqlc :one with ON CONFLICT DO NOTHING for idempotent PG inserts"
  - "Pipeline batch writes for both food rules sync and reconciliation"

requirements-completed: [FOOD-01, FOOD-02, FOOD-03, FOOD-04, SCAN-03]

duration: 12min
completed: 2026-04-12
---

# Plan 05-02: Food Rules Sync, PG Migration, Counter Reconciliation Summary

**Convex foodRules CRUD, food rules sync to Redis, PostgreSQL food_scans table, asynq PG write worker, and food counter reconciliation for Redis restart recovery**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-04-12
- **Tasks:** 8
- **Files created:** 10
- **Files modified:** 6

## Accomplishments
- Convex foodRules table stores admin-configured matrix of guest categories x food categories with limits (-1 unlimited, 0+ capped)
- setRule mutation validates: limit >= -1, guestCategory belongs to event, foodCategory under "food" vendorType, upsert via by_event_guest_food index
- Food rules synced from Convex to Redis via full-replace pipeline (DEL + HSET) — no stale entries after admin update
- PostgreSQL food_scans table durably stores all food scan records with idempotency_key UNIQUE constraint and 4 indexes
- sqlc generates type-safe Go code for 6 queries: insert, consumption history, per-guest counts, per-category/stall dashboard counters
- asynq food_scan:pg_write worker persists food scans to PG after Redis success (dual-write pattern, MaxRetry 5)
- ReconcileFoodCounters rebuilds per-guest consumption state and dashboard food counters from PG after Redis restart
- All 8 new tests pass with -race flag, full scan package (05-01 + 05-02) passes clean

## Task Commits

1. **Task 1: foodRules schema** - `b52b5db` (feat)
2. **Task 2: foodRules CRUD mutations** - `dae128d` (feat)
3. **Task 3: Food rules sync + Convex action** - `41fe742` (feat)
4. **Task 4: food_scans PG migration** - `3cd2c84` (feat)
5. **Task 5: sqlc queries + generated code** - `42fd3b4` (feat)
6. **Task 6: asynq PG write worker** - `eff9fae` (feat)
7. **Task 7: Food counter reconciliation** - `9165d29` (feat)
8. **Task 8: Sync + reconciliation tests** - `7a1699d` (test)

## Files Created/Modified
- `convex/schema.ts` — Added foodRules table with by_event and by_event_guest_food indexes
- `convex/foodRules.ts` — listByEvent, setRule (upsert), setBulkRules, deleteRule
- `convex/sync.ts` — syncFoodRules internal action, getFoodRulesByEvent internal query
- `backend/internal/scan/food_sync.go` — SyncFoodRules, SyncAnonymousTokens with pipeline batch writes
- `backend/internal/scan/food_reconcile.go` — ReconcileFoodCounters, CheckFoodCountersExist, MarkFoodCountersInitialized
- `backend/internal/scan/food_asynq.go` — TaskFoodScanPGWrite, NewFoodScanPGWriteTask, HandleFoodScanPGWrite
- `backend/internal/scan/food_service.go` — Added PG write enqueue after successful Lua OK result
- `backend/cmd/worker/main.go` — Registered food_scan:pg_write handler
- `backend/migrations/000003_food_scans.up.sql` — food_scans table with 4 indexes
- `backend/queries/food_scans.sql` — 6 named sqlc queries
- `backend/internal/db/food_scans.sql.go` — sqlc-generated Go code
- `backend/internal/scan/food_sync_test.go` — 5 sync tests
- `backend/internal/scan/food_reconcile_test.go` — 3 reconciliation tests

## Decisions Made
- Food rules sync uses full-replace (DEL + HSET pipeline) not incremental — ensures no stale rules after admin update
- food_scans idempotency_key includes timestamp since guests can have multiple valid food scans (up to limit)
- Reconciliation re-seeds consumption and dashboard counters but NOT consumption log (convenience, not correctness-critical)
- food:initialized marker in counters hash enables startup detection of Redis restart

## Deviations from Plan
None — plan executed as specified.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Food scan infrastructure complete: Redis atomic processing (05-01) + durable storage + configuration + reconciliation (05-02)
- Ready for Phase 6 (vendor scanning UI) to consume food scan endpoint
- Ready for Phase 9 (real-time dashboard) to read food counters
- Ready for Phase 10 (hardening) integration tests

---
*Phase: 05-food-scan-rules-engine*
*Completed: 2026-04-12*
