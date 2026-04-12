---
phase: 06-vendor-scanning-interface
plan: 02
subsystem: ui
tags: [react, html5-qrcode, zustand, web-audio-api, convex, camera, qr-scanner, tailwindcss]

requires:
  - phase: 06-vendor-scanning-interface
    provides: useDeviceSession hook, /scanner route, session endpoints, convex deviceSessions
  - phase: 04-scan-processing-core
    provides: POST /api/v1/scan/entry endpoint (scan response format)
  - phase: 05-food-scan-rules-engine
    provides: POST /api/v1/scan/food endpoint (food scan response format)
provides:
  - Camera-based QR scanning via html5-qrcode with pause/resume lifecycle
  - Zustand scan state machine (idle -> reviewing -> confirming -> flash -> ready -> idle)
  - Web Audio API audio feedback (rising tone success, descending failure, flat duplicate)
  - Full-screen flash overlay with 5 outcome colors per UI-SPEC
  - Two-step confirm/dismiss flow with result card and "Scan Next" pacing
  - Session revoked screen with "Select New Station" action
  - Admin active sessions tab with real-time Convex monitoring and revocation
affects: [07-offline-resilience, 09-real-time-dashboard]

tech-stack:
  added: [html5-qrcode]
  patterns: [zustand-state-machine, web-audio-oscillator, full-screen-flash-overlay, dual-layout-responsive]

key-files:
  created:
    - frontend/src/components/scanner/camera-viewfinder.tsx
    - frontend/src/components/scanner/scan-flash-overlay.tsx
    - frontend/src/components/scanner/scan-result-card.tsx
    - frontend/src/components/scanner/scan-next-card.tsx
    - frontend/src/components/scanner/session-revoked.tsx
    - frontend/src/components/scanner/session-status.tsx
    - frontend/src/hooks/use-scanner.ts
    - frontend/src/hooks/use-scanner.test.ts
    - frontend/src/hooks/use-audio-feedback.ts
    - frontend/src/hooks/use-audio-feedback.test.ts
    - frontend/src/lib/scanner-audio.ts
    - frontend/src/components/sessions/active-sessions-tab.tsx
    - frontend/src/components/sessions/active-sessions-tab.test.tsx
  modified:
    - frontend/package.json
    - frontend/src/routes/scanner/index.tsx
    - frontend/src/routes/events/$eventId.tsx
    - frontend/src/routeTree.gen.ts

key-decisions:
  - "Two-step flow: QR detected -> reviewing (Confirm/Dismiss) -> confirming (server POST) -> flash (outcome) -> ready (Scan Next). Flash comes AFTER server response, not before."
  - "Scan state machine uses Zustand store (not React state) for cross-component state sharing without prop drilling"
  - "Audio cues via Web Audio API OscillatorNode for zero-latency playback -- no audio file loading"
  - "Admin sessions tab uses dual layout: desktop Table + mobile Card, both rendered in DOM, toggled via CSS (hidden md:block)"
  - "Session status thresholds: Connected <30s, Idle 30s-2min, Disconnected >2min based on lastHeartbeat timestamp"

patterns-established:
  - "Zustand state machine: define all transitions as named actions, ignore invalid transitions (e.g., onQrDetected when not idle)"
  - "Flash overlay: fixed inset-0 z-50 with oklch color values and auto-dismiss timer"
  - "Dual responsive layout: render both table and card views, use CSS hidden/block classes for breakpoint switching"

requirements-completed: [VSCN-01, VSCN-03, VSCN-04, VSCN-05]

duration: 25min
completed: 2026-04-12
---

# Plan 06-02: Camera Scanning Interface Summary

**Browser QR scanning with two-step confirm/dismiss flow, color flash overlays, Web Audio cues, and admin session monitoring**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-12T09:44:00Z
- **Completed:** 2026-04-12T09:49:00Z
- **Tasks:** 3
- **Files modified:** 17

## Accomplishments
- Camera-based QR scanning via html5-qrcode with automatic pause on detection and resume on "Scan Next"
- Zustand scan state machine with 8 states and 5 named transition actions, preventing double-scans
- Full-screen flash overlays (green allowed/served, red denied, amber duplicate) with 1-second auto-dismiss
- Two-step confirm/dismiss flow: result card shows QR data -> vendor confirms -> server processes -> flash shows outcome -> "Scan Next"
- Web Audio API audio cues: rising two-tone success, descending failure, single-tone duplicate
- Admin active sessions tab with real-time Convex subscription, Connected/Idle/Disconnected status indicators, and AlertDialog revocation confirmation
- All 46 frontend tests pass across 6 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Scan state machine, audio hooks, html5-qrcode** - `92c7404` (feat)
2. **Task 2: Camera viewfinder, flash overlay, result cards, scanner route** - `a0fc96e` (feat)
3. **Task 3: Admin active sessions tab** - `a5d3147` (feat)

## Files Created/Modified
- `frontend/src/hooks/use-scanner.ts` - Zustand store with 8 scan states and server response parsing
- `frontend/src/hooks/use-scanner.test.ts` - 12 test cases covering all transitions and response types
- `frontend/src/hooks/use-audio-feedback.ts` - Web Audio API hook with 3 cue types
- `frontend/src/hooks/use-audio-feedback.test.ts` - 4 test cases for oscillator frequencies and context resume
- `frontend/src/lib/scanner-audio.ts` - Audio cue configuration constants
- `frontend/src/components/scanner/camera-viewfinder.tsx` - html5-qrcode wrapper with pause/resume
- `frontend/src/components/scanner/scan-flash-overlay.tsx` - 5-color full-screen flash with auto-dismiss
- `frontend/src/components/scanner/scan-result-card.tsx` - Pre-confirm and post-confirm result display
- `frontend/src/components/scanner/scan-next-card.tsx` - Minimal card with autoFocus "Scan Next" button
- `frontend/src/components/scanner/session-revoked.tsx` - ShieldX icon revoked screen
- `frontend/src/components/scanner/session-status.tsx` - Connected/Disconnected badge
- `frontend/src/routes/scanner/index.tsx` - Full scanner integration with state machine and overlays
- `frontend/src/components/sessions/active-sessions-tab.tsx` - Admin table with real-time monitoring
- `frontend/src/components/sessions/active-sessions-tab.test.tsx` - 8 test cases for status/revoke/empty state
- `frontend/src/routes/events/$eventId.tsx` - "Sessions" tab added (live events only)

## Decisions Made
- Flash overlay comes AFTER server confirms (not before) -- vendor sees QR data first in result card, taps Confirm, then flash shows server outcome. This aligns with D-02 (two-step: scan -> review -> process).
- Used Zustand store instead of React state for scan state machine -- enables cross-component state sharing between CameraViewfinder, ScanFlashOverlay, ScanResultCard without prop drilling.
- Admin sessions table uses dual-render (desktop Table + mobile Card) with CSS-based visibility toggling rather than conditional rendering based on window width.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated TanStack Router route tree**
- **Found during:** Task 2 (scanner route TypeScript errors)
- **Issue:** /scanner route not in routeTree.gen.ts, causing type errors
- **Fix:** Ran `npx @tanstack/router-cli generate` to regenerate
- **Files modified:** frontend/src/routeTree.gen.ts
- **Verification:** Route type resolves correctly

**2. [Rule 2 - Missing Critical] Removed asChild from DialogTrigger**
- **Found during:** Task 2 (TypeScript compilation)
- **Issue:** DialogTrigger asChild prop causes TS error with base-ui (pre-existing pattern across project)
- **Fix:** Used className directly on DialogTrigger instead of asChild wrapper
- **Files modified:** frontend/src/routes/scanner/index.tsx
- **Verification:** No new TS errors from Phase 6 code

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Essential for compilation. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in other files (asChild prop on base-ui, convex/_generated module resolution) are not introduced by Phase 6 and match the known todo in STATE.md.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Scanner interface complete with full QR scanning lifecycle
- Phase 7 (Offline Resilience) can add IndexedDB queue and sync logic to the existing scan state machine
- Phase 9 (Real-Time Dashboard) can consume scan events from the session monitoring infrastructure

---
*Phase: 06-vendor-scanning-interface*
*Completed: 2026-04-12*
