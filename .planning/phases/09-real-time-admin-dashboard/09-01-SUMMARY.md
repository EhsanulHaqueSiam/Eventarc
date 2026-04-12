---
phase: 09-real-time-admin-dashboard
plan: 01
subsystem: api
tags: [sse, redis, pubsub, go, chi, real-time, streaming]

requires:
  - phase: 04-scan-processing-core
    provides: Redis atomic counters (event:{id}:counters hash), Redis Pub/Sub channel (event:{id}:scans)
  - phase: 05-food-scan-rules-engine
    provides: Food consumption counters in Redis hash (food:{cat}:total keys)
provides:
  - SSEBroker managing per-event client channels with subscribe/unsubscribe/broadcast
  - SSE HTTP handler at GET /api/v1/events/{eventId}/live with snapshot-then-delta streaming
  - SSE event types (snapshot, counters, stall_activity, alert, heartbeat)
  - Dashboard data structures (DashboardSnapshot, AttendanceData, FoodCategoryData, Alert, SystemHealthData)
  - Redis Pub/Sub subscription forwarding scan events as typed SSE events
  - Heartbeat comments every 15s for proxy keepalive
affects: [09-02-frontend-dashboard, phase-10-auth]

tech-stack:
  added: []
  patterns: [SSE streaming via net/http Flusher, per-event broker with mutex-protected client map, non-blocking broadcast with slow client drop]

key-files:
  created:
    - backend/internal/sse/types.go
    - backend/internal/sse/broker.go
    - backend/internal/sse/broker_test.go
    - backend/internal/sse/handler.go
    - backend/internal/sse/handler_test.go
  modified:
    - backend/cmd/server/main.go

key-decisions:
  - "Broker cleanup does not close channels — prevents send-on-closed-channel race between Broadcast and cleanup goroutines"
  - "Handler accepts redis.Cmdable interface for snapshot but type-asserts to *redis.Client for Pub/Sub Subscribe (miniredis testing compatible)"
  - "SSE endpoint open for development — TODO(phase-10) for admin session cookie validation middleware"

patterns-established:
  - "SSE broker pattern: per-event client map with buffered channels, non-blocking send, mutex-protected subscribe/unsubscribe"
  - "Snapshot-then-delta: HGETALL for initial state, then Redis Pub/Sub for incremental updates"
  - "DASH-05 compliance: dashboard reads only Redis counters, never queries scan tables"

requirements-completed: [DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06]

duration: 4min
completed: 2026-04-12
---

# Phase 09, Plan 01: SSE Backend Summary

**Go SSE endpoint with per-event broker, Redis counter snapshots, and Pub/Sub delta streaming for live admin dashboard**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-12T05:48:22Z
- **Completed:** 2026-04-12T05:52:50Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- SSE broker manages per-event client connections with subscribe/unsubscribe/broadcast; slow clients dropped via non-blocking send
- SSE handler streams initial snapshot from Redis HGETALL (attendance, food, scan counters) then forwards Redis Pub/Sub messages as typed SSE events
- Route registered at GET /api/v1/events/{eventId}/live with proper SSE headers (Content-Type, Cache-Control, X-Accel-Buffering)
- 22 tests pass with -race flag (9 broker, 13 handler)
- DASH-05 verified: zero scan table queries in SSE package

## Task Commits

Each task was committed atomically:

1. **Task 1: SSE types and broker** - `da924cc` (feat)
2. **Task 2: SSE handler with Redis snapshot and Pub/Sub** - `6f388eb` (feat)
3. **Task 3: Register SSE route in main.go** - `7df7f77` (feat)

## Files Created/Modified
- `backend/internal/sse/types.go` - SSE event types and dashboard data structures
- `backend/internal/sse/broker.go` - Per-event SSE client broker with buffered channels
- `backend/internal/sse/broker_test.go` - 9 broker tests (subscribe, broadcast, slow client, concurrent access)
- `backend/internal/sse/handler.go` - SSE HTTP handler with snapshot, Pub/Sub, heartbeat
- `backend/internal/sse/handler_test.go` - 13 handler tests (headers, snapshot, pub/sub, alerts, cleanup, parsing)
- `backend/cmd/server/main.go` - Added SSE broker init and route registration

## Decisions Made
- Broker cleanup removes channel from map but does NOT close it — closing causes send-on-closed-channel panic when Broadcast runs concurrently with cleanup. Channel becomes unreachable and is GC'd.
- Handler accepts `redis.Cmdable` interface for testability (miniredis) but type-asserts to `*redis.Client` for Pub/Sub since Subscribe is not on the Cmdable interface.
- SSE endpoint is open (no auth middleware) for development. Phase 10 will add admin session validation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed race condition in broker cleanup**
- **Found during:** Task 1 (broker tests with -race)
- **Issue:** Original cleanup function called `close(ch)` while Broadcast goroutines might still be sending to the channel
- **Fix:** Removed `close(ch)` from cleanup — channel is removed from map (unreachable) and GC'd
- **Files modified:** backend/internal/sse/broker.go
- **Verification:** All 9 tests pass with -race, including TestConcurrentAccessDoesNotPanic
- **Committed in:** da924cc (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for data race correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SSE backend ready for frontend consumption in Plan 09-02
- Endpoint: GET /api/v1/events/{eventId}/live
- SSE event types: snapshot, counters, stall_activity, alert (plus heartbeat comments)
- Frontend can connect via EventSource API and receive JSON payloads

---
*Phase: 09-real-time-admin-dashboard*
*Completed: 2026-04-12*
