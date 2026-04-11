# Phase 6: Vendor Scanning Interface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 06-vendor-scanning-interface
**Areas discussed:** Scan UI & feedback, Device session & stall selection, QR camera integration, Admin session management

---

## Scan UI & Feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Full-screen flash + result card | Green/red flash, result card with info | ✓ |
| Bottom sheet overlay | Camera stays active, overlay at bottom | |
| You decide | Claude picks | |

**User's choice:** Full-screen flash + result card

---

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-continue after result display | Camera auto-resumes after 3-4 seconds | |
| Tap to scan next | Operator taps button to reactivate camera | ✓ |
| You decide | Claude picks | |

**User's choice:** Tap to scan next
**Notes:** User added critical requirement: vendor must click "Confirm" to process scan (deduct/mark entry) or "Dismiss" to cancel. Prevents accidental scans. Two-step flow: scan → popup with confirm/dismiss → result.

---

## Device Session & Stall Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side session with device token | Token in localStorage, session on server | ✓ |
| LocalStorage only (client-side) | No server session, can't revoke | |
| You decide | Claude picks | |

**User's choice:** Server-side session with device token

---

| Option | Description | Selected |
|--------|-------------|----------|
| Active until event ends | No timeout | ✓ |
| 24-hour expiry with re-select | Re-select next day | |
| You decide | Claude picks | |

**User's choice:** Active until event ends

---

## QR Camera Integration

| Option | Description | Selected |
|--------|-------------|----------|
| html5-qrcode | Popular, maintained, cross-device | ✓ |
| jsQR + manual getUserMedia | Lower-level, more control | |
| You decide | Claude picks | |

**User's choice:** html5-qrcode
**Notes:** User added critical requirement: food stall vendors don't select food type — the system auto-deducts from the stall's food category. Fuchka stall scans deduct from fuchka quota only.

---

## Admin Session Management

| Option | Description | Selected |
|--------|-------------|----------|
| Stall + device info + last scan time | Device type, last scan timestamp, total scans | |
| Stall + scan rate + status | Scans per minute, online/offline status | ✓ |
| You decide | Claude picks | |

**User's choice:** Stall + scan rate + status

---

## Claude's Discretion

- Result card auto-dismiss timing
- Audio cue design (beep types)
- Camera viewfinder layout
- Stall selection UI details
- Session token format
- WebSocket vs polling for session status
- Admin session list pagination/filtering

## Deferred Ideas

None — discussion stayed within phase scope
