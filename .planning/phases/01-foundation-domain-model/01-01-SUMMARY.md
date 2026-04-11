---
phase: 01-foundation-domain-model
plan: 01
subsystem: infra
tags: [go, chi, postgresql, pgbouncer, redis, docker, hmac, slog]

requires: []
provides:
  - Docker Compose stack with PostgreSQL 17, PgBouncer, Redis 8
  - Go microservice with chi router, health and sync endpoints
  - HMAC-SHA256 authentication middleware for Convex-to-Go calls
  - Database migration infrastructure with entry_scans and event_counters tables
  - Multi-stage Dockerfile for production deployment
  - Domain error types for Go service layer
affects: [scan-processing, data-sync, background-jobs, vendor-scanning]

tech-stack:
  added: [go-chi/chi/v5, jackc/pgx/v5, redis/go-redis/v9, bitnami/pgbouncer, postgres:17, redis:8-alpine]
  patterns: [chi-router-middleware-stack, hmac-signed-requests, slog-structured-logging, env-config-with-defaults]

key-files:
  created:
    - docker-compose.yml
    - backend/cmd/server/main.go
    - backend/internal/config/config.go
    - backend/internal/middleware/hmac.go
    - backend/internal/middleware/logging.go
    - backend/internal/middleware/cors.go
    - backend/internal/handler/health.go
    - backend/internal/handler/sync.go
    - backend/internal/model/errors.go
    - backend/migrations/000001_init.up.sql
    - backend/migrations/000001_init.down.sql
    - backend/Dockerfile
    - backend/sqlc.yaml
    - backend/queries/scans.sql
    - .env.example
    - .gitignore
  modified: []

key-decisions:
  - "Used golang:1.24-alpine for Dockerfile builder (plan specified 1.26 which does not exist yet)"
  - "PgBouncer pool_size set to 150 with max_client_conn 10000 for 10K concurrent scan target"
  - "HMAC middleware uses 5-minute replay window with RFC3339 timestamps"

patterns-established:
  - "Config pattern: environment variables with getEnv(key, fallback) helper"
  - "Error pattern: domain errors as sentinel values, ErrorResponse/ErrorDetail JSON envelope"
  - "Middleware pattern: chi middleware composition with RequestID, RealIP, Recoverer, Logger, CORS"
  - "HMAC pattern: X-Signature + X-Timestamp headers, HMAC-SHA256(secret, timestamp+body)"

requirements-completed: [INFR-01, INFR-02]

duration: 12min
completed: 2026-04-11
---

# Plan 01-01: Go Infrastructure Scaffold Summary

**Docker Compose with PG 17 + PgBouncer + Redis 8, Go chi router with HMAC auth middleware, health/sync endpoints, and 12 passing tests**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-11T14:42:06Z
- **Completed:** 2026-04-11T14:54:00Z
- **Tasks:** 2
- **Files modified:** 22

## Accomplishments
- Docker Compose orchestrates PostgreSQL 17, PgBouncer (transaction pooling, pool_size=150), and Redis 8 with health checks
- Go microservice with chi router serves /api/v1/health (Redis+PG connectivity) and /api/v1/sync/event (HMAC-protected stub)
- HMAC-SHA256 middleware verifies signatures with 5-minute replay protection and constant-time comparison
- Request logging via slog with method, path, status, duration_ms, request_id
- CORS middleware with dev (allow all) and production (origin allowlist) modes
- Domain error types (ErrNotFound, ErrDuplicate, ErrAlreadyCheckedIn, etc.) with JSON envelope
- Database migrations ready for entry_scans and event_counters tables
- Multi-stage Dockerfile produces minimal Alpine image

## Task Commits

Each task was committed atomically:

1. **Task 1: Docker Compose, .env, Go module, config, domain errors, migrations** - `0ccbe2f` (feat)
2. **Task 2: Go HTTP server, HMAC middleware, health, sync, logging, CORS, Dockerfile** - `b3dadc3` (feat)

## Files Created/Modified
- `docker-compose.yml` - PG 17, PgBouncer, Redis 8 service definitions with health checks
- `backend/cmd/server/main.go` - Go entrypoint with chi router, graceful shutdown
- `backend/internal/config/config.go` - Environment-based config with defaults
- `backend/internal/config/config_test.go` - Config loading and IsProduction tests
- `backend/internal/middleware/hmac.go` - HMAC-SHA256 signature verification
- `backend/internal/middleware/hmac_test.go` - 7 HMAC test cases
- `backend/internal/middleware/logging.go` - slog request logging
- `backend/internal/middleware/cors.go` - CORS handling (dev/production modes)
- `backend/internal/handler/health.go` - Health check with Redis+PG pings
- `backend/internal/handler/health_test.go` - Health handler shape tests
- `backend/internal/handler/sync.go` - Sync event stub (Phase 4 implementation)
- `backend/internal/model/errors.go` - Domain error types and JSON envelope
- `backend/migrations/000001_init.up.sql` - entry_scans + event_counters tables
- `backend/migrations/000001_init.down.sql` - Rollback migration
- `backend/sqlc.yaml` - sqlc code generation config
- `backend/queries/scans.sql` - InsertEntryScan and GetEntryScanByGuest queries
- `backend/Dockerfile` - Multi-stage build (golang:1.24-alpine -> alpine:3.21)
- `.env.example` - Placeholder environment variables
- `.gitignore` - Excludes .env, node_modules, build artifacts

## Decisions Made
- Used golang:1.24-alpine instead of plan's 1.26 (1.26 does not exist; 1.24 is current stable)
- chi v5.2.1 installed (plan specified v5.2.5 which is not available)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing pgxpool dependency**
- **Found during:** Task 2 (main.go compilation)
- **Issue:** pgxpool import required jackc/puddle/v2 which was not in go.sum
- **Fix:** Ran `go get github.com/jackc/pgx/v5/pgxpool@v5.9.1 && go mod tidy`
- **Files modified:** backend/go.mod, backend/go.sum
- **Verification:** `go build ./...` exits 0
- **Committed in:** b3dadc3

**2. [Rule 1 - Bug] Corrected Go and chi versions**
- **Found during:** Task 2 (Dockerfile and dependency resolution)
- **Issue:** Plan specified golang:1.26 (nonexistent) and chi v5.2.5 (unavailable)
- **Fix:** Used golang:1.24-alpine and chi v5.2.1 (latest available)
- **Verification:** Build succeeds, all tests pass

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Version corrections necessary for compilation. No functional difference.

## Issues Encountered
None beyond the version corrections noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Go infrastructure scaffold complete, ready for scan processing logic in Phase 4
- Docker Compose stack ready for local development
- HMAC middleware ready for Convex->Go sync calls
- Migration infrastructure ready for golang-migrate

---
*Phase: 01-foundation-domain-model*
*Completed: 2026-04-11*
