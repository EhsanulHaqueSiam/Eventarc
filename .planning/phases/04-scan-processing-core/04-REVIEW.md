---
phase: 4
status: clean
depth: standard
files_reviewed: 12
findings: 0
severity_counts:
  critical: 0
  high: 0
  medium: 0
  low: 0
  info: 0
---

# Phase 04 Code Review: Scan Processing Core

## Scope

12 source files reviewed (scan package, migrations, worker, config):
- `backend/internal/scan/lua.go`
- `backend/internal/scan/service.go`
- `backend/internal/scan/handler.go`
- `backend/internal/scan/types.go`
- `backend/internal/scan/pg.go`
- `backend/internal/scan/reseed.go`
- `backend/internal/scan/worker.go`
- `backend/internal/config/config.go`
- `backend/cmd/server/main.go`
- `backend/cmd/worker/main.go`
- `backend/migrations/000002_scan_processing.up.sql`
- `backend/queries/scans.sql`

## Findings

No issues found.

## Notes

**Security:**
- HMAC verification happens before any state change (service.go:55) -- forged payloads never reach Redis
- QR type validation rejects food QRs at entry gates (service.go:61-63)
- Scan endpoint is intentionally unauthenticated; QR payload HMAC is the auth mechanism
- No SQL injection risk -- sqlc generates parameterized queries

**Concurrency:**
- Redis Lua script (lua.go) combines SISMEMBER + SADD + HSET + HINCRBY atomically -- no TOCTOU window
- All 4 concurrent tests pass with Go race detector (500, 100, 1000, 200 goroutines)
- PG idempotency via INSERT ON CONFLICT DO NOTHING with idempotency key

**Architecture:**
- Clean separation: types.go (data), lua.go (atomics), service.go (pipeline), handler.go (HTTP), pg.go (persistence), reseed.go (recovery), worker.go (background)
- PG fallback on Redis miss handles post-restart scenarios gracefully
- Counter re-seeding uses MULTI/EXEC for atomic Redis writes

**Test Coverage:**
- 20 unit tests covering all scan outcomes (valid, duplicate, invalid HMAC, not found, wrong type, unified, counters, Lua atomicity, concurrency)
- 10 integration tests (PG persistence, counter reconciliation, re-seed atomicity)
