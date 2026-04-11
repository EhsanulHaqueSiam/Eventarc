# Roadmap: EventArc

## Overview

EventArc delivers a high-concurrency event management platform in 10 phases using a hybrid architecture: Convex Pro for CRUD operations and real-time dashboard subscriptions, Go microservice + PostgreSQL + Redis for the scan processing hot path and background jobs (QR generation, card compositing, SMS). Phases move from infrastructure foundation (both Convex and Go scaffolds) through domain modeling, guest and QR pipelines, the critical scan processing hot path (split into entry core and food rules), vendor scanning with offline resilience, invitation delivery, and real-time dashboards -- culminating in a hardening phase that validates the entire system under production-scale load before any real event runs on it.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Domain Model** - Convex project + Go microservice scaffold, dual data layer (Convex DB + PostgreSQL), Redis, event/vendor/category CRUD via Convex
- [ ] **Phase 2: Guest Management** - Bulk import, deduplication, search/filter, guest lifecycle tracking
- [ ] **Phase 3: QR Code Generation Pipeline** - HMAC-signed QR payload, image generation, R2 storage, CDN delivery, background workers
- [ ] **Phase 4: Scan Processing Core** - Entry scan validation, idempotency, atomic counters, Redis cache, concurrent write handling
- [ ] **Phase 5: Food Scan & Rules Engine** - Food scan validation with cross-stall limits, dual mode (guest-linked/anonymous), configurable food rules
- [ ] **Phase 6: Vendor Scanning Interface** - Device-based sessions, camera QR scanning, scan feedback, stall selection UI
- [ ] **Phase 7: Offline Resilience** - IndexedDB scan queue, idempotent sync on reconnect, retroactive rejection, pending indicator
- [ ] **Phase 8: Invitation Card Editor & SMS Pipeline** - Fabric.js card editor, batch image compositing, bulk SMS delivery with tracking
- [ ] **Phase 9: Real-Time Admin Dashboard** - Convex real-time subscriptions, Go->Convex bridge mutations for scan events, live counters, vendor activity, alerts
- [ ] **Phase 10: Pre-Launch Hardening** - Load testing at 10K concurrent, integration tests for all config combos, production configuration, security validation

## Phase Details

### Phase 1: Foundation & Domain Model
**Goal**: Admin can create events, define guest categories, and configure vendor hierarchies through Convex-backed CRUD, with Go microservice + PostgreSQL + Redis scaffold ready for scan processing
**Depends on**: Nothing (first phase)
**Requirements**: EVNT-01, EVNT-02, EVNT-03, EVNT-04, VNDR-01, VNDR-02, VNDR-03, INFR-01, INFR-02
**Success Criteria** (what must be TRUE):
  1. Admin can create an event with name, date, venue, and description via API and see it persisted in the database
  2. Admin can configure an event's QR strategy (unified/separate), food QR mode (guest-linked/anonymous), and food QR timing (pre-sent/post-entry) and the configuration is stored and retrievable
  3. Admin can transition an event through lifecycle states (draft, active, live, completed, archived)
  4. Admin can define custom guest categories per event with different food/access privileges
  5. Admin can create a complete vendor hierarchy for an event (vendor types, categories, stalls) and each stall has its own identity in the system
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md -- Infrastructure scaffold: Docker Compose (PG + PgBouncer + Redis), Go microservice with chi router, HMAC middleware, health/sync endpoints, migrations, Dockerfile
- [x] 01-02-PLAN.md -- Convex backend: schema (5 tables), Better Auth admin authentication, event CRUD with lifecycle state machine, guest categories CRUD
- [x] 01-03-PLAN.md -- Vendor hierarchy CRUD in Convex, frontend scaffold (React + Vite + TailwindCSS + TanStack Router + Convex client + auth), Convex sync action stub

### Phase 2: Guest Management
**Goal**: Admin can populate an event with up to 60K guests through bulk import or manual entry and efficiently find any guest
**Depends on**: Phase 1
**Requirements**: GUST-01, GUST-02, GUST-03, GUST-04, GUST-05
**Success Criteria** (what must be TRUE):
  1. Admin can upload a CSV/Excel file and import guests with column mapping, receiving row-level validation errors for bad data
  2. System detects duplicate phone numbers during import and flags them for admin resolution instead of silently creating duplicates
  3. Admin can manually add an individual guest with name, phone number, and category assignment
  4. Admin can search and filter among 60K guest records by name, phone number, category, and status with responsive results
  5. Each guest's lifecycle status (invited, SMS sent, delivered, checked in, not arrived) is tracked and visible per event
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Convex backend: guests schema (search indexes, regular indexes), phone validation, guest CRUD mutations, search/filter queries, paginated list, bulk import pipeline (chunked 500-row batches), duplicate detection
- [ ] 02-02-PLAN.md -- Frontend: guest list page (search, filter, pagination), Add Guest dialog, 5-step import wizard (upload, column mapping, validation, duplicate resolution, chunked import with progress), SheetJS CSV/Excel parsing, Zustand wizard state

**UI hint**: yes

### Phase 3: QR Code Generation Pipeline
**Goal**: System generates unique, cryptographically signed QR code images for every guest and serves them instantly via CDN
**Depends on**: Phase 2
**Requirements**: QRCD-01, QRCD-02, QRCD-03, QRCD-04, QRCD-05, QRCD-06, INFR-05
**Success Criteria** (what must be TRUE):
  1. Each guest receives a unique QR code image with an HMAC-SHA256 signed payload that cannot be forged by modifying the token
  2. QR images are stored in Cloudflare R2 and accessible via CDN URL with sub-second load times
  3. Event's QR strategy (unified single QR vs separate entry/food QRs) determines what QR codes are generated per guest
  4. Food QR mode (guest-linked vs anonymous) and timing (pre-sent vs post-entry) configuration correctly controls when and how food QR codes are created
  5. QR generation runs asynchronously via background workers without blocking the admin's workflow
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md -- QR payload binary format with HMAC signing, QR code image generation (yeqown/go-qrcode v2), Cloudflare R2 storage client, config extension
- [ ] 03-02-PLAN.md -- asynq background worker, batch/single generation handlers, HTTP API for trigger/progress, Convex schema extensions, QR trigger action, Docker Compose worker service

### Phase 4: Scan Processing Core
**Goal**: Entry scans are processed correctly under 10K concurrent load with zero race conditions, zero false positives, and zero false negatives
**Depends on**: Phase 3, Phase 1
**Requirements**: SCAN-01, SCAN-02, SCAN-04, SCAN-05, SCAN-06, SCAN-07, SCAN-08, SCAN-09, INFR-03, INFR-04
**Success Criteria** (what must be TRUE):
  1. Entry scan validates QR authenticity via HMAC, checks guest existence, and atomically marks guest as checked-in with sub-second response
  2. Scanning the same entry QR a second time returns "already checked in" with the original timestamp and never allows double entry
  3. 10,000 concurrent scan requests are processed with zero race conditions -- verified by load test with Go's race detector
  4. Every scan writes atomically to both Redis and PostgreSQL -- Redis is the fast read path, PostgreSQL is the source of truth
  5. Atomic Redis counters (HINCRBY) increment on every valid scan, and counters are re-seeded from PostgreSQL on Redis restart
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD

### Phase 5: Food Scan & Rules Engine
**Goal**: Food scans enforce per-person and per-category consumption limits across all stalls in real-time, in both guest-linked and anonymous modes
**Depends on**: Phase 4
**Requirements**: SCAN-03, FOOD-01, FOOD-02, FOOD-03, FOOD-04
**Success Criteria** (what must be TRUE):
  1. Food scan checks a guest's total consumption across ALL stalls for a food category and rejects if the limit is reached -- regardless of which stall was visited before
  2. Admin-configured food rules (e.g., "1 fuchka per guest", "3 fuchka for VIP") are enforced at scan time per guest category
  3. In anonymous QR mode, food rules enforce per-token usage limits rather than per-guest limits
  4. All vendor scanning devices see the same consumption state immediately -- a scan at stall-1 is visible to stall-2 on its next scan
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Vendor Scanning Interface
**Goal**: Event vendors can scan QR codes using only a web browser on their phone or tablet with zero credentials and instant feedback
**Depends on**: Phase 4
**Requirements**: VSCN-01, VSCN-02, VSCN-03, VSCN-04, VSCN-05
**Success Criteria** (what must be TRUE):
  1. Vendor opens a URL, selects their stall from a hierarchical dropdown (event, vendor type, category, stall), and starts scanning -- no login required
  2. Device session persists across page refreshes so the operator never needs to re-select their stall
  3. Camera-based QR scanning works via the browser's getUserMedia API on mobile and tablet devices
  4. Each scan shows instant visual feedback (green/valid with guest info, red/invalid with rejection reason) and distinct audio cues
  5. Admin can view all active scanning sessions and revoke any device session from the admin interface
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

**UI hint**: yes

### Phase 7: Offline Resilience
**Goal**: Scanning continues uninterrupted during brief network drops with automatic recovery and no data loss or double-counting
**Depends on**: Phase 6
**Requirements**: OFFL-01, OFFL-02, OFFL-03, OFFL-04, OFFL-05
**Success Criteria** (what must be TRUE):
  1. When the device loses network, scans are queued locally in IndexedDB with timestamps and idempotency keys -- scanning does not stop
  2. On reconnection, queued scans are re-validated against current server state and not blindly accepted
  3. If a queued scan would have been invalid (guest hit limit while offline), it is flagged as rejected retroactively and the vendor device is notified
  4. Idempotency keys prevent double-counting even if sync retries multiple times
  5. Vendor sees a persistent "X scans pending" indicator when operating offline
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

**UI hint**: yes

### Phase 8: Invitation Card Editor & SMS Pipeline
**Goal**: Admin creates custom invitation cards with positioned QR codes, generates 60K composite images, and delivers them via SMS to every guest
**Depends on**: Phase 3
**Requirements**: INVT-01, INVT-02, INVT-03, INVT-04, INVT-05, INVT-06
**Success Criteria** (what must be TRUE):
  1. Admin uploads a card design image, drags and resizes the QR code overlay to the desired position, and previews the final composite
  2. Batch compositing pipeline generates 60K composite card images asynchronously with progress indicator and crash recovery
  3. Composite card images are stored in R2 and served via CDN
  4. Bulk SMS sends invitation messages with card download links to all guests, throttled to avoid carrier spam detection
  5. Per-guest SMS delivery status (queued, sent, delivered, failed) is tracked with retry for failures
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD
- [ ] 08-03: TBD

**UI hint**: yes

### Phase 9: Real-Time Admin Dashboard
**Goal**: Admin sees live event metrics updated within seconds of each scan -- attendance, food consumption, vendor activity, and system health -- without any manual refresh
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06
**Success Criteria** (what must be TRUE):
  1. Live attendance counter shows checked-in guests vs total invited, updated within seconds of each scan via SSE push
  2. Food consumption metrics display per-stall servings count, per-category totals, and consumption rates -- all sourced from atomic counters
  3. Vendor activity monitor shows active scanning stations, scan rates per stall, and last scan timestamp
  4. Alerts surface duplicate scan attempts, offline device notifications, retroactively rejected scans, and system health indicators
  5. Dashboard reads only from atomic Redis counters and never queries scan tables for aggregation -- connection auto-reconnects on loss
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD

**UI hint**: yes

### Phase 10: Pre-Launch Hardening
**Goal**: The complete system is validated under production-scale load and every supported configuration combination has end-to-end test coverage before any real event
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8, Phase 9
**Requirements**: (validates all -- no new requirements introduced)
**Success Criteria** (what must be TRUE):
  1. Load test suite runs 10K concurrent scan requests against a staging environment and all pass with zero race conditions and sub-second response times
  2. Integration tests cover every supported event configuration combination (unified/separate QR, guest-linked/anonymous food, pre-sent/post-entry timing) through the full entry + food + dashboard update flow
  3. QR security tests confirm that modified tokens and replayed entry QRs are rejected
  4. SMS batch test of 1,000+ messages through the production gateway confirms delivery rates
  5. 60K image generation test completes within acceptable time, stays within memory bounds, and resumes correctly after simulated crash
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Domain Model | 0/3 | Planned | - |
| 2. Guest Management | 0/2 | Planned | - |
| 3. QR Code Generation Pipeline | 0/2 | Planned | - |
| 4. Scan Processing Core | 0/3 | Not started | - |
| 5. Food Scan & Rules Engine | 0/2 | Not started | - |
| 6. Vendor Scanning Interface | 0/2 | Not started | - |
| 7. Offline Resilience | 0/2 | Not started | - |
| 8. Invitation Card Editor & SMS Pipeline | 0/3 | Not started | - |
| 9. Real-Time Admin Dashboard | 0/2 | Not started | - |
| 10. Pre-Launch Hardening | 0/2 | Not started | - |
