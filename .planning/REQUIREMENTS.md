# Requirements: EventArc

**Defined:** 2026-04-11
**Core Value:** QR-based event operations (entry + food) must be accurate at scale — no false positives, no false negatives, no race conditions, even with 10K concurrent scans.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Event Management

- [ ] **EVNT-01**: Admin can create a new event with name, date, venue, and description
- [ ] **EVNT-02**: Admin can configure event settings: QR strategy (unified or separate), food QR mode (guest-linked or anonymous), food QR timing (pre-sent or post-entry)
- [ ] **EVNT-03**: Admin can manage multiple events with lifecycle states (draft, active, live, completed, archived)
- [ ] **EVNT-04**: Admin can define custom guest categories per event with different food/access privileges

### Guest Management

- [ ] **GUST-01**: Admin can bulk-import guests via CSV/Excel with column mapping and row-level validation errors
- [ ] **GUST-02**: Admin can manually add individual guests with name, phone number, and category assignment
- [ ] **GUST-03**: System deduplicates guests on phone number during import, flagging duplicates for admin resolution
- [ ] **GUST-04**: Admin can search and filter guests by name, phone number, category, and status among 60K records
- [ ] **GUST-05**: System tracks guest lifecycle status per event: invited, SMS sent, SMS delivered, checked in, not arrived

### QR Code System

- [ ] **QRCD-01**: System pre-generates unique HMAC-signed QR code images for each guest at invitation time
- [ ] **QRCD-02**: QR images are stored in cloud object storage (Cloudflare R2) and served via CDN
- [ ] **QRCD-03**: Admin configures per event: unified QR (one code for entry + food) or separate QRs (one for entry, one for food)
- [ ] **QRCD-04**: Food QR operates in guest-linked mode (tied to a person, enforces per-person consumption limits) or anonymous mode (valid token, tracks volume only) — admin configurable per event
- [ ] **QRCD-05**: Food QR timing is admin-configurable: pre-sent with invitation SMS or generated after entry scan
- [ ] **QRCD-06**: QR payload includes HMAC-SHA256 signature to prevent forgery — payload format is locked before any cards are generated

### Scan Processing (Core — Zero Tolerance)

- [ ] **SCAN-01**: Entry scan validates QR authenticity (HMAC verification), checks guest exists, and atomically marks guest as checked-in — all within sub-second response
- [ ] **SCAN-02**: Duplicate entry scan on same QR returns "already checked in" with original timestamp — never allows double entry
- [ ] **SCAN-03**: Food scan validates QR authenticity, checks guest's total consumption across ALL stalls for that food category in real-time, and rejects if limit reached — regardless of which stall the guest visited before
- [ ] **SCAN-04**: Every scan writes to both Redis cache and PostgreSQL database atomically — Redis is the fast read path, DB is the source of truth
- [ ] **SCAN-05**: Scan validation uses database-level idempotent operations (INSERT ON CONFLICT) with client-generated idempotency keys — no check-then-act race conditions
- [ ] **SCAN-06**: 10,000 concurrent scan requests are processed correctly with zero race conditions, zero false positives (unauthorized access), and zero false negatives (valid guest rejected)
- [ ] **SCAN-07**: All vendor devices see the same consumption state at the same time — when a scan at stall-1 updates consumption, stall-2 reads the updated state on its next scan immediately
- [ ] **SCAN-08**: Atomic Redis counters (HINCRBY) increment on every valid scan — dashboard reads counters, never COUNT(*) queries
- [ ] **SCAN-09**: Redis counters are backed by periodic DB reconciliation — on Redis restart, counters are reseeded from DB before dashboard reconnects

### Food Rules Engine

- [ ] **FOOD-01**: Admin configures per-category consumption limits per event (e.g., "1 fuchka per guest", "unlimited biryani", "2 drinks total")
- [ ] **FOOD-02**: Food rules are enforced cross-stall — guest's fuchka limit applies across fuchka-stall-1, fuchka-stall-2, etc.
- [ ] **FOOD-03**: Rules can be set per guest category — e.g., VIP gets 3 fuchka, regular gets 1
- [ ] **FOOD-04**: In anonymous QR mode, food rules enforce per-QR-token limits (each token has X uses) rather than per-guest limits

### Vendor Management

- [ ] **VNDR-01**: Admin configures vendor hierarchy per event: vendor types (entry, food) → categories (fuchka, biryani) → stalls (fuchka-1, fuchka-2)
- [ ] **VNDR-02**: Each stall is an independent scanning point with its own identity in the system
- [ ] **VNDR-03**: Admin can add, remove, or reconfigure stalls before and during an event

### Vendor Scanning Interface

- [ ] **VSCN-01**: Vendor opens a URL, selects their stall from a dropdown (event → vendor type → category → stall), and starts scanning — no credentials required
- [ ] **VSCN-02**: Device-based session persists across page refreshes — operator doesn't need to re-select stall
- [ ] **VSCN-03**: Camera-based QR scanning via web browser (getUserMedia API) — works on mobile and tablet browsers
- [ ] **VSCN-04**: Instant visual and audio feedback on scan: green/valid with guest info, red/invalid with rejection reason (already used, limit reached, invalid QR, etc.)
- [ ] **VSCN-05**: Admin can view active scanning sessions and revoke device sessions

### Offline Resilience

- [ ] **OFFL-01**: When device loses network, scanning continues — scans are queued locally in IndexedDB with timestamps and idempotency keys
- [ ] **OFFL-02**: On reconnection, queued scans are re-validated against current DB state — not blindly accepted
- [ ] **OFFL-03**: If a queued scan would have been invalid (guest hit limit while device was offline), it's flagged as rejected retroactively and vendor device is notified
- [ ] **OFFL-04**: Offline mode is a brief safety net (minutes), not a sustained operating mode — system is primarily online
- [ ] **OFFL-05**: No duplicate processing on sync — idempotency keys prevent double-counting even if sync retries

### Invitation System

- [ ] **INVT-01**: Visual drag-drop card editor: admin uploads a design image, positions and resizes QR code overlay, previews final composite
- [ ] **INVT-02**: Batch image composition pipeline generates 60K composite invitation card images (design + QR overlay) asynchronously via background workers
- [ ] **INVT-03**: Composite card images are stored in Cloudflare R2 and served via CDN
- [ ] **INVT-04**: Bulk SMS delivery sends invitation messages with card download link to all guests, throttled to avoid carrier spam detection
- [ ] **INVT-05**: Per-guest SMS delivery status tracking: queued, sent, delivered, failed — with retry for failures
- [ ] **INVT-06**: Guest opens SMS, sees invitation card with embedded QR code that can be downloaded and shown at venue

### Real-Time Admin Dashboard

- [ ] **DASH-01**: Live attendance counter: checked-in guests vs total invited, updated within seconds of each scan via SSE
- [ ] **DASH-02**: Food consumption metrics: per-stall servings count, per-category totals, consumption rates — all via atomic counters
- [ ] **DASH-03**: Vendor activity monitor: active scanning stations, scan rates per stall, last scan timestamp
- [ ] **DASH-04**: Alerts: duplicate scan attempts, offline device notifications, retroactively rejected offline scans, system health indicators
- [ ] **DASH-05**: Dashboard reads atomic counters only — never queries scan tables for aggregation
- [ ] **DASH-06**: Real-time push via Server-Sent Events (SSE) — dashboard auto-reconnects on connection loss

### Infrastructure & Data Integrity

- [ ] **INFR-01**: CDN → Redis cache → PostgreSQL database layered architecture
- [ ] **INFR-02**: PgBouncer connection pooling for PostgreSQL to handle 10K concurrent connections
- [ ] **INFR-03**: All scan operations are idempotent — replaying the same scan request produces the same result without side effects
- [ ] **INFR-04**: Strong consistency on scan hot path — no eventual consistency for consumption state
- [ ] **INFR-05**: Background worker system (asynq) for async tasks: QR generation, image composition, SMS delivery

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Analytics & Reporting

- **ANLT-01**: Post-event analytics: detailed consumption reports, peak time analysis, vendor performance
- **ANLT-02**: Exportable reports in CSV/PDF format
- **ANLT-03**: Guest activity timeline: per-guest audit trail of entry and consumption

### Event Templates

- **TMPL-01**: Clone event configuration from previous events for recurring events

### Enhanced Features

- **ENHC-01**: Walk-in guest handling: quick-add at entry gates with immediate QR generation
- **ENHC-02**: QR code regeneration: invalidate and reissue QR for a guest (lost phone, compromised code)
- **ENHC-03**: Multi-admin roles: super admin, event manager, viewer with permission matrices
- **ENHC-04**: Email invitation channel alongside SMS

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Payment processing at stalls | Food is free/included — QR tracks consumption only, not payments |
| Native mobile app | Web-based PWA with camera access is sufficient for v1 |
| Guest self-registration | Private event system — admin controls guest list |
| Seating management | Different product domain, not related to QR access/food tracking |
| Video/livestream | Not an event broadcasting platform |
| Multi-language support | English-only for v1, internationalize in v2 if demand proven |
| Real-time chat with guests | Massive infrastructure for marginal value |
| Badge/wristband printing | QR on phone screen is the credential |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVNT-01 | Phase 1 | Pending |
| EVNT-02 | Phase 1 | Pending |
| EVNT-03 | Phase 1 | Pending |
| EVNT-04 | Phase 1 | Pending |
| GUST-01 | Phase 2 | Pending |
| GUST-02 | Phase 2 | Pending |
| GUST-03 | Phase 2 | Pending |
| GUST-04 | Phase 2 | Pending |
| GUST-05 | Phase 2 | Pending |
| QRCD-01 | Phase 3 | Pending |
| QRCD-02 | Phase 3 | Pending |
| QRCD-03 | Phase 3 | Pending |
| QRCD-04 | Phase 3 | Pending |
| QRCD-05 | Phase 3 | Pending |
| QRCD-06 | Phase 3 | Pending |
| SCAN-01 | Phase 4 | Pending |
| SCAN-02 | Phase 4 | Pending |
| SCAN-03 | Phase 5 | Pending |
| SCAN-04 | Phase 4 | Pending |
| SCAN-05 | Phase 4 | Pending |
| SCAN-06 | Phase 4 | Pending |
| SCAN-07 | Phase 4 | Pending |
| SCAN-08 | Phase 4 | Pending |
| SCAN-09 | Phase 4 | Pending |
| FOOD-01 | Phase 5 | Pending |
| FOOD-02 | Phase 5 | Pending |
| FOOD-03 | Phase 5 | Pending |
| FOOD-04 | Phase 5 | Pending |
| VNDR-01 | Phase 1 | Pending |
| VNDR-02 | Phase 1 | Pending |
| VNDR-03 | Phase 1 | Pending |
| VSCN-01 | Phase 6 | Pending |
| VSCN-02 | Phase 6 | Pending |
| VSCN-03 | Phase 6 | Pending |
| VSCN-04 | Phase 6 | Pending |
| VSCN-05 | Phase 6 | Pending |
| OFFL-01 | Phase 7 | Pending |
| OFFL-02 | Phase 7 | Pending |
| OFFL-03 | Phase 7 | Pending |
| OFFL-04 | Phase 7 | Pending |
| OFFL-05 | Phase 7 | Pending |
| INVT-01 | Phase 8 | Pending |
| INVT-02 | Phase 8 | Pending |
| INVT-03 | Phase 8 | Pending |
| INVT-04 | Phase 8 | Pending |
| INVT-05 | Phase 8 | Pending |
| INVT-06 | Phase 8 | Pending |
| DASH-01 | Phase 9 | Pending |
| DASH-02 | Phase 9 | Pending |
| DASH-03 | Phase 9 | Pending |
| DASH-04 | Phase 9 | Pending |
| DASH-05 | Phase 9 | Pending |
| DASH-06 | Phase 9 | Pending |
| INFR-01 | Phase 1 | Pending |
| INFR-02 | Phase 1 | Pending |
| INFR-03 | Phase 4 | Pending |
| INFR-04 | Phase 4 | Pending |
| INFR-05 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 58 total
- Mapped to phases: 58
- Unmapped: 0

---
*Requirements defined: 2026-04-11*
*Last updated: 2026-04-11 after roadmap creation*
