---
phase: 06-vendor-scanning-interface
plan: 01
subsystem: api, ui
tags: [go, redis, convex, react, tanstack-router, session-management, qr-scanner]

requires:
  - phase: 01-foundation-domain-model
    provides: chi router, Redis client, HMAC middleware, vendor hierarchy schema (vendorTypes, vendorCategories, stalls)
provides:
  - Go session endpoints (create/validate/revoke) with Redis storage
  - Convex deviceSessions table with admin queries (listByEvent, revoke, heartbeat)
  - vendorTypes.listByEvent and vendorCategories.listByVendorType Convex queries
  - Frontend /scanner route without admin shell
  - ScannerSetup component with cascading stall selection dropdowns
  - useDeviceSession hook with localStorage persistence and backend validation
  - CascadingSelect reusable component
affects: [06-02-camera-scanning, 07-offline-resilience, 09-real-time-dashboard]

tech-stack:
  added: []
  patterns: [server-side session tokens in Redis, cascading dropdown pattern, conditional admin shell exclusion]

key-files:
  created:
    - backend/internal/model/session.go
    - backend/internal/handler/session.go
    - backend/internal/handler/session_test.go
    - convex/deviceSessions.ts
    - convex/vendorTypes.ts
    - convex/vendorCategories.ts
    - frontend/src/routes/scanner/index.tsx
    - frontend/src/components/scanner/scanner-setup.tsx
    - frontend/src/components/scanner/cascading-select.tsx
    - frontend/src/hooks/use-device-session.ts
    - frontend/src/hooks/use-device-session.test.ts
    - frontend/src/components/scanner/scanner-setup.test.tsx
  modified:
    - backend/cmd/server/main.go
    - convex/schema.ts
    - frontend/src/routes/__root.tsx
    - frontend/vitest.config.ts

key-decisions:
  - "Session tokens are 64-character hex strings (32 random bytes via crypto/rand) stored in Redis with no TTL (D-05: sessions last until event ends)"
  - "Scanner route excluded from admin shell via conditional check in __root.tsx (isScannerPage = pathname.startsWith('/scanner'))"
  - "Public endpoints POST/GET /api/v1/session (no auth), admin endpoint DELETE /api/v1/admin/session/{token} (HMAC-protected)"
  - "Fixed vitest.config.ts to include convex/_generated alias matching vite.config.ts for test resolution"

patterns-established:
  - "Server-side session: Go generates token -> Redis stores session JSON -> frontend persists token in localStorage -> validates on mount"
  - "Cascading dropdowns: parent change resets all child selections, Convex useQuery with 'skip' arg when parent not selected"
  - "Route-based layout exclusion: __root.tsx checks pathname prefix to bypass AppShell for scanner routes"

requirements-completed: [VSCN-01, VSCN-02, VSCN-05]

duration: 20min
completed: 2026-04-12
---

# Plan 06-01: Device Session Management Summary

**Go session endpoints with Redis token storage, Convex admin queries, and cascading stall selection UI at /scanner**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-12T09:40:00Z
- **Completed:** 2026-04-12T09:55:00Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- Go session CRUD: CreateSession (201), ValidateSession (200/401), RevokeSession (204) with Redis storage at `session:{token}` keys
- Convex deviceSessions table with indexes (by_event, by_event_status, by_token) and mutations (create, revoke, heartbeat) plus queries (listByEvent, listAll)
- Frontend /scanner route renders without admin shell; ScannerSetup shows 4 cascading dropdowns (event -> vendor type -> category -> stall) with "Start Scanning" gated on all selections
- useDeviceSession hook manages full session lifecycle: localStorage persistence, backend validation on mount, create/clear operations

## Task Commits

Each task was committed atomically:

1. **Task 1: Go session management endpoints + Convex deviceSessions schema** - `0d12b5f` (feat)
2. **Task 2: Frontend scanner route with stall selection and session management** - `edf5b20` (feat)

## Files Created/Modified
- `backend/internal/model/session.go` - DeviceSession struct, GenerateSessionToken (32-byte crypto/rand)
- `backend/internal/handler/session.go` - SessionHandler with Create/Validate/Revoke endpoints
- `backend/internal/handler/session_test.go` - 10 test cases using miniredis (create, validate, revoke, token format)
- `backend/cmd/server/main.go` - Session routes added (public + HMAC-protected admin)
- `convex/schema.ts` - deviceSessions table added
- `convex/deviceSessions.ts` - create, listByEvent, listAll, revoke, heartbeat
- `convex/vendorTypes.ts` - listByEvent query for cascading dropdown
- `convex/vendorCategories.ts` - listByVendorType query for cascading dropdown
- `frontend/src/routes/__root.tsx` - Scanner route exclusion from admin shell
- `frontend/src/routes/scanner/index.tsx` - Scanner page with session state routing
- `frontend/src/components/scanner/scanner-setup.tsx` - Stall selection with 4 cascading dropdowns
- `frontend/src/components/scanner/cascading-select.tsx` - Reusable cascading select with animation/skeleton
- `frontend/src/hooks/use-device-session.ts` - Session token lifecycle hook
- `frontend/src/hooks/use-device-session.test.ts` - 5 test cases (null token, validation, create, clear)
- `frontend/src/components/scanner/scanner-setup.test.tsx` - 6 test cases (heading, dropdowns, button state)
- `frontend/vitest.config.ts` - Added convex/_generated alias for test resolution

## Decisions Made
- Session tokens have no TTL per D-05 (sessions last until event ends/revoked)
- Used conditional pathname check in __root.tsx rather than a separate route tree for scanner
- Fixed vitest config to align aliases with vite config (convex/_generated path resolution)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed vitest alias resolution for convex/_generated**
- **Found during:** Task 2 (scanner-setup test execution)
- **Issue:** vitest.config.ts lacked the convex/_generated alias that vite.config.ts has, causing import errors in tests
- **Fix:** Added path-based aliases for both `@` and `convex/_generated` to vitest.config.ts
- **Files modified:** frontend/vitest.config.ts
- **Verification:** All 11 tests pass (5 hook + 6 component)
- **Committed in:** edf5b20 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for test execution. No scope creep.

## Issues Encountered
None beyond the vitest alias fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Session endpoints and stall selection UI ready for Plan 06-02 camera scanning integration
- useDeviceSession hook provides session token for scan requests
- Placeholder in scanner/index.tsx for "Camera scanning coming in Plan 02" ready to be replaced

---
*Phase: 06-vendor-scanning-interface*
*Completed: 2026-04-12*
