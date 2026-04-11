# Project Research Summary

**Project:** EventArc - High-Concurrency Event Management Platform
**Domain:** Large-scale private event management with QR-based access control and food distribution tracking
**Researched:** 2026-04-11
**Confidence:** HIGH

## Executive Summary

EventArc is a high-concurrency private event management platform designed to handle 60K guests and 10K simultaneous QR scans. The research across all four domains converges on a clear architecture: Go backend with chi router, PostgreSQL as the durable source of truth, Redis for atomic counters and caching, and a React/Vite/TanStack frontend. The system is fundamentally I/O-bound (database and network are the bottlenecks, not CPU), which makes Go the right language choice — Rust's raw throughput advantage is irrelevant when PgBouncer and Redis are the actual ceilings. No competitor currently offers the combination of QR entry control with per-stall food distribution tracking; this is genuinely unserved territory.

The recommended architecture uses a strict write path: scanner hits the API, which validates against Redis cache, performs a lock-free idempotent insert via PostgreSQL's `INSERT ... ON CONFLICT DO NOTHING`, atomically increments Redis counters via HINCRBY, and publishes a Pub/Sub event that SSE handlers fan out to connected admin dashboards. This design separates the scan hot path (Redis + PG write) from the dashboard read path (Redis counters via SSE push only) — a critical separation that prevents analytics queries from degrading scan processing under load. All background work (image compositing, SMS delivery, counter reconciliation) runs via the asynq task queue to keep request handlers fast and stateless.

The most consequential risks — concurrent scan race conditions, Redis counter drift on crash, offline queue duplicates, and QR forgery — all have well-understood mitigations that must be built into the first functional phases, not retrofitted later. QR payload format (HMAC-SHA256 signed), idempotency key design, the strategy pattern for event configuration modes, and the Redis-backed counter architecture are architectural commitments that must be locked before any business logic is written. Any shortcut in these foundational areas cannot be corrected without significant rework after invitation cards have been sent.

## Key Findings

### Recommended Stack

The backend stack centers on Go 1.23+ with chi v5 for HTTP routing, pgx/v5 with sqlc for type-safe database access, go-redis/v9, and asynq for async job processing. PostgreSQL 17 paired with PgBouncer (transaction pooling, pool_size=150) handles 10K concurrent writes — PgBouncer is mandatory, not optional: without it, PostgreSQL would need 10K process connections (100GB RAM). Redis 8 serves triple duty: atomic counters, QR lookup cache, and Pub/Sub for dashboard broadcasting. The frontend uses React 19 + Vite 8 + TanStack Router + TanStack Query + Zustand, with Fabric.js for the invitation card editor canvas. Cloudflare R2 provides zero-egress-fee object storage for 60K composite card images, with Cloudflare CDN handling delivery automatically.

**Core technologies:**
- **Go 1.23+**: Backend — native goroutine concurrency maps directly to 10K simultaneous scan requests; I/O-bound workload negates Rust's raw throughput advantage; compiles in seconds vs Rust's minutes
- **PostgreSQL 17 + PgBouncer**: Storage + connection pooling — PgBouncer transaction pooling multiplexes 10K app connections to ~150 actual PG connections, enabling 15K+ transactions/sec theoretical throughput
- **Redis 8**: Atomic counters + cache + Pub/Sub — single-threaded Redis makes INCR/HINCRBY lock-free by definition; sub-millisecond for all counter operations
- **pgx/v5 + sqlc**: Database access — pgx/v5 is the fastest Go PostgreSQL driver; sqlc generates type-safe Go from raw SQL with no ORM reflection overhead (2x faster than GORM for reads)
- **asynq**: Background jobs — Redis-backed queue with retries, scheduling, priority queues, and built-in web UI for monitoring image compositing and SMS pipelines; still v0.x but API is stable in practice
- **SSE (admin dashboard) + WebSocket (vendor scanners)**: Real-time — SSE for unidirectional dashboard updates (built-in auto-reconnect, HTTP/2 native, no special proxy config); WebSocket only where bidirectional comms are needed (scanner sync/ack)
- **React 19 + Vite 8 + TanStack Router/Query**: Frontend — type-safe routing, server-state management with SSE-driven cache invalidation, 1KB Zustand for scanner UI-only state
- **Cloudflare R2 + CDN**: Storage — zero egress fees vs S3's $0.09/GB; S3-compatible API prevents lock-in; CDN coverage automatic with custom domain
- **coder/websocket**: WebSocket library — context-aware, concurrent-write-safe; gorilla/websocket is archived since 2022 and must not be used
- **Fabric.js**: Card editor canvas — built-in transform controls (resize, rotate, position); Konva.js requires manual transform implementation

### Expected Features

**Must have (table stakes) — system is non-functional without these:**
- CSV/Excel bulk guest import with column mapping, per-row validation, and deduplication (phone as primary identifier)
- Guest categories/tiers with admin-configurable food rules and access privileges per category per event
- Unique QR per guest with HMAC-SHA256 signed payload (opaque token, never raw guest ID)
- Configurable QR strategy per event: unified (one QR for entry + food) or separate QRs
- Dual food scan modes: guest-linked (per-person limits enforced atomically) and anonymous (volume tracking only)
- Idempotent entry and food scan validation handling 10K concurrent requests using INSERT ON CONFLICT
- Vendor hierarchy: vendor types → food categories → individual stalls, each an independent scan point
- Device-based vendor scanning with no credentials — admin approves devices; sessions scoped to one event, expire at event end
- Camera-based QR scanning via web browser (getUserMedia API, no native app required)
- Offline scan queuing with durable IndexedDB storage and idempotent sync on reconnect
- Visual invitation card editor: drag-drop QR placement and resize on uploaded card template (Fabric.js)
- Async batch image compositing pipeline for 60K cards with parallel workers, progress tracking, and crash resume
- Bulk SMS delivery with throttling (200-500 msg/min to avoid carrier blocks), delivery status webhooks, per-code retry
- Real-time admin dashboard via SSE: live attendance counters, food consumption by stall/category, vendor activity
- Atomic Redis counter system — NO COUNT(*) queries against the scan table for any live dashboard data

**Should have (differentiators — what makes EventArc genuinely novel):**
- Food distribution tracking per vendor stall with per-category limits and cross-stall rule enforcement ("one fuchka regardless of which stall scanned it") — no mainstream event platform does this
- Real-time food consumption dashboard with per-stall rate metrics — closest analogs are restaurant analytics systems, not event management platforms
- Admin-configurable food rules per guest category with cross-stall enforcement at scan time
- Food QR timing configuration: pre-sent with invitation vs generated and delivered after entry scan
- Guest-linked consumption history queryable for both rule enforcement (live, at scan time) and post-event analysis

**Defer to v1.x (after first successful real event):**
- Post-event analytics reports with exportable CSV/PDF
- Event templates (clone full config from previous events)
- Dashboard alerts for anomalies (stall going silent, consumption rate spikes, capacity thresholds)
- Walk-in guest handling with on-the-spot QR generation at entry gates
- QR code regeneration (invalidate and reissue for a guest who lost their phone)

**Defer to v2+:**
- Multi-admin roles with RBAC (permission matrices add combinatorial complexity)
- Email invitation channel (SMS has 98% open rate; email adds dual-channel management overhead)
- Multi-language / i18n support
- Native mobile apps (PWA with camera access is sufficient for v1)
- Third-party API/webhook integration for external system consumption

### Architecture Approach

The system uses a layered write-path architecture where the scan hot path is explicitly isolated from all analytics reads. Scans flow: Browser → API Gateway → Redis (QR cache validate + idempotency check) → PostgreSQL (INSERT ON CONFLICT DO NOTHING) → Redis (HINCRBY counters) → Redis Pub/Sub → SSE fanout → Admin dashboards. The dashboard never queries the scan table directly — it reads only from Redis counters pushed via SSE events. Background workers (image compositing, SMS sending, counter reconciliation every 10 seconds) are fully decoupled from request handlers via the asynq queue. This architecture is stateless at the API layer, enabling horizontal scaling without shared in-process state.

**Major components:**
1. **Scan Service (hot path)** — stateless handlers; all state externalized to Redis and PostgreSQL; handles 10K concurrent QR validations with lock-free idempotency via INSERT ON CONFLICT; returns scan result with guest name and reason text
2. **Admin Service** — event/guest/vendor CRUD, CSV import orchestration, config management; standard request/response with explicit Redis cache invalidation on writes
3. **SSE Fanout Service** — maintains persistent connections per dashboard client, subscribes to Redis Pub/Sub per event, fans out counter delta updates; goroutine-per-client with batching (aggregate over 500ms, do not push per-individual-scan)
4. **Image Worker (asynq)** — QR generation (yeqown/go-qrcode v2), card compositing, R2 upload; stream-processes one image at a time to prevent OOM; checkpointed per image for crash recovery
5. **SMS Worker (asynq)** — throttled bulk dispatch (configurable TPS), delivery webhook handler, exponential backoff retry with per-failure-code strategies
6. **Redis** — QR lookup cache (pre-warmed before event start), 24h idempotency result cache, HINCRBY counters (per event/stall/category in a single hash for atomic HGETALL), Pub/Sub for scan events, device session store
7. **PostgreSQL 17 + PgBouncer** — source of truth for all persistent data; `scans` table with UNIQUE idempotency_key + ON CONFLICT DO NOTHING is the race-condition-safe write primitive; `event_counters` table for durable counter backup (flushed every 10 seconds from Redis)

### Critical Pitfalls

1. **Race condition on concurrent scans of the same QR** — Use `INSERT INTO scans ... ON CONFLICT (idempotency_key) DO NOTHING` as the sole atomic write primitive. Never use SELECT-then-UPDATE. Generate client-side scan UUIDs as idempotency keys at scan time (not sync time). This must be correct from the first scan endpoint implementation — the system's credibility depends on it.

2. **Redis counter drift on crash/restart** — PostgreSQL is the source of truth, not Redis. Flush Redis counters to the `event_counters` table every 10 seconds via a background job. On Redis restart, re-seed all counters from the database before dashboards reconnect. Monitor the Redis-to-DB delta and alert on divergence greater than 5.

3. **Offline scan queue creates duplicates on sync** — Every scan event carries a client-generated UUID created at scan time. The server enforces uniqueness via a UNIQUE constraint. Use IndexedDB (not localStorage) for the offline queue — localStorage is lost on browser clear and has a 5MB limit. The server must return the original processing result for replayed idempotency keys, not a generic "duplicate" error.

4. **QR code forgery through predictable or unsigned payloads** — Sign all QR payloads with HMAC-SHA256 using a server-side secret. QR contains only an opaque random token; guest details are retrieved server-side. This format is permanent — changing it after 60K invitation cards have been sent to guests is impossible.

5. **Dashboard queries degrading scan processing** — Dashboard must never query the scan table under any circumstances. Atomic Redis counters are the only live data source for the dashboard. SSE push eliminates dashboard polling entirely. Dashboard and scan processing must use isolated database connection pools with hard query timeouts on the dashboard side.

6. **Image compositing pipeline blocking event preparation** — 60K images at 100ms each equals 100 minutes sequentially. Must use parallel asynq workers, stream-process one image at a time (never load all into RAM simultaneously), checkpoint progress per individual image, and surface a progress indicator to the admin. libvips (govips) uses 1/10th the memory of ImageMagick for equivalent operations.

7. **Configuration combinatorial explosion** — Multiple configuration axes (QR mode, food mode, food QR timing) multiply code paths exponentially. Use the strategy pattern: each supported combination is a concrete strategy struct, selected at event creation. Limit to 2-3 tested combinations for v1. Scattered conditionals checking multiple flags in the scan processing path are the warning sign this trap is occurring.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Domain Model
**Rationale:** All other phases depend on the database schema, event configuration model, and the strategy pattern for QR/food modes being locked. The idempotency key design must be committed before any scan code is written. The over-engineering trap (Pitfall 9) must be avoided by explicitly choosing the strategy pattern now — before conditionals proliferate. This is also when the infrastructure scaffolding (Docker Compose, PgBouncer, Redis, Go module, migrations) is established.
**Delivers:** Go project scaffold with chi router and middleware chain; PostgreSQL schema (all tables and indexes from ARCHITECTURE.md); PgBouncer configuration (transaction mode, pool_size=150); Redis 8 setup; Docker Compose for full local dev environment; event CRUD; guest category CRUD; vendor hierarchy CRUD (types → categories → stalls); event configuration model with strategy selection (2-3 supported mode combinations)
**Addresses:** Multi-event management, guest categories, vendor hierarchy management, event configuration
**Avoids:** Configuration complexity explosion (Pitfall 9), QR format lock-in (Pitfall 4)

### Phase 2: Guest Management and QR Generation Pipeline
**Rationale:** Guests must exist before QR codes can be generated. The QR payload format — including HMAC signature structure — must be finalized in this phase because QR images are embedded in invitation cards that will be sent to guests and cannot be recalled. The async worker infrastructure via asynq is established here and reused in Phase 5 (card compositing) and throughout.
**Delivers:** CSV bulk import with validation, deduplication on phone, and category assignment; guest search and filtering with indexed fields; QR generation pipeline (yeqown/go-qrcode v2, HMAC-SHA256 signed tokens, random 128-bit token identifiers); asynq worker infrastructure; Cloudflare R2 integration and CDN URL generation; QR image storage and serving
**Addresses:** CSV/Excel bulk guest import, guest deduplication, QR code generation pipeline, configurable QR strategy
**Avoids:** QR forgery (Pitfall 4), image pipeline blocking event preparation (Pitfall 7) — pipeline architecture is established here

### Phase 3: Scan Processing (Hot Path)
**Rationale:** This is the highest-risk phase — the race condition pitfall must be definitively solved here. The entire counter architecture (Redis HINCRBY, write-behind flush) must be built alongside the scan endpoint; adding counters later requires backfilling all historical scans. Load testing must begin in this phase with actual concurrent goroutines and Go's -race detector, not in the final hardening phase.
**Delivers:** Entry scan validation endpoint with INSERT ON CONFLICT idempotency; Redis QR lookup cache pre-warmed before event start; atomic HINCRBY counter system (per event, per stall, per food category); write-behind flush job to event_counters every 10 seconds; food scan validation — both guest-linked (per-person limits via CTE+INSERT) and anonymous modes; food rules engine; scan result responses with guest name and reason text; idempotency result cache (24h TTL); counter restart/re-seed procedure from PostgreSQL
**Addresses:** Entry scan validation (10K concurrent), food scan validation (dual mode), food rules engine, atomic counter system, duplicate scan prevention, concurrent write handling
**Avoids:** Race condition on concurrent scans (Pitfall 1), Redis counter drift (Pitfall 2), dashboard DDoS-ing database (Pitfall 5)

### Phase 4: Vendor Scanning Interface
**Rationale:** Vendor scanning depends on a working scan API (Phase 3). Device session security must be designed alongside the scanning interface — it cannot be bolted on afterward without restructuring the session model. The offline queue architecture using IndexedDB and idempotent sync relies directly on the idempotency key contract established in Phase 3.
**Delivers:** Device registration flow with admin approval from dashboard; device-based session management (HttpOnly cookies, event-scoped expiry, per-device rate limit at 5 scans/sec max); stall selection UI (persisted in device session); camera-based QR scanning (jsQR or html5-qrcode — evaluate with prototype); scan result feedback (large visual indicator, distinct audio for valid vs invalid, failure reason text including "Already entered at Gate 2 at 14:32"); offline scan queue (IndexedDB, durable across browser refresh); idempotent sync on reconnect; persistent "X scans pending" badge; no silent discard of queued scans
**Addresses:** Device-based vendor scanning, camera QR scanning, offline scan queuing, scan result feedback, no-auth device sessions
**Avoids:** Offline duplicates on sync (Pitfall 3), vendor session hijacking (Pitfall 8)

### Phase 5: Invitation Card Editor and SMS Pipeline
**Rationale:** Cards composite QR images (generated in Phase 2) onto an admin-uploaded design. SMS delivers the CDN link to the composite card. Both pipelines reuse the asynq worker infrastructure from Phase 2. SMS throttling and delivery tracking must be built into the first implementation — there is no acceptable shortcut that can be retrofitted after a failed bulk send to 60K recipients.
**Delivers:** Fabric.js canvas-based card editor with drag-drop QR placement, resize, and scan-size preview/warning; batch image compositing pipeline using parallel asynq workers (8-16 goroutines), stream-processing one image at a time, per-image checkpoint for crash resume, admin progress display ("32,400 of 60,000 generated"); R2 upload of composite cards; bulk SMS delivery via `SMSProvider` interface (swappable provider); throttled dispatch (200-500 msg/min); delivery status webhook handler; per-guest delivery status tracking (queued/sent/delivered/failed/undeliverable); retry with exponential backoff keyed to per-failure-code strategies; admin SMS delivery dashboard showing batch status and "Retry Failed" action
**Addresses:** Invitation card editor, batch image composition, bulk SMS delivery, SMS delivery status tracking
**Avoids:** Image pipeline blocking event preparation (Pitfall 7), SMS carrier rate limit blocking (Pitfall 6)

### Phase 6: Real-Time Admin Dashboard
**Rationale:** The SSE fanout service and dashboard reads are consumers of the counter system built in Phase 3. This phase deliberately comes last among feature phases because it is purely a read-side view on top of already-correct foundations and carries no risk of data corruption. Dashboard must read only from Redis counters and never query the scan table. Load testing with multiple simultaneous dashboard viewers during peak scanning confirms the isolation holds.
**Delivers:** SSE fanout service (goroutine-per-client, Redis Pub/Sub subscription per event, batched push every 500ms); React dashboard with TanStack Query SSE-driven cache invalidation; live attendance counter with percentage and trend ("412/min current rate"); food consumption by category and stall; vendor activity with alert for stalls silent for 15+ minutes; system health indicator (GREEN/YELLOW/RED) based on database latency, Redis connectivity, queue depth; isolated connection pool for any DB-touching dashboard queries with 500ms hard timeout
**Addresses:** Real-time admin dashboard, event overview with key metrics, multi-event management
**Avoids:** Dashboard DDoS-ing database (Pitfall 5)

### Phase 7: Pre-Launch Hardening
**Rationale:** Every supported configuration combination must have an end-to-end integration test before a real event runs on this system. Infrastructure defaults (PostgreSQL max_connections, Redis maxmemory-policy, reverse proxy timeouts, worker pool sizes) are designed for development convenience, not production load. The first real load test cannot be the actual event.
**Delivers:** Load test suite (k6 or vegeta) for 10K concurrent scans against staging environment mirroring production; production configuration checklist (PgBouncer pool_size=150, Redis maxmemory-policy=noeviction, proxy timeout=5s for scan endpoints, worker pool sizing to CPU cores); integration tests for every supported event configuration combination covering full entry + food + dashboard update flow; QR security test (forgery attempt by modifying one character, replay of a used entry QR); SMS batch test of 1,000+ real messages through production gateway with delivery rate verification; 60K image generation test with measured time and memory, crash-and-resume verification; health check endpoint exposed on admin dashboard; failure runbook for common event-day scenarios
**Addresses:** Untested infrastructure at scale (Pitfall 10), all "looks done but isn't" checklist items from PITFALLS.md
**Avoids:** Event-day total system failure due to untested infrastructure (Pitfall 10)

### Phase Ordering Rationale

- Phases 1-2 establish the domain model and data pipelines that all subsequent phases depend on. No scan processing can be implemented correctly without the schema, idempotency design, and QR format being finalized — these decisions are irreversible after cards are sent.
- Phase 3 (scan processing) is isolated as its own phase because it is the highest-risk, highest-concurrency code in the system. It must be built, tested under concurrent load, and validated before it is consumed by the vendor UI (Phase 4) or the dashboard (Phase 6).
- Phase 4 (vendor scanning) depends on Phase 3's scan API but is otherwise independent of Phase 5 (invitations). If team size permits, Phases 4 and 5 can be developed in parallel — Phase 4 has higher operational priority (entry scanning must work for an event to function) while Phase 5 is pre-event (invitations sent before the event starts).
- Phase 6 (dashboard) is deliberately last among feature phases — it is a read-only consumer with zero risk of data corruption and can be iterated without affecting the critical scan path.
- Phase 7 (hardening) is a non-negotiable gate before any production event. Load testing, security review, and configuration validation are first-class deliverables.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 4 (Vendor Scanning):** Offline-first architecture with IndexedDB and Service Worker background sync has mobile browser compatibility nuances (iOS Safari restrictions, background sync API availability). The exact idempotent sync protocol when two devices have overlapping offline windows warrants dedicated research before implementation.
- **Phase 5 (SMS Pipeline):** SMS.NET.BD and local Bangladesh carrier rate limits, DLT registration requirements, and delivery receipt webhook reliability are not covered in international SMS API documentation. Requires provider-specific research or direct contact before implementation.
- **Phase 5 (Image Compositing):** libvips Go bindings (govips) vs Go stdlib image package for 60K-image throughput. PITFALLS.md recommends libvips for 1/10th the memory; STACK.md uses Go stdlib. This discrepancy must be resolved with a benchmark before Phase 5 implementation.

Phases with standard, well-documented patterns (skip deep research):

- **Phase 1 (Foundation):** PostgreSQL schema design, PgBouncer transaction pooling configuration, Docker Compose setup — fully documented and high-confidence.
- **Phase 3 (Scan Processing):** INSERT ON CONFLICT idempotency, Redis HINCRBY, Go goroutine concurrency model — extensively documented with working code examples in ARCHITECTURE.md and STACK.md.
- **Phase 6 (Dashboard):** SSE fanout with Go + Redis Pub/Sub, TanStack Query with SSE invalidation — well-documented patterns with implementation examples already in ARCHITECTURE.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Multiple 2025-2026 benchmarks confirm Go over Rust for I/O-bound workloads. PgBouncer transaction pooling at 10K connections is specifically documented. Redis INCR atomicity is fundamental and official. All versions current as of April 2026. One discrepancy: libvips vs Go stdlib for image compositing needs resolution. |
| Features | HIGH | Competitive analysis is thorough across Diobox, RSVPify, CrowdPass, fielddrive, GoTab, and Tabski. The food distribution tracking differentiation claim is well-supported — no existing platform combines QR entry with per-stall food allocation. MVP scope is realistic and tightly bounded. |
| Architecture | HIGH | Patterns verified across multiple authoritative sources. The scan hot path design is a standard event-driven architecture with well-understood correctness properties. Database schema is complete, specific, and includes all indexes and constraint mechanisms. |
| Pitfalls | HIGH (core distributed systems) / MEDIUM (SMS delivery specifics) | Race conditions, idempotency, Redis durability, and image pipeline pitfalls are grounded in well-documented distributed systems failures. Bangladesh carrier-specific SMS limits are MEDIUM — require provider-level testing. |

**Overall confidence:** HIGH

### Gaps to Address

- **libvips vs Go stdlib for image compositing:** PITFALLS.md recommends libvips (govips) for 1/10th memory usage at scale; STACK.md recommends Go stdlib image package. For 60K images this matters operationally. Resolve before Phase 5 by benchmarking both approaches at 1K images as a representative proxy.
- **Bangladesh SMS carrier rate limits:** SMS.NET.BD specific throughput caps and any DLT registration requirements for Bangladesh are undocumented in standard SMS API references. Resolve by direct provider contact or test batch of 100+ messages before implementing Phase 5.
- **jsQR vs html5-qrcode for camera scanning:** Both are candidates for Phase 4 but neither was benchmarked for mobile browser performance under venue conditions (variable lighting, varying QR print sizes). Resolve with a functional prototype in Phase 4 planning.
- **Fabric.js editor scope creep:** STACK.md rates Fabric.js confidence as MEDIUM specifically because building a production-quality canvas editor is significant work. Scope Phase 5 to minimum viable: drag-drop QR placement and resize on an uploaded background. Advanced design tools are not v1 scope.
- **Food QR post-entry generation flow:** The "generate food QR after entry scan" timing option requires triggering a background job from within the hot-path scan handler and then delivering the result to the guest (via SMS or on-screen display). This async-from-hot-path flow needs explicit design attention across Phase 3 and Phase 5 to ensure it does not add synchronous latency to the entry scan response.

## Sources

### Primary (HIGH confidence)
- Go 1.23 official documentation — goroutine model, stdlib testing, slog structured logging
- PostgreSQL 17 official documentation — UPSERT, ON CONFLICT, MVCC, advisory locks
- Redis 8 official documentation — INCR atomicity, HINCRBY, Pub/Sub semantics, RDB/AOF persistence
- Cloudflare R2 official pricing page — zero egress fee verification, S3 API compatibility
- [PgBouncer for 10K Connections (2026)](https://oneuptime.com/blog/post/2026-01-26-pgbouncer-connection-pooling/view)
- [Redis Distributed Counters (2026)](https://oneuptime.com/blog/post/2026-01-27-redis-distributed-counters/view)
- [SSE vs WebSocket 2025](https://dev.to/polliog/server-sent-events-beat-websockets-for-95-of-real-time-apps-heres-why-a4l)
- [Rust vs Go 2026 Benchmarks](https://byteiota.com/rust-vs-go-2026-backend-performance-benchmarks/)
- [HMAC-based QR Authentication](https://iotready.com/blog/cryptographic-qr-codes-demo)
- [Idempotency Keys in REST APIs](https://zuplo.com/learning-center/implementing-idempotency-keys-in-rest-apis-a-complete-guide)
- [sqlc vs GORM vs sqlx (2026)](https://reintech.io/blog/sqlc-vs-gorm-vs-sqlx-go-database-libraries-compared-2026)

### Secondary (MEDIUM confidence)
- [TanStack Router vs React Router](https://betterstack.com/community/comparisons/tanstack-router-vs-react-router/) — type-safety advantage real but React Router v7 is closing the gap
- [Asynq Task Queue GitHub](https://github.com/hibiken/asynq) — still v0.x pre-1.0; API is stable in practice but not semver-guaranteed
- [yeqown/go-qrcode v2 GitHub](https://github.com/yeqown/go-qrcode) — actively maintained; 60K batch throughput not specifically benchmarked
- [Fabric.js vs Konva.js](https://dev.to/lico/react-comparison-of-js-canvas-libraries-konvajs-vs-fabricjs-1dan) — built-in transform controls verified; production editor scope is substantial
- [Hidden Problems of Offline-First Sync](https://dev.to/salazarismo/the-hidden-problems-of-offline-first-sync-idempotency-retry-storms-and-dead-letters-1no8)
- [SMS Deliverability Best Practices](https://textellent.com/sms-guides-and-troubleshooting/bulk-sms-deliverability/)
- [Write-Behind Caching with Redis (2026)](https://oneuptime.com/blog/post/2026-01-25-write-through-write-behind-caching-redis/view)

### Tertiary (LOW confidence — validate during implementation)
- SMS.NET.BD specific rate limits and Bangladesh carrier throughput caps — requires direct provider testing before Phase 5
- libvips Go bindings (govips) memory and throughput at 60K images — requires benchmark before Phase 5 to resolve discrepancy with STACK.md

---
*Research completed: 2026-04-11*
*Ready for roadmap: yes*
