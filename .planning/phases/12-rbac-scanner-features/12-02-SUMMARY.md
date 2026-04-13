---
phase: 12-rbac-scanner-features
plan: 02
subsystem: sms-r2-export
tags: [sms, r2, export, cdn, rbac]
dependency_graph:
  requires: [12-01]
  provides: [sms-template-ux, r2-key-docs, export-sms-sheet]
  affects: [sms-dashboard, r2-client, export-event-button]
tech_stack:
  added: []
  patterns: [placeholder-chips, localStorage-template-persistence]
key_files:
  created: []
  modified:
    - frontend/src/components/cards/sms-dashboard.tsx
    - backend/internal/r2/client.go
    - frontend/src/components/events/export-event-button.tsx
decisions:
  - "SMS template persistence uses localStorage (per-event key), not database"
  - "R2 key structure kept as-is (more organized than requirements specified)"
  - "Duplicate card.BuildCardKey in card/compositor.go noted but not refactored (same output)"
metrics:
  duration: "6m"
  completed: "2026-04-13"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 3
---

# Phase 12 Plan 02: SMS Template, R2 Key Audit, and Export Verification Summary

SMS template editor enhanced with empty-state visibility and placeholder chips, R2 key paths audited and documented, Excel export extended with SMS Deliveries sheet.

## What Was Done

### Task 1: SMS template end-to-end flow verification and improvements

**Verified existing functionality (no changes needed):**
- `applySmsTemplate` correctly maps all documented placeholders: {cardUrl}, {link}, {name}, {guestName}, {phone}, {number}
- Template persists per-event in localStorage via `eventarc_sms_template:${eventId}`
- On mount: loads from localStorage. On change: saves to localStorage.
- `handleSend` passes `messageTemplate` to `triggerSmsSend` action
- `triggerSmsSend` in `adminGateway.ts` forwards `messageTemplate` to Go API

**Improvements:**
- **Empty state SMS template editor**: Moved template editor (textarea + preview) ABOVE the send button in the empty state. Users can now customize the template before their first send.
- **Placeholder insertion chips**: Added clickable placeholder buttons below the textarea (both empty state and main state). Clicking appends the placeholder text to the current template.

### Task 2: R2 storage key path audit

**Audit results -- all key builders verified:**
- `BuildKey(eventID, guestID, qrType)` -> `events/{eventID}/guests/{guestID}/qr/{entry|food|unified}.png` (exceeds CDNS-01 requirement)
- `BuildCardKey(eventID, guestID)` -> `events/{eventID}/guests/{guestID}/cards/card.png` (exceeds CDNS-02 requirement)
- `BuildTemplateBackgroundKey(eventID, templateID)` -> `events/{eventID}/templates/{templateID}/background.png` (matches CDNS-03)
- `BuildEventPrefix(eventID)` -> `events/{eventID}/` (bulk operations prefix)
- `BuildLegacyKey` exists for backwards compatibility

**Key builder usage verified:**
- `worker/qr_handler.go` line 127: uses `r2.BuildKey()` -- correct
- `handler/cards_worker.go` line 176: uses `card.BuildCardKey()` -- duplicate function with identical output in `card/compositor.go`, not a bug
- `handler/cards_worker.go` line 224: uses `r2.BuildTemplateBackgroundKey()` -- correct
- No raw `fmt.Sprintf` key construction found outside builder functions

**Documentation added:**
- CORS configuration requirements documented at top of `r2/client.go`
- Full R2 key structure documented in code comments

### Task 3: Excel export with SMS delivery data

**Verified existing RBAC access control:**
- `ExportEventButton` rendered on event detail page which enforces `ensureEventReadAccess`
- All underlying queries (`guests.listByEvent`, `categories.listByEvent`, etc.) enforce event-level permissions
- Event managers can only export data for events they have access to

**Export extension:**
- Added `smsDeliveries` query via `api.smsDeliveries.listByEvent`
- Added "SMS Deliveries" sheet to Excel export with columns: guestName, phone, status, lastAttemptAt, deliveredAt, failureReason
- Updated `isReady` check to include `smsDeliveries`
- Export now has 7 sheets: Guest Categories, Entry Vendors, Food Vendors, Guests, Food Rules, Device Sessions, SMS Deliveries

## Deviations from Plan

### Auto-noted Issues

**1. [Observation] Duplicate BuildCardKey function**
- **Found during:** Task 2
- **Issue:** `card.BuildCardKey` in `card/compositor.go` duplicates `r2.BuildCardKey` in `r2/client.go` with identical output
- **Action:** Noted but not refactored -- both produce `events/{eventID}/guests/{guestID}/cards/card.png`. Not a bug, just redundancy.
- **Impact:** None (no behavioral difference)

**2. [Observation] Food scan data not in export**
- **Found during:** Task 3
- **Issue:** `foodScans` table exists in Convex schema but there is no paginated query to list all food scans for an event suitable for export
- **Action:** Documented as gap per plan instructions. Food scan data lives primarily in Go/PostgreSQL. Adding a Convex query for export is out of scope for this plan.

## Decisions Made

1. **SMS template persistence**: localStorage (client-side only) is the chosen approach per SMST-03. Does not persist across browsers/devices -- acceptable for admin use case.
2. **R2 key structure**: Current implementation exceeds requirements (more organized nesting under `guests/`). Kept as-is.
3. **SMS Deliveries export fields**: Includes `deliveredAt` and `failureReason` from schema even though `listByEvent` returns all fields from the delivery record.

## Verification

- TypeScript compilation: PASSED (exit code 0)
- Vite build: PASSED (exit code 0)
- Go vet (r2 package): PASSED (exit code 0)
- Go build (full backend): PASSED (exit code 0)

## Commit

- `71df1cb`: feat(12-02): SMS template UX, R2 key audit, and export with SMS deliveries
