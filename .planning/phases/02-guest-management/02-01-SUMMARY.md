---
phase: 02-guest-management
plan: 01
subsystem: database
tags: [convex, search-index, phone-validation, pagination, bulk-import]

requires:
  - phase: 01-foundation-domain-model
    provides: Convex schema with events and guestCategories tables, model directory pattern
provides:
  - guests table with search indexes for name and phone
  - guest CRUD mutations with auth and validation
  - paginated guest list query with status and category filtering
  - search queries for name and phone via Convex search indexes
  - bulk import batch mutation (500-row chunks) with duplicate detection
  - duplicate phone pre-check query for import wizard
  - Bangladesh phone validation and normalization module
affects: [02-02-frontend, 03-qr-code-generation, 04-scan-processing, 08-invitation-sms]

tech-stack:
  added: []
  patterns: [search-index-per-field, phone-normalization, chunked-import, defense-in-depth-validation]

key-files:
  created:
    - convex/guests.ts
    - convex/model/guests.ts
    - convex/model/phone.ts
  modified:
    - convex/schema.ts

key-decisions:
  - "Two search indexes (search_name, search_phone) because Convex allows only 1 search field per index"
  - "Cursor-based pagination via usePaginatedQuery instead of Aggregate component for offset pagination -- simpler, sufficient for MVP"
  - "500-row batch size for imports to stay within Convex 16K document write limit with safety margin"
  - "Phone normalized to 01XXXXXXXXX before storage to ensure duplicate detection across +880 and local formats"
  - "Category filter is post-pagination (no compound index for eventId+categoryId+_creationTime) -- acceptable trade-off"
  - "countByEvent uses collect() -- acceptable for up to 60K, can optimize with Aggregate component later"

patterns-established:
  - "Phone normalization: all phone inputs pass through normalizePhone() before storage or comparison"
  - "Search routing: two separate search indexes, frontend routes to correct one based on input pattern"
  - "Import pipeline: client-side parse -> client-side validate -> server pre-check duplicates -> chunked mutation"
  - "Defense-in-depth: server re-validates data that client already validated"

requirements-completed: [GUST-01, GUST-02, GUST-03, GUST-04, GUST-05]

duration: 8min
completed: 2026-04-11
---

# Phase 2 Plan 01: Guest Management Backend Summary

**Convex backend with guests schema (dual search indexes), BD phone validation, CRUD mutations, paginated queries, and chunked bulk import pipeline for 60K guests**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-11
- **Completed:** 2026-04-11
- **Tasks:** 5 (combined into 3 atomic commits)
- **Files modified:** 4

## Accomplishments
- Guests table with 3 regular indexes and 2 search indexes deployed to Convex schema
- Bangladesh phone validation with normalization (01XXXXXXXXX canonical format)
- Full CRUD (create, update, remove) with auth checks, phone dedup, cross-event category validation
- Paginated list, dual search (name + phone), count, and filtered queries
- Bulk import pipeline: importBatch (500-row chunks), checkDuplicatePhones (pre-check), replaceGuest (resolution)

## Task Commits

1. **Task 1: Guest schema and phone validation** - `b296d17` (feat)
2. **Task 2: Guest business logic model** - `e12b50c` (feat)
3. **Tasks 3-5: Guest CRUD, queries, and import pipeline** - `a883649` (feat)

## Files Created/Modified
- `convex/model/phone.ts` - Bangladesh phone validation and normalization (BD_PHONE_REGEX, normalizePhone, validateBDPhone)
- `convex/model/guests.ts` - Guest business logic (validateGuestData, checkPhoneDuplicate)
- `convex/guests.ts` - All mutations (create, update, remove, importBatch, replaceGuest) and queries (getById, listByEvent, searchByName, searchByPhone, countByEvent, checkDuplicatePhones)
- `convex/schema.ts` - Extended with guests table, indexes, and search indexes

## Decisions Made
- Two search indexes needed (search_name, search_phone) since Convex limits 1 search field per index
- Chose cursor-based pagination over Aggregate component for simplicity -- page numbers can be added later
- 500-row batch size balances transaction limits, OCC window, and progress bar granularity
- Post-pagination category filtering acceptable since no compound index exists for eventId+categoryId

## Deviations from Plan

None - plan executed as written. Tasks 3, 4, and 5 were combined into a single commit since they all modify the same file (convex/guests.ts).

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Convex backend APIs ready for frontend consumption in Plan 02
- Search indexes will be created on next `npx convex dev` run
- Frontend can import from `api.guests.*` for all guest operations

---
*Phase: 02-guest-management*
*Completed: 2026-04-11*
