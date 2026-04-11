# Phase 6: Vendor Scanning Interface - Research

**Researched:** 2026-04-12
**Domain:** Browser-based QR scanning, device session management, mobile-first web UI
**Confidence:** HIGH

## Summary

Phase 6 delivers a browser-based QR scanning interface for vendor operators. The core technical challenges are: (1) reliable camera-based QR scanning across iOS Safari and Android Chrome using html5-qrcode, (2) device session management with server-side tokens persisted in localStorage, (3) a two-step confirm/dismiss flow that prevents accidental scans, and (4) admin session monitoring with real-time updates via Convex subscriptions.

The frontend stack is already established (React 19 + Vite + TailwindCSS + shadcn base-nova + TanStack Router + Convex client). Phase 6 adds a new `/scanner` route that operates independently from the admin dashboard -- no sidebar, no auth, just a full-screen mobile-first scanning interface. The Go backend needs a new device session management system (create/validate/revoke endpoints) and the Convex schema needs a `deviceSessions` table for admin monitoring.

**Primary recommendation:** Use html5-qrcode for camera QR scanning (widely adopted, handles iOS Safari quirks), Web Audio API for instant audio feedback (no network latency), and a Zustand-based scan state machine for the two-step confirm/dismiss flow.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Full-screen flash (green success / red failure) for ~1 second, followed by a result card showing guest info or error reason. Distinct audio cues for success and failure.
- **D-02:** Two-step scan flow: 1) Vendor scans QR -> popup shows guest info, allowance, and scan details. 2) Vendor explicitly clicks "Confirm" to process the scan (deduct food / mark entry) or "Dismiss" to cancel.
- **D-03:** After processing (confirm or dismiss), vendor taps "Scan Next" button to reactivate camera. No auto-continue.
- **D-04:** Server-side session with device token. On first stall selection, server generates a session token stored in localStorage. Token maps to stall assignment on the server. Survives page refreshes. Admin can revoke by invalidating the token server-side.
- **D-05:** Sessions remain active until the event ends -- no timeout or expiry.
- **D-06:** Stall selection flow: hierarchical dropdown -- event -> vendor type -> category -> stall. One screen, cascading dropdowns.
- **D-07:** Use html5-qrcode library for browser-based camera QR scanning.
- **D-08:** When a food stall vendor scans a food QR, the system automatically deducts from the food category that the stall belongs to.
- **D-09:** Admin session view shows per session: stall name, scans per minute rate, and online/offline status.
- **D-10:** Admin can revoke any device session from the admin interface.

### Claude's Discretion
Claude has flexibility on: result card auto-dismiss timing, audio cue design (beep types), camera viewfinder layout, stall selection UI details, session token format, WebSocket vs polling for session status, admin session list pagination/filtering.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VSCN-01 | Vendor opens URL, selects stall from dropdown, starts scanning -- no credentials | html5-qrcode for camera, cascading Select for stall hierarchy, no auth on /scanner route |
| VSCN-02 | Device session persists across page refreshes | Server-side session token in localStorage, Go session management endpoints |
| VSCN-03 | Camera-based QR scanning via getUserMedia API on mobile/tablet | html5-qrcode wraps getUserMedia, handles iOS Safari/Android Chrome differences |
| VSCN-04 | Instant visual and audio feedback on scan | Full-screen CSS flash overlay + Web Audio API for beeps |
| VSCN-05 | Admin can view active sessions and revoke device sessions | Convex deviceSessions table with real-time subscription, Go revocation endpoint |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack (frontend)**: React + TailwindCSS + Vite, pnpm, TanStack Router/Query, Convex React client
- **Tech stack (scan hot path)**: Go microservice + PostgreSQL + Redis -- handles QR scan validation
- **WebSocket library**: coder/websocket (Go side) for vendor scanner sync
- **Architecture**: Hybrid -- Convex for CRUD/real-time, Go+PostgreSQL+Redis for scan hot path
- **Cross-device**: iPhone, iPad, Android must work properly for vendor scanner UI

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| html5-qrcode | 2.3.8 | Browser QR scanning | Most widely-used browser QR library. Wraps getUserMedia, handles camera selection, torch, iOS Safari quirks. MIT license, 5K+ GitHub stars. [ASSUMED -- version needs npm verify] |
| Web Audio API | Browser native | Audio feedback cues | Zero-latency audio playback. No network request, no `<audio>` element buffering. Instant beep generation via OscillatorNode. [VERIFIED: Web standard, supported in all target browsers] |
| Zustand | 5.0.12 | Scan state machine | Already in project. Per-scan lifecycle state (idle -> scanned -> reviewing -> confirmed -> ready). [VERIFIED: frontend/package.json] |
| TanStack Router | 1.168.15 | /scanner route | Already in project. File-based routing -- add scanner route file. [VERIFIED: frontend/package.json] |
| Convex React | 1.35.1 | Admin session list, stall queries | Already in project. Real-time subscriptions for admin session monitoring. [VERIFIED: frontend/package.json] |
| sonner | 2.0.7 | Toast notifications | Already in project. Success/error toasts after scan server response. [VERIFIED: frontend/package.json] |
| coder/websocket | (Go side) | Session revocation push | Recommended in CLAUDE.md for vendor scanner sync. Session revocation notification requires server-to-client push. [CITED: CLAUDE.md] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 1.8.0 | Icons | Already installed. CheckCircle, XCircle, ShieldX, Camera, Wifi, WifiOff icons. [VERIFIED: frontend/package.json] |
| shadcn components | base-nova preset | UI primitives | Already installed: Button, Card, Select, AlertDialog, Badge, Table, Skeleton, Alert, Dialog. [VERIFIED: frontend/components.json] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| html5-qrcode | @nicolo-ribaudo/qr-scanner | Newer but smaller community, less iOS Safari battle-testing |
| html5-qrcode | zxing-js/library | Lower-level, requires manual getUserMedia handling |
| Web Audio API | Howler.js | Adds dependency for something the native API handles well |
| Zustand (scan state) | useReducer | Simpler but harder to debug; Zustand devtools help trace state transitions |

**Installation:**
```bash
cd frontend && pnpm add html5-qrcode
```

No other new packages needed -- everything else is already installed.

## Architecture Patterns

### Recommended Project Structure (Frontend)

```
frontend/src/
├── routes/
│   ├── scanner/
│   │   └── index.tsx           # /scanner route -- standalone, no admin shell
│   └── events/
│       └── $eventId.tsx        # Add "Sessions" tab to event detail
├── components/
│   ├── scanner/
│   │   ├── scanner-setup.tsx       # Stall selection with cascading dropdowns
│   │   ├── camera-viewfinder.tsx   # html5-qrcode wrapper
│   │   ├── scan-flash-overlay.tsx  # Full-screen color flash
│   │   ├── scan-result-card.tsx    # Guest info + Confirm/Dismiss
│   │   ├── scan-next-card.tsx      # Post-action "Scan Next"
│   │   ├── session-status.tsx      # Connection status indicator
│   │   └── session-revoked.tsx     # Revoked notification screen
│   └── sessions/
│       └── active-sessions-tab.tsx # Admin session management
├── hooks/
│   ├── use-scanner.ts              # Scan state machine (Zustand)
│   ├── use-audio-feedback.ts       # Web Audio API beep generation
│   └── use-device-session.ts       # Session token management
└── lib/
    └── scanner-audio.ts            # Audio cue definitions (frequencies, durations)
```

### Recommended Project Structure (Go Backend)

```
backend/
├── internal/
│   ├── handler/
│   │   └── session.go          # POST /api/v1/session (create), GET /api/v1/session (validate), DELETE /api/v1/session (revoke)
│   └── model/
│       └── session.go          # DeviceSession struct, token generation
└── cmd/
    └── server/
        └── main.go             # Add session routes
```

### Pattern 1: Scan State Machine (Zustand)

**What:** A finite state machine managing the scan lifecycle from idle through confirmation.
**When to use:** Every scan cycle follows the same state progression.

```typescript
// Source: Zustand store pattern [ASSUMED -- standard pattern]
type ScanState = 'idle' | 'scanned' | 'flash' | 'reviewing' | 'confirmed' | 'dismissed' | 'ready';

interface ScanStore {
  state: ScanState;
  scanResult: ScanResult | null;
  serverResponse: ServerResponse | null;
  
  onQrDetected: (result: ScanResult) => void;
  onFlashComplete: () => void;
  onConfirm: () => Promise<void>;
  onDismiss: () => void;
  onScanNext: () => void;
}
```

### Pattern 2: html5-qrcode Camera Integration

**What:** Wrapping html5-qrcode in a React component with start/stop lifecycle management.
**When to use:** The camera viewfinder component.

```typescript
// Source: html5-qrcode API [ASSUMED -- API shape from docs]
import { Html5Qrcode } from 'html5-qrcode';

const scanner = new Html5Qrcode("reader-element");

// Start scanning
await scanner.start(
  { facingMode: "environment" },  // Back camera
  { fps: 10, qrbox: { width: 280, height: 280 } },
  (decodedText) => { /* QR detected callback */ },
  (errorMessage) => { /* scan failure callback -- ignore, continuous scanning */ }
);

// Pause scanning (when showing result card)
await scanner.pause();

// Resume scanning (when "Scan Next" tapped)
await scanner.resume();

// Stop scanning (when leaving page)
await scanner.stop();
```

**Critical:** Must call `scanner.stop()` on component unmount. Leaving getUserMedia streams open drains battery and blocks camera for other apps.

### Pattern 3: Web Audio API Beep Generation

**What:** Generating short tonal beeps without any audio file loading.
**When to use:** Scan feedback audio cues.

```typescript
// Source: Web Audio API standard [VERIFIED: MDN Web Docs]
const audioCtx = new AudioContext();

function playBeep(frequency: number, duration: number) {
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  gainNode.gain.value = 0.3;
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + duration / 1000);
}

// Success: rising two-tone (440Hz + 660Hz)
function playSuccess() {
  playBeep(440, 100);
  setTimeout(() => playBeep(660, 100), 100);
}

// Failure: descending tone (440Hz + 220Hz)
function playFailure() {
  playBeep(440, 100);
  setTimeout(() => playBeep(220, 100), 100);
}
```

**Critical:** AudioContext must be created on user interaction (tap/click). Browsers block auto-play audio. Create the context on the "Start Scanning" button click.

### Pattern 4: Device Session Token Management (Go)

**What:** Stateless session tokens generated server-side, validated per request.
**When to use:** Every scanner API call includes the session token.

```go
// Source: Go crypto/rand + standard UUID approach [ASSUMED]
import (
    "crypto/rand"
    "encoding/hex"
)

func GenerateSessionToken() (string, error) {
    bytes := make([]byte, 32)
    if _, err := rand.Read(bytes); err != nil {
        return "", err
    }
    return hex.EncodeToString(bytes), nil
}
```

Session tokens are stored in Redis with the stall assignment:
```
Key:   session:{token}
Value: JSON { stallId, eventId, vendorCategoryId, vendorTypeId, createdAt }
TTL:   None (sessions persist until event ends or admin revokes)
```

### Pattern 5: Session Revocation via WebSocket

**What:** Go server pushes session revocation to vendor device via WebSocket.
**When to use:** When admin revokes a session, the vendor device needs immediate notification.

Alternative approach (simpler): Instead of maintaining a persistent WebSocket, the vendor device can check session validity before each scan (GET /api/v1/session). If the session is revoked, show the revoked screen. This adds ~50ms per scan but avoids WebSocket complexity.

**Recommendation:** Start with polling/check-per-scan approach. WebSocket adds operational complexity (connection management, reconnection logic). The 50ms overhead per scan is negligible relative to the scan-review-confirm cycle time (~3-5 seconds). Upgrade to WebSocket only if latency requirement tightens.

### Anti-Patterns to Avoid

- **Using `navigator.mediaDevices.getUserMedia` directly:** html5-qrcode handles camera permission, stream management, and cross-browser quirks. Direct getUserMedia requires manual handling of iOS Safari constraints (camera resolution limits, orientation changes).
- **Storing session data client-side:** Session token is opaque. All session state (stall assignment, event binding) lives server-side in Redis. Client only stores the token string.
- **Auto-dismissing result cards:** User decision D-02 requires explicit Confirm/Dismiss. Never auto-advance.
- **Using `<audio>` elements for scan beeps:** Adds network latency (even cached), doesn't work reliably across mobile browsers without user interaction pre-loading. Web Audio API is instant.
- **Creating camera scanner as admin-authenticated route:** Scanner is explicitly NO credentials (VSCN-01). The /scanner route has NO auth middleware. Session tokens are not auth tokens -- they map a device to a stall, not a user to a role.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| QR code scanning from camera | Custom getUserMedia + image processing | html5-qrcode | Camera permission handling, iOS Safari quirks, QR decode algorithms, torch control -- 100s of edge cases |
| Audio feedback | Custom oscillator management | Web Audio API (native) | Already in the browser, no dependency needed, but do use the native API not raw `<audio>` |
| Session token generation | Custom random strings | crypto/rand + hex encode | Cryptographic randomness is essential for unpredictable tokens |
| Camera selection (front/back) | Custom media device enumeration | html5-qrcode built-in camera selection | Handles device-specific quirks |

**Key insight:** html5-qrcode is the critical dependency. It handles dozens of cross-browser camera quirks that would take weeks to discover and fix individually.

## Common Pitfalls

### Pitfall 1: iOS Safari Camera Permission

**What goes wrong:** iOS Safari requires HTTPS for getUserMedia. Camera access silently fails on HTTP.
**Why it happens:** Safari enforces Secure Context requirement more strictly than Chrome.
**How to avoid:** Always serve the scanner page over HTTPS in production. In development, localhost is treated as secure context. For LAN testing (phone accessing dev machine), use a tool like mkcert for local HTTPS.
**Warning signs:** Camera works on desktop Chrome but not on iPhone Safari.

### Pitfall 2: AudioContext Auto-Play Policy

**What goes wrong:** `new AudioContext()` created without user gesture starts in "suspended" state. No sound plays.
**Why it happens:** Browsers prevent audio auto-play to avoid unwanted sounds.
**How to avoid:** Create AudioContext inside a click/tap event handler (e.g., "Start Scanning" button). Call `audioCtx.resume()` if state is suspended.
**Warning signs:** First beep never plays, subsequent beeps work after any tap.

### Pitfall 3: html5-qrcode Memory Leak

**What goes wrong:** Camera stream stays open after navigating away from scanner page.
**Why it happens:** html5-qrcode's `stop()` method not called on component unmount.
**How to avoid:** Use React `useEffect` cleanup function to call `scanner.stop()`. Also handle `beforeunload` event for page refresh scenarios.
**Warning signs:** Phone camera LED stays on after leaving scanner page, battery drains faster.

### Pitfall 4: Double-Scan Race Condition

**What goes wrong:** html5-qrcode fires the success callback multiple times for the same QR code within milliseconds.
**Why it happens:** QR code stays in camera view while processing the first detection.
**How to avoid:** Immediately call `scanner.pause()` on first detection. The scan state machine transitions to 'scanned' state, which ignores subsequent callbacks. Only `scanner.resume()` on "Scan Next".
**Warning signs:** Multiple flash overlays appear, multiple server requests for same QR.

### Pitfall 5: localStorage Cleared by Browser

**What goes wrong:** Session token disappears, vendor must re-select stall.
**Why it happens:** iOS Safari in private browsing mode may clear localStorage. Some Android browsers clear storage after extended background.
**How to avoid:** On the active scanning screen, periodically verify session validity (every 60 seconds). If localStorage is empty, show a "Session expired -- select station again" message rather than silently failing. Consider also storing the token in a cookie as backup.
**Warning signs:** Vendor reports having to re-select stall after switching apps or after phone screen lock.

### Pitfall 6: Camera Orientation on Android

**What goes wrong:** QR scanning works but viewfinder appears rotated or stretched on some Android devices.
**Why it happens:** Android devices report different video stream orientations.
**How to avoid:** html5-qrcode handles most cases. If issues persist, set explicit video constraints: `{ width: { ideal: 1280 }, height: { ideal: 720 } }` and use CSS `object-fit: cover` on the video element.
**Warning signs:** QR codes only scan when phone is held at an unusual angle.

## Code Examples

### Cascading Select for Stall Hierarchy

```typescript
// Source: React state pattern [ASSUMED]
const [eventId, setEventId] = useState<string | null>(null);
const [vendorTypeId, setVendorTypeId] = useState<string | null>(null);
const [categoryId, setCategoryId] = useState<string | null>(null);
const [stallId, setStallId] = useState<string | null>(null);

// Convex queries -- only fetch when parent is selected
const events = useQuery(api.events.listLive); // Only "live" events
const vendorTypes = useQuery(
  api.vendorTypes.listByEvent,
  eventId ? { eventId } : "skip"
);
const categories = useQuery(
  api.vendorCategories.listByVendorType,
  vendorTypeId ? { vendorTypeId } : "skip"
);
const stalls = useQuery(
  api.stalls.listByCategory,
  categoryId ? { categoryId } : "skip"
);

// Reset children on parent change
const handleEventChange = (id: string) => {
  setEventId(id);
  setVendorTypeId(null);
  setCategoryId(null);
  setStallId(null);
};
```

### Session Token Flow (Frontend)

```typescript
// Source: localStorage + fetch pattern [ASSUMED]
const SESSION_KEY = 'eventarc_scanner_session';

async function createSession(stallId: string): Promise<string> {
  const res = await fetch('/api/v1/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stallId }),
  });
  const { token } = await res.json();
  localStorage.setItem(SESSION_KEY, token);
  return token;
}

async function validateSession(): Promise<SessionInfo | null> {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return null;
  const res = await fetch('/api/v1/session', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  return res.json();
}
```

### Go Session Handler

```go
// Source: chi router + Redis session pattern [ASSUMED]
func (h *SessionHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
    var req struct {
        StallID string `json:"stallId"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        respondError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
        return
    }
    
    token, err := GenerateSessionToken()
    if err != nil {
        respondError(w, http.StatusInternalServerError, "token_error", "Failed to generate session")
        return
    }
    
    session := DeviceSession{
        Token:     token,
        StallID:   req.StallID,
        CreatedAt: time.Now(),
    }
    
    // Store in Redis -- no TTL (session persists until event ends)
    sessionJSON, _ := json.Marshal(session)
    h.redis.Set(r.Context(), "session:"+token, sessionJSON, 0)
    
    // Also sync to Convex for admin monitoring
    // (via asynq background job or direct HTTP action)
    
    respondJSON(w, http.StatusCreated, map[string]string{"token": token})
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| navigator.getUserMedia (deprecated) | navigator.mediaDevices.getUserMedia | 2018+ | html5-qrcode handles this internally |
| WebRTC for camera access | getUserMedia (simpler) | Always | QR scanning doesn't need WebRTC complexity |
| `<audio>` preload for feedback | Web Audio API OscillatorNode | 2020+ | Instant playback, no file loading, zero latency |
| Session cookies for device tracking | localStorage + Bearer tokens | Common pattern | More explicit, no CSRF concerns, works cross-origin |

**Deprecated/outdated:**
- `navigator.getUserMedia` -- replaced by `navigator.mediaDevices.getUserMedia` (html5-qrcode uses the modern API)
- `webkitAudioContext` -- modern browsers all support `AudioContext` now

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | html5-qrcode version 2.3.8 is latest stable | Standard Stack | Low -- version may differ, functionality unchanged |
| A2 | html5-qrcode has pause/resume API | Architecture Patterns | Medium -- if missing, must stop/start camera (slower transition) |
| A3 | Web Audio API works in iOS Safari without issues | Standard Stack | Medium -- some iOS versions had AudioContext quirks |
| A4 | Convex "skip" pattern works for conditional queries | Code Examples | Low -- documented Convex pattern |

## Open Questions

1. **WebSocket vs polling for session revocation**
   - What we know: coder/websocket is in the stack (CLAUDE.md), WebSocket is recommended for vendor scanner sync
   - What's unclear: Whether the latency benefit of WebSocket (instant revocation notification) justifies the complexity for Phase 6, vs. checking session validity before each scan
   - Recommendation: Start with check-per-scan approach (simpler). WebSocket can be added in Phase 7 (offline resilience) which already needs bidirectional communication.

2. **Convex sync for session monitoring**
   - What we know: Admin needs to see active sessions in real-time (Convex subscription)
   - What's unclear: How to sync session data from Redis (Go side) to Convex (admin side)
   - Recommendation: On session create/revoke, Go makes HTTP action call to Convex to create/update deviceSessions record. Same pattern as Phase 4 scan sync-back.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Go | Backend session endpoints | Yes | 1.26.0 | -- |
| Node.js / pnpm | Frontend build | Yes | v24.14.1 / 10.33.0 | -- |
| Docker | Dev infrastructure | Yes | 29.4.0 | -- |
| Redis | Session token storage | Yes (via Docker Compose) | 8.0+ | -- |
| html5-qrcode | QR scanning | Not installed | -- | pnpm add html5-qrcode |
| HTTPS (production) | iOS Safari camera | N/A (prod) | -- | localhost secure context for dev |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:**
- html5-qrcode: Not yet installed, added via `pnpm add html5-qrcode` in plan

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (frontend) | Vitest + React Testing Library |
| Config file | frontend/vitest.config.ts |
| Quick run command | `cd frontend && pnpm vitest run --reporter=verbose` |
| Full suite command | `cd frontend && pnpm vitest run` |
| Framework (backend) | Go stdlib testing |
| Quick run command | `cd backend && go test ./... -v -count=1` |
| Full suite command | `cd backend && go test ./... -race` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VSCN-01 | Stall selection cascading dropdowns render and filter correctly | unit | `cd frontend && pnpm vitest run src/components/scanner/scanner-setup.test.tsx` | Wave 0 |
| VSCN-02 | Session token stored in localStorage, validated on page load | unit | `cd frontend && pnpm vitest run src/hooks/use-device-session.test.ts` | Wave 0 |
| VSCN-02 | Go session create/validate/revoke endpoints | unit | `cd backend && go test ./internal/handler/ -run TestSession -v` | Wave 0 |
| VSCN-03 | Camera viewfinder mounts/unmounts without memory leak | unit | `cd frontend && pnpm vitest run src/components/scanner/camera-viewfinder.test.tsx` | Wave 0 |
| VSCN-04 | Scan state machine transitions correctly | unit | `cd frontend && pnpm vitest run src/hooks/use-scanner.test.ts` | Wave 0 |
| VSCN-04 | Audio feedback plays on correct state transitions | unit | `cd frontend && pnpm vitest run src/hooks/use-audio-feedback.test.ts` | Wave 0 |
| VSCN-05 | Admin session list renders with real-time data | unit | `cd frontend && pnpm vitest run src/components/sessions/active-sessions-tab.test.tsx` | Wave 0 |
| VSCN-05 | Session revocation updates both Redis and Convex | integration | `cd backend && go test ./internal/handler/ -run TestSessionRevoke -v` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd frontend && pnpm vitest run --reporter=verbose` + `cd backend && go test ./... -v -count=1`
- **Per wave merge:** Full suite with race detector: `cd backend && go test ./... -race`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `frontend/src/hooks/use-scanner.test.ts` -- scan state machine unit tests
- [ ] `frontend/src/hooks/use-device-session.test.ts` -- session token management tests
- [ ] `frontend/src/hooks/use-audio-feedback.test.ts` -- audio feedback tests (mock AudioContext)
- [ ] `frontend/src/components/scanner/scanner-setup.test.tsx` -- cascading dropdown tests
- [ ] `backend/internal/handler/session_test.go` -- session CRUD endpoint tests

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Scanner is explicitly credential-free (VSCN-01). Admin auth already handled by Better Auth (Phase 1). |
| V3 Session Management | Yes | Server-side device sessions in Redis. Cryptographically random tokens (crypto/rand). No sensitive data in token. Admin revocation capability. |
| V4 Access Control | Yes | Session token scopes device to specific stall/event. Admin-only revocation via authenticated admin routes. |
| V5 Input Validation | Yes | Stall ID validated against Convex data before session creation. QR payload validated via HMAC (Phase 4). |
| V6 Cryptography | No | No new crypto beyond existing QR HMAC (Phase 3) and session token generation (crypto/rand). |

### Known Threat Patterns for Scanner Interface

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Session token brute-force | Spoofing | 256-bit token (hex-encoded 32 bytes) -- 2^256 keyspace makes brute-force infeasible |
| Session token theft from localStorage | Spoofing | Token is device-specific, not user-specific. Stolen token only grants access to the assigned stall's scan capability. Admin can revoke. No PII in session. |
| Unauthorized scan processing | Tampering | Scan endpoints validate QR HMAC signature (Phase 4). Invalid QR payloads rejected regardless of session. |
| Camera access abuse | Information Disclosure | Camera access is user-granted (browser permission prompt). html5-qrcode only accesses camera when scanning page is active. |
| Admin session list data exposure | Information Disclosure | Admin routes protected by Better Auth. Session list only shows stall name and scan rate -- no PII. |
| Session fixation | Spoofing | Server generates token (not client). Token is random, not predictable. |
| Cross-origin scanner access | Tampering | CORS middleware (already implemented) restricts origins in production. |

## Sources

### Primary (HIGH confidence)
- `frontend/package.json` -- verified installed packages and versions
- `frontend/components.json` -- verified shadcn configuration (base-nova, lucide)
- `frontend/src/app.css` -- verified theme tokens (success, warning, custom colors)
- `backend/cmd/server/main.go` -- verified Go server structure (chi router, middleware chain)
- `convex/schema.ts` -- verified schema (events, vendorTypes, vendorCategories, stalls, guests)
- `convex/stalls.ts` -- verified stall CRUD patterns (listByCategory query)
- Phase 1 CONTEXT.md -- verified upstream decisions (D-20: passwordless vendor sessions, D-28: cross-device)
- Phase 4 CONTEXT.md -- verified scan response format (D-07: guest name/category, D-08: duplicate timestamp/stall)
- Phase 5 CONTEXT.md -- verified food scan response (D-07: food category/used/limit, D-08: consumption history)

### Secondary (MEDIUM confidence)
- Web Audio API -- MDN documentation for OscillatorNode and AudioContext [ASSUMED: well-established API]
- getUserMedia -- MDN documentation for camera access [ASSUMED: well-established API]

### Tertiary (LOW confidence)
- html5-qrcode API shape (pause/resume/stop) -- from training knowledge, needs npm package verification [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all core libraries already in the project except html5-qrcode
- Architecture: HIGH -- patterns follow existing codebase conventions (chi router, Convex queries, Zustand stores)
- Pitfalls: MEDIUM -- iOS Safari and AudioContext quirks are well-documented but specific version behavior may vary
- Security: HIGH -- simple session model with no sensitive data, main attack surface is existing scan HMAC validation

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (30 days -- stable stack, no fast-moving dependencies)
