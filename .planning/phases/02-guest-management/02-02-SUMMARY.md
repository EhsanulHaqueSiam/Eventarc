---
phase: 02-guest-management
plan: 02
subsystem: frontend
tags: [react, import-wizard, search, pagination, zustand, sheetjs]

requires:
  - phase: 02-guest-management
    plan: 01
    provides: Convex backend with guests CRUD, search, import APIs
provides:
  - Guest list page with search, filtering, and paginated table
  - Add Guest dialog with BD phone validation
  - 5-step import wizard (upload, map columns, validate, resolve duplicates, confirm)
  - Import wizard Zustand store for multi-step state management
  - Client-side CSV/Excel parsing via SheetJS
  - Chunked batch import with progress tracking (500 rows per batch)
  - Guests tab in event detail page
affects: [03-qr-code-generation, 08-invitation-sms]

tech-stack:
  added: []
  patterns: [zustand-wizard-store, debounced-search, chunked-import, file-drag-drop]

key-files:
  created:
    - frontend/src/components/guests/import-wizard/use-import-store.ts
    - frontend/src/components/guests/import-wizard/wizard-shell.tsx
    - frontend/src/components/guests/import-wizard/step-upload.tsx
    - frontend/src/components/guests/import-wizard/step-map-columns.tsx
    - frontend/src/components/guests/import-wizard/step-validate.tsx
    - frontend/src/components/guests/import-wizard/step-duplicates.tsx
    - frontend/src/components/guests/import-wizard/step-confirm.tsx
    - frontend/src/components/guests/guest-table.tsx
    - frontend/src/components/guests/guest-filters.tsx
    - frontend/src/components/guests/add-guest-dialog.tsx
    - frontend/src/routes/events/$eventId/guests/index.tsx
    - frontend/src/routes/events/$eventId/guests/import.tsx
    - frontend/src/lib/parse-file.ts
    - frontend/src/lib/phone.ts
  modified:
    - frontend/src/routes/events/$eventId.tsx
    - frontend/src/routeTree.gen.ts

key-decisions:
  - "Zustand store manages all 5 wizard steps with shared state and reset on mount/unmount"
  - "Search debounced at 300ms, routes to name or phone search index based on input pattern detection"
  - "Category filter is post-pagination (no compound index); status filter uses by_event_status index"
  - "Import wizard auto-advances past Step 4 (duplicates) when no duplicates found"
  - "Intra-file duplicates resolved by keeping first occurrence of each phone number"
  - "Duplicate resolution uses button group per row with bulk Skip All / Replace All shortcuts"

patterns-established:
  - "Wizard state: Zustand store with step-specific data sections and reset method"
  - "Search routing: looksLikePhone() detects phone-like input to route to correct search index"
  - "Debounced search: useState + useEffect with 300ms timeout"
  - "Paginated table: usePaginatedQuery with Load More pattern"
  - "File upload: drag-drop zone with hidden input, parseFile async handler"

requirements-completed: [GUST-01, GUST-02, GUST-03, GUST-04, GUST-05]

duration: 12min
completed: 2026-04-12
---

# Phase 2 Plan 02: Guest Management Frontend Summary

**Complete frontend for guest management -- paginated list with search/filters, Add Guest dialog with BD phone validation, 5-step import wizard with client-side CSV/Excel parsing, column mapping, validation, duplicate resolution, and chunked batch import**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-12
- **Completed:** 2026-04-12
- **Tasks:** 6 (across 4 atomic commits)
- **Files created:** 14
- **Files modified:** 2

## Accomplishments
- Guest list page at /events/$eventId/guests with paginated table, search (name + phone), category dropdown, status tabs
- Add Guest dialog with Bangladesh phone validation (01XXXXXXXXX format), duplicate detection, category selection
- 5-step import wizard at /events/$eventId/guests/import with Zustand state management
- Step 1: Drag-drop file upload accepting .csv and .xlsx, parsed client-side with SheetJS
- Step 2: Column mapping with auto-detection and preview of first 5 rows
- Step 3: Validation summary with error counts, downloadable error CSV, intra-file duplicate detection
- Step 4: Duplicate resolution with Skip/Replace/Keep Both per row, bulk Skip All / Replace All buttons
- Step 5: Confirm with summary, chunked batch import (500 rows), progress bar, success/error state
- Guests tab added to event detail page showing guest count and Manage Guests navigation

## Task Commits

1. **Tasks 1-4: Dependencies, utilities, wizard store and components** - `4e1b8aa` (feat)
2. **Task 5: Guest list components** - `282285c` (feat)
3. **Task 6: Routes and event detail integration** - `d548e5f` (feat)
4. **Utilities and route tree** - `331afa6` (feat)

## Files Created/Modified
- `frontend/src/components/guests/import-wizard/use-import-store.ts` - Zustand store for wizard state
- `frontend/src/components/guests/import-wizard/wizard-shell.tsx` - 5-step indicator, navigation, content router
- `frontend/src/components/guests/import-wizard/step-upload.tsx` - Drag-drop file upload with SheetJS parsing
- `frontend/src/components/guests/import-wizard/step-map-columns.tsx` - Column mapping with auto-detect and preview
- `frontend/src/components/guests/import-wizard/step-validate.tsx` - Validation results, error breakdown, CSV export
- `frontend/src/components/guests/import-wizard/step-duplicates.tsx` - DB duplicate check, per-row and bulk resolution
- `frontend/src/components/guests/import-wizard/step-confirm.tsx` - Summary, chunked import, progress bar
- `frontend/src/components/guests/guest-table.tsx` - Paginated table with search, empty/no-results states
- `frontend/src/components/guests/guest-filters.tsx` - Debounced search, category select, status tabs
- `frontend/src/components/guests/add-guest-dialog.tsx` - Dialog with name, phone (BD format), category fields
- `frontend/src/routes/events/$eventId/guests/index.tsx` - Guest list page route
- `frontend/src/routes/events/$eventId/guests/import.tsx` - Import wizard page route
- `frontend/src/lib/parse-file.ts` - SheetJS file parsing, auto column detection, error CSV export
- `frontend/src/lib/phone.ts` - Client-side BD phone validation (mirrors server-side)
- `frontend/src/routes/events/$eventId.tsx` - Modified: added Guests tab with count
- `frontend/src/routeTree.gen.ts` - Auto-regenerated with new guest routes

## Decisions Made
- Zustand store manages all wizard state with step-by-step sections and full reset capability
- Search debounced at 300ms to avoid excessive queries
- Phone-like input detection routes to phone search index vs name search index
- Intra-file duplicates resolved by keeping first occurrence (user warned)
- Import wizard auto-advances past Step 4 when no DB duplicates found
- 500-row chunk size for batch import matching server-side Convex limits

## Deviations from Plan
None -- plan executed as written.

## Issues Encountered
None

## User Setup Required
None -- all components use existing Convex APIs from Plan 01.

## Next Phase Readiness
- All guest management UI complete for admin workflows
- Import wizard ready for bulk guest population (up to 60K guests)
- Guest data ready for QR code generation in Phase 3
- Phone normalization consistent between client and server

---
*Phase: 02-guest-management*
*Completed: 2026-04-12*
