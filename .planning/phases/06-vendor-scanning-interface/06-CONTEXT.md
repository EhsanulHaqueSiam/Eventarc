# Phase 6: Vendor Scanning Interface - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Browser-based QR scanning interface for vendor operators. No credentials — open URL, select stall, scan with camera. Full-screen color flash + result card feedback with audio cues. Explicit confirm/dismiss before processing. Device sessions persist via server-side tokens until event ends. Admin can view active sessions (scan rate, status) and revoke sessions. Cross-device: iPhone, iPad, Android. No offline handling (Phase 7).

Requirements: VSCN-01, VSCN-02, VSCN-03, VSCN-04, VSCN-05

</domain>

<decisions>
## Implementation Decisions

### Scan UI & Feedback
- **D-01:** Full-screen flash (green success / red failure) for ~1 second, followed by a result card showing guest info or error reason. Distinct audio cues for success and failure.
- **D-02:** Two-step scan flow: 1) Vendor scans QR → popup shows guest info, allowance, and scan details. 2) Vendor explicitly clicks "Confirm" to process the scan (deduct food / mark entry) or "Dismiss" to cancel. This prevents accidental scans.
- **D-03:** After processing (confirm or dismiss), vendor taps "Scan Next" button to reactivate camera. No auto-continue — prevents rapid accidental double-scans.

### Device Session & Stall Selection
- **D-04:** Server-side session with device token. On first stall selection, server generates a session token stored in localStorage. Token maps to stall assignment on the server. Survives page refreshes. Admin can revoke by invalidating the token server-side.
- **D-05:** Sessions remain active until the event ends — no timeout or expiry. Operators need all-day scanning for the duration of the event.
- **D-06:** Stall selection flow: hierarchical dropdown — event → vendor type (entry/food) → category (fuchka/biryani/main_gate) → stall (fuchka-1, fuchka-2). One screen, cascading dropdowns.

### QR Camera Integration
- **D-07:** Use html5-qrcode library for browser-based camera QR scanning. Supports camera selection (front/back), torch control, iOS Safari + Android Chrome compatibility.

### Food Stall Scan Behavior
- **D-08:** When a food stall vendor scans a food QR, the system automatically deducts from the food category that the stall belongs to. The stall's parent vendorCategory determines the food type — vendor doesn't select what to deduct. E.g., fuchka-stall-1 belongs to "fuchka" category → scan deducts from fuchka quota only.

### Admin Session Management
- **D-09:** Admin session view shows per session: stall name, scans per minute rate, and online/offline status. Operational view for monitoring which stalls are active and how busy.
- **D-10:** Admin can revoke any device session from the admin interface. Revoked session immediately shows "Session revoked" on the vendor device.

### Claude's Discretion
Claude has flexibility on: result card auto-dismiss timing, audio cue design (beep types), camera viewfinder layout, stall selection UI details, session token format, WebSocket vs polling for session status, admin session list pagination/filtering.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Architecture
- `.planning/PROJECT.md` — Core value, cross-device compatibility requirement
- `.planning/REQUIREMENTS.md` — VSCN-01 through VSCN-05
- `.planning/ROADMAP.md` — Phase 6 success criteria, dependency graph

### Upstream Dependencies
- `.planning/phases/01-foundation-domain-model/01-CONTEXT.md` — Vendor hierarchy (VNDR-01/02/03), passwordless sessions (D-20), WebSocket (coder/websocket), CORS (D-28)
- `.planning/phases/04-scan-processing-core/04-CONTEXT.md` — Scan response format (D-07/D-08: guest info, duplicate details)
- `.planning/phases/05-food-scan-rules-engine/05-CONTEXT.md` — Food scan response (D-07/D-08: remaining allowance, consumption history)
- `convex/stalls.ts` — Stall CRUD, stall → vendorCategory → vendorType hierarchy
- `backend/internal/handler/` — Scan endpoint handlers (entry + food)

### External Documentation (researcher should fetch latest)
- html5-qrcode library documentation — camera integration, iOS Safari quirks
- coder/websocket Go library — WebSocket for vendor session sync
- getUserMedia API — browser camera access, permissions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/stalls.ts` — Stall queries (list by event, by category)
- `convex/vendors.ts` — Vendor type/category queries for hierarchical dropdown
- `frontend/src/components/` — shadcn/ui components for the admin session management view
- `backend/internal/middleware/cors.go` — CORS config for cross-origin vendor scanner requests

### Established Patterns
- TanStack Router file-based routing (add /scanner route)
- shadcn/ui components for UI elements
- Convex real-time subscriptions for admin views

### Integration Points
- New `/scanner` route in frontend (separate from admin dashboard)
- WebSocket connection from vendor device to Go microservice for real-time session status
- Admin dashboard gets new "Active Sessions" tab under event detail
- Scanner calls POST /api/v1/scan/entry and POST /api/v1/scan/food directly

</code_context>

<specifics>
## Specific Ideas

- Two-step confirm flow (scan → popup → confirm/dismiss) is critical — prevents accidental scans at busy food stalls
- Food stall auto-deduction by category: the stall knows what food type it serves, no vendor selection needed
- Tap to scan next: deliberate pacing prevents rapid double-scans that could confuse operators
- Session persists for the entire event: no mid-event re-authentication disruptions
- Admin sees scan rate per stall: operational monitoring for identifying bottlenecks

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-vendor-scanning-interface*
*Context gathered: 2026-04-12*
