---
phase: 06-vendor-scanning-interface
status: human_needed
verified: 2026-04-12
must_haves_verified: 5
must_haves_total: 5
---

# Phase 6: Vendor Scanning Interface — Verification

## Phase Goal
Event vendors can scan QR codes using only a web browser on their phone or tablet with zero credentials and instant feedback.

## Success Criteria Verification

### SC-1: Vendor opens a URL, selects their stall from a hierarchical dropdown, and starts scanning -- no login required
**Status:** PASS (automated)
- `/scanner` route exists at `frontend/src/routes/scanner/index.tsx`
- `__root.tsx` excludes scanner from auth checks and admin shell
- `ScannerSetup` component renders 4 cascading dropdowns (event -> vendor type -> category -> stall)
- "Start Scanning" button calls `createSession()` which POSTs to `/api/v1/session` (unauthenticated)
- 6 component tests verify heading, dropdowns, and button state

### SC-2: Device session persists across page refreshes so the operator never needs to re-select their stall
**Status:** PASS (automated)
- `useDeviceSession` hook stores token in localStorage at key `eventarc_scanner_session`
- On mount, hook reads token from localStorage and validates with `GET /api/v1/session`
- If valid, resumes scanning screen; if invalid/revoked, clears token and shows setup
- 5 hook tests verify persist/clear/validate lifecycle

### SC-3: Camera-based QR scanning works via the browser's getUserMedia API on mobile and tablet devices
**Status:** PASS (automated + human needed)
- `CameraViewfinder` component wraps html5-qrcode with `facingMode: "environment"` (back camera)
- Camera starts on mount, pauses on QR detection, resumes on "Scan Next"
- useEffect cleanup calls `scanner.stop()` to release camera
- **Human verification needed:** Test on actual mobile device (iPhone Safari, Android Chrome) to confirm camera permission flow and QR decoding

### SC-4: Each scan shows instant visual feedback and distinct audio cues
**Status:** PASS (automated)
- `ScanFlashOverlay` renders 5 outcome-specific full-screen flashes (green allowed/served, red denied, amber duplicate)
- `ScanResultCard` shows guest info with Confirm/Dismiss buttons (56px height per UI-SPEC)
- `ScanNextCard` with autoFocus "Scan Next" button
- `useAudioFeedback` hook plays Web Audio API tones: rising (success), descending (failure), flat (duplicate)
- 4 audio tests verify oscillator frequencies; 12 scanner state machine tests verify transitions

### SC-5: Admin can view all active scanning sessions and revoke any device session
**Status:** PASS (automated)
- `ActiveSessionsTab` queries `api.deviceSessions.listByEvent` via Convex real-time subscription
- Table shows stall name, scans/min, status (Connected/Idle/Disconnected based on heartbeat thresholds)
- Revoke button with `AlertDialog` confirmation calls `api.deviceSessions.revoke`
- "Sessions" tab added to event detail page (visible only when status === "live")
- 8 component tests verify table headers, status indicators, revoke dialog, empty state, revoked filter

## Requirements Traceability

| Requirement | Status | Evidence |
|-------------|--------|----------|
| VSCN-01 | PASS | /scanner route, cascading dropdowns, no auth, createSession endpoint |
| VSCN-02 | PASS | localStorage token persistence, validate-on-mount, resume scanning screen |
| VSCN-03 | PASS | html5-qrcode CameraViewfinder, getUserMedia with facingMode:environment |
| VSCN-04 | PASS | ScanFlashOverlay (5 colors), ScanResultCard, useAudioFeedback (3 cue types) |
| VSCN-05 | PASS | ActiveSessionsTab with Convex real-time, AlertDialog revoke, Sessions tab on event detail |

## Automated Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| Go session handlers | 10 | PASS |
| Go scan service (prior phase) | 19 | PASS |
| Frontend hooks (device-session, scanner, audio) | 21 | PASS |
| Frontend components (scanner-setup, active-sessions) | 14 | PASS |
| Frontend SSE hook (prior phase) | 11 | PASS |
| **Total** | **75** | **PASS** |

## Human Verification Items

1. **Camera QR scanning on mobile:** Open /scanner on iPhone Safari and Android Chrome, select a stall, verify camera permission prompt appears, verify back camera activates, verify QR code is decoded
2. **Flash overlay visibility:** Verify full-screen flash is visible at arm's length on a phone screen
3. **Audio cue playback:** Verify audio tones play through phone speaker on scan
4. **Session persistence:** Close and reopen browser tab, verify scanning resumes without re-selecting stall
5. **Admin revocation:** Revoke a session from admin dashboard, verify vendor device shows "Session Revoked" screen

## Summary

All 5 success criteria verified via automated checks. 5 human verification items remain for end-to-end testing on physical mobile devices (camera access, audio playback, and cross-device session revocation cannot be automated in this environment).
