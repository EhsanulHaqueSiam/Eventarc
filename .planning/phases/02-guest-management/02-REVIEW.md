---
status: clean
phase: 02-guest-management
depth: standard
files_reviewed: 19
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
reviewed_at: 2026-04-12
---

# Phase 02 Code Review: Guest Management

## Summary

19 source files reviewed at standard depth. No critical or warning-level issues found. The code follows established patterns from Phase 1, maintains proper authentication on all mutations, normalizes phone numbers consistently, and implements defense-in-depth validation on the server side. 3 informational notes documented below.

## Findings

### INFO-01: countByEvent uses collect() for large datasets

**File:** `convex/guests.ts` (line 252-257)
**Severity:** info

`countByEvent` calls `.collect()` which loads all guest documents into memory to count them. For events with up to 60K guests, this returns 60K documents just to get a length. This is a known trade-off documented in the plan -- the Convex Aggregate component can optimize this later. No action needed for MVP.

### INFO-02: checkDuplicatePhones iterates phones sequentially

**File:** `convex/guests.ts` (line 281-298)
**Severity:** info

`checkDuplicatePhones` queries the database sequentially for each phone number. For large imports (60K guests), the pre-check query could receive thousands of phones. Since Convex queries have a time limit, very large phone arrays might time out. The client should batch the phone arrays (e.g., 500 at a time) similar to how importBatch is chunked. Not a bug for typical usage but worth noting for scale testing.

### INFO-03: Category filter is post-pagination

**File:** `convex/guests.ts` (line 167-174, 186-192)
**Severity:** info

Category filtering in `listByEvent` is applied after pagination (post-filter on the page), which means some pages may return fewer than the requested number of items when a category filter is active. This is a documented design decision (no compound index for eventId+categoryId+_creationTime) and acceptable for MVP. Users may notice "short" pages when filtering by category.

## Files Reviewed

### Backend (Convex)
- `convex/schema.ts` -- Clean. Guests table with proper indexes and search indexes.
- `convex/guests.ts` -- Clean. All mutations check auth. Phone normalization on all write paths. Defense-in-depth validation in importBatch.
- `convex/model/guests.ts` -- Clean. Validation and duplicate check logic well-factored.
- `convex/model/phone.ts` -- Clean. Regex correctly matches BD operators 013-019.

### Frontend (React)
- `frontend/src/lib/phone.ts` -- Clean. Mirrors server-side exactly.
- `frontend/src/lib/parse-file.ts` -- Clean. Proper error handling, CSV quoting in downloadErrorCsv.
- `frontend/src/components/guests/import-wizard/use-import-store.ts` -- Clean. Zustand store with proper reset.
- `frontend/src/components/guests/import-wizard/wizard-shell.tsx` -- Clean. Step indicator and navigation.
- `frontend/src/components/guests/import-wizard/step-upload.tsx` -- Clean. Drag-drop with file type validation.
- `frontend/src/components/guests/import-wizard/step-map-columns.tsx` -- Clean. Auto-detect with preview.
- `frontend/src/components/guests/import-wizard/step-validate.tsx` -- Clean. Intra-file dedup and error grouping.
- `frontend/src/components/guests/import-wizard/step-duplicates.tsx` -- Clean. Bulk and per-row resolution.
- `frontend/src/components/guests/import-wizard/step-confirm.tsx` -- Clean. Chunked import with progress.
- `frontend/src/components/guests/guest-table.tsx` -- Clean. Paginated with search/browse modes.
- `frontend/src/components/guests/guest-filters.tsx` -- Clean. Debounced search with phone detection.
- `frontend/src/components/guests/add-guest-dialog.tsx` -- Clean. Validation with server error display.
- `frontend/src/routes/events/$eventId/guests/index.tsx` -- Clean. Guest list page with breadcrumbs.
- `frontend/src/routes/events/$eventId/guests/import.tsx` -- Clean. Wizard page with store reset.
- `frontend/src/routes/events/$eventId.tsx` -- Clean. Guests tab integrated.

## Security Check

- All mutations require `ctx.auth.getUserIdentity()` -- PASS
- Phone numbers normalized before storage (no raw input stored) -- PASS
- Category cross-event validation on create/update/import -- PASS
- No raw HTML rendering (React JSX auto-escapes) -- PASS
- File parsing uses SheetJS (no eval/innerHTML) -- PASS
- Error CSV uses proper quoting to prevent CSV injection -- PASS

## Conclusion

Phase 2 code is clean and production-ready for the MVP scope. The 3 informational items are documented trade-offs, not bugs. No fixes required.
