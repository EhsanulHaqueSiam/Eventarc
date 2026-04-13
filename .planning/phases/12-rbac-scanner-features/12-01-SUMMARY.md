---
phase: 12-rbac-scanner-features
plan: 01
subsystem: frontend-rbac-scanner
tags: [rbac, scanner, permissions, frontend]
dependency_graph:
  requires: []
  provides: [canEdit-prop-wiring, event-scoped-scanner, rbac-frontend]
  affects: [categories-tab, vendors-tab, event-config-form, scanner-app, events-list]
tech_stack:
  added: []
  patterns: [canEdit-prop-pattern, event-name-in-session]
key_files:
  created: []
  modified:
    - frontend/src/components/events/categories-tab.tsx
    - frontend/src/components/events/vendors-tab.tsx
    - frontend/src/components/events/event-config-form.tsx
    - frontend/src/routes/events/$eventId.tsx
    - frontend/src/routes/events/index.tsx
    - frontend/src/routes/scanner/index.tsx
    - frontend/src/components/scanner/scanner-app.tsx
    - frontend/src/components/scanner/scanner-setup.tsx
    - frontend/src/hooks/use-device-session.ts
decisions:
  - "canEdit prop pattern: pass from EventDetailPage to CategoriesTab, VendorsTab, EventConfigForm"
  - "EventConfigForm isLocked includes !canEdit for view-only managers"
  - "Scanner session stores eventName for display in top bar"
metrics:
  duration: "6m"
  completed: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 9
---

# Phase 12 Plan 01: RBAC Frontend Enforcement and Event-Scoped Scanner URLs Summary

RBAC canEdit prop wired through all tab components with event manager empty state and event-scoped scanner URLs showing event name context.

## What Was Done

### Task 1: RBAC enforcement in frontend conditional rendering

**Verified existing backend RBAC (no changes needed):**
- `convex/events.ts:list` correctly filters events by `eventPermissions` for non-admin users using `allowedEventIds` Set
- `convex/events.ts:create` and `remove` both call `ensureAdminAccess(ctx)` -- event managers cannot create or delete events
- `convex/eventPermissions.ts:grantByEmail` calls `ensureAdminAccess(ctx)` -- only admins can assign managers
- `EventAccessTab` shows read-only view for non-admin users with their access level
- Event detail page correctly computes `isAdmin`, `permission`, `canEditEvent` from `myAccess`

**Frontend changes:**
- `CategoriesTab`: Added `canEdit?: boolean` prop. When false, hides edit/delete buttons on rows and "Add Category" button.
- `VendorsTab`: Added `canEdit?: boolean` prop. When false, hides category delete, "Add Category", stall delete, "Add Stall" buttons.
- `EventConfigForm`: Added `canEdit?: boolean` prop. When false, `isLocked` is true -- all toggle groups are disabled, save bar hidden.
- `EventDetailPage ($eventId.tsx)`: Passes `canEdit={canEditEvent}` to CategoriesTab, VendorsTab, EventConfigForm.
- Events list (`index.tsx`): Updated empty state -- event managers see "No events assigned" message instead of "Create your first event".

### Task 2: Scanner URL restructure with event-specific routing

**Verified existing routing (no changes needed to route structure):**
- `/scanner` already shows "Use event-specific link" static page
- `/$eventId/scanner` already passes `fixedEventId` to `ScannerApp`
- `ScannerSetup` correctly uses `fixedEventId` to show event in read-only field and skip dropdown
- `/scanner/$eventId` already redirects to `/$eventId/scanner` via `<Navigate>`

**Enhancements:**
- `/scanner` page: Added admin guidance text ("Admins can find the scanner link on each event's detail page") and "Go to Events" link button.
- `SessionInfo` interface: Added optional `eventName` field.
- `ScannerSetup`: Captures event name from `fixedEvent` or `liveEvents` and passes it in `createSession` call.
- `use-device-session.ts`: Stores and restores `eventName` from localStorage session.
- `ActiveScanner` top bar: Displays event name above stall name when available.

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **canEdit prop defaults to true**: All tab components default `canEdit` to `true` so existing call sites without the prop continue working unchanged.
2. **EventConfigForm combines canEdit with status lock**: `isLocked = !canEdit || status === "live" || ...` ensures both permission and lifecycle checks apply.
3. **eventName stored in localStorage session**: Persists across page reloads without additional API calls.

## Verification

- TypeScript compilation: PASSED (exit code 0)
- Vite build: PASSED (exit code 0)
- Convex backend unchanged -- all RBAC guards verified in place

## Commit

- `432ac2a`: feat(12-01): RBAC frontend enforcement and event-scoped scanner URLs
