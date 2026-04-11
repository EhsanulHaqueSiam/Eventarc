---
phase: 01-foundation-domain-model
plan: 02
subsystem: api
tags: [convex, better-auth, typescript, state-machine, crud]

requires: []
provides:
  - Convex schema with events and guestCategories tables
  - Better Auth email/password admin authentication via Convex adapter
  - Event CRUD mutations with lifecycle state machine validation
  - Event configuration management (QR strategy, food QR mode/timing)
  - Guest category CRUD with auto-default "General" category
  - Auto go-live scheduled function (D-08)
affects: [vendor-hierarchy, guest-import, qr-generation, data-sync, admin-dashboard]

tech-stack:
  added: [convex, "@convex-dev/better-auth", "better-auth@1.5.3"]
  patterns: [convex-schema-validation, state-machine-transitions, auth-identity-checks, scheduled-functions]

key-files:
  created:
    - convex/schema.ts
    - convex/convex.config.ts
    - convex/auth.config.ts
    - convex/auth.ts
    - convex/http.ts
    - convex/model/events.ts
    - convex/model/categories.ts
    - convex/events.ts
    - convex/categories.ts
    - convex/tsconfig.json
    - package.json
    - pnpm-lock.yaml
  modified: []

key-decisions:
  - "Better Auth pinned to 1.5.3 per Convex docs compatibility requirement"
  - "Event config stored as nested object on event document (not separate table)"
  - "State machine enforced in mutation layer, not middleware"

patterns-established:
  - "Auth pattern: every public mutation calls ctx.auth.getUserIdentity() and throws if null"
  - "Validation pattern: args validated in mutation handler before database operations"
  - "State machine pattern: VALID_TRANSITIONS map with validateTransition() function"
  - "Default creation pattern: auto-create related records (General category on event creation)"

requirements-completed: [EVNT-01, EVNT-02, EVNT-03, EVNT-04]

duration: 10min
completed: 2026-04-11
---

# Plan 01-02: Convex Schema & Event CRUD Summary

**Convex schema with events + guestCategories, Better Auth admin auth, event lifecycle state machine (5 states), and category CRUD with auto-default**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-11T14:54:00Z
- **Completed:** 2026-04-11T15:04:00Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Convex schema defines events table with 5-state status union, nested config object (qrStrategy, foodQrMode, foodQrTiming), and proper indexes
- Better Auth configured with email/password, crossDomain plugin, and Convex adapter
- Event lifecycle state machine: draft->active->live->completed->archived with active->draft revert
- Auto go-live scheduled function fires at eventDate to transition active->live (idempotent per D-08)
- Config locked after event goes live (isConfigLocked check prevents modification)
- Default "General" category auto-created on event creation (D-11)
- Category CRUD with uniqueness validation per event and delete protection for default category
- All mutations require authentication via ctx.auth.getUserIdentity()

## Task Commits

Each task was committed atomically:

1. **Task 1: Convex project init, schema, Better Auth setup** - `4000c7f` (feat)
2. **Task 2: Event CRUD, state machine, category management** - `a647c73` (feat)

## Files Created/Modified
- `convex/schema.ts` - Full schema with events and guestCategories tables
- `convex/convex.config.ts` - Convex app config with Better Auth component
- `convex/auth.config.ts` - Auth config with Better Auth provider
- `convex/auth.ts` - Better Auth setup with email/password, getCurrentUser query
- `convex/http.ts` - HTTP router with auth routes
- `convex/model/events.ts` - Event lifecycle state machine (VALID_TRANSITIONS, validateTransition, isConfigLocked)
- `convex/model/categories.ts` - Category business logic (createDefaultCategory, validateCategoryName)
- `convex/events.ts` - Event CRUD: create, getById, list, update, updateConfig, updateStatus, remove, autoGoLive
- `convex/categories.ts` - Category CRUD: create, listByEvent, update, remove
- `convex/tsconfig.json` - TypeScript config for Convex functions
- `package.json` - Root package with convex, better-auth dependencies
- `pnpm-lock.yaml` - Lock file

## Decisions Made
- Better Auth pinned to exactly 1.5.3 per Convex docs compatibility
- Event config stored as nested v.object on event document per D-19 research

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Convex codegen requires an active deployment connection (`npx convex dev`). The _generated directory cannot be created offline. TypeScript typecheck deferred until user runs `npx convex dev` to set up the Convex deployment.

## User Setup Required

**Convex deployment requires manual configuration.** The user needs to:
1. Run `npx convex dev` from the project root
2. Follow the prompts to create or link a Convex project named "eventarc"
3. This generates `convex/_generated/` files and connects to the Convex cloud
4. After setup, `npx convex typecheck` will validate all TypeScript

Environment variables auto-populated by `npx convex dev`:
- `VITE_CONVEX_URL` - Convex deployment URL
- `CONVEX_DEPLOYMENT` - Deployment identifier

## Next Phase Readiness
- Schema defines events and guestCategories tables, ready for vendor hierarchy (Plan 03)
- Event CRUD ready for admin dashboard integration
- Auth ready for protecting all admin mutations
- State machine ready for go-live trigger and data sync (Phase 4)

---
*Phase: 01-foundation-domain-model*
*Completed: 2026-04-11*
