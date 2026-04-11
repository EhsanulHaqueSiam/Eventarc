# EventArc

## What This Is

A multi-event management platform for large-scale events (up to 60K attendees, 10K concurrent). Admins create events, bulk-import guests, send SMS invitations with QR-coded invitation cards, and manage real-time entry and food distribution through vendor scanning stations. The system handles QR-based access control, configurable food tracking (guest-linked or anonymous), and a real-time admin dashboard — all built for high concurrency with zero race conditions.

## Core Value

QR-based event operations (entry + food) must be accurate at scale — no false positives, no false negatives, no race conditions, even with 10K concurrent scans. Data integrity is non-negotiable.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Multi-event platform — admins create and manage multiple events over time
- [ ] Guest management with CSV/Excel bulk import and manual entry
- [ ] Admin-configurable guest categories with different food/access privileges per event
- [ ] SMS invitation delivery via bulk SMS API (BulkSMS.net or equivalent)
- [ ] Visual invitation card editor — admin uploads design, drag-drop QR placement, resize, preview
- [ ] Pre-generated QR images stored in cloud storage (S3/R2), served via CDN
- [ ] Configurable QR strategy per event — single unified QR (entry + food) or separate QRs
- [ ] Entry QR always mapped to guest — tracks attendance
- [ ] Food QR mode configurable per event: guest-linked (per-person limits, tracks who ate what) or anonymous (volume tracking, consumption analytics)
- [ ] Admin-configurable food rules — e.g., "one fuchka per guest regardless of stall"
- [ ] Vendor hierarchy: vendor types (entry, food) → categories (fuchka, biryani) → stalls (fuchka-1, fuchka-2)
- [ ] Vendor scanning stations — no credentials, device-based session, operator picks stall from dropdown
- [ ] Food QR timing configurable per event — pre-sent with invitation or generated after entry scan
- [ ] Real-time admin dashboard: live attendance count, food consumption by stall, vendor activity, alerts
- [ ] Atomic counter system for real-time aggregates — no COUNT(*) queries
- [ ] Queue-and-sync for network blips at venue — scanner queues locally, syncs when connection restores
- [ ] Concurrent write handling — 10K simultaneous QR scans with no race conditions
- [ ] CDN → Redis cache → database layered architecture

### Out of Scope

- Payment processing at stalls — food is free/included, QR tracks consumption only
- Mobile native app — web-based responsive UI for v1
- Multi-admin roles (super admin, event manager, etc.) — single admin per event for v1
- Guest self-registration — admin imports all guests
- Video/livestream integration — not an event broadcasting platform

## Context

**Scale target:** 60,000 total attendees per event, 10,000 concurrent active users during peak. This drives every architectural decision — the system must handle burst writes (QR scans) without degradation.

**Vendor reality:** Event vendors are temporary staff for 1-4 day events. They won't remember credentials. The scanning interface must be dead simple — open a link, pick your stall, scan. Device-based sessions with no login friction.

**QR data model:**
- Entry QR: always 1:1 with a guest. Source of truth for attendance.
- Food QR: configurable. In guest-linked mode, enforces per-person consumption limits and tracks individual behavior. In anonymous mode, acts as a valid consumption token — tracks volume and stall analytics without tying to a person.
- Both modes produce analytics: which stalls are busiest, consumption rates, timing patterns.

**Invitation card flow:** Admin uploads a custom card design image → uses a visual editor to position/resize the QR code overlay → system pre-generates all guest QR images → composites QR onto card → stores final card images in cloud storage → includes download link in SMS.

**Real-time requirements:** Admin dashboard must reflect scan events within seconds. Atomic counters increment on each scan — dashboard reads counters, not aggregates. WebSocket or SSE for push updates.

**Offline resilience:** Brief network drops at the venue are expected. Scanning devices must queue scans locally and sync when connectivity returns. Must prevent duplicate processing on sync (idempotent scan operations).

## Constraints

- **Tech stack (scan hot path)**: Go microservice + PostgreSQL 17 + PgBouncer + Redis 8 — handles QR scan validation, background jobs (QR generation, card compositing, SMS)
- **Tech stack (CRUD/real-time)**: Convex Pro — handles event/guest/vendor CRUD, admin dashboard real-time subscriptions, food rules config
- **Tech stack (frontend)**: React + TailwindCSS + Vite, pnpm as package manager, TanStack Router/Query, Convex React client
- **Concurrency**: Must handle 10K concurrent writes without race conditions
- **Data integrity**: Zero tolerance for false positives (unauthorized entry/food) and false negatives (valid QR rejected)
- **Architecture**: Hybrid — Convex for CRUD/real-time, Go+PostgreSQL+Redis for scan hot path and background processing
- **QR storage**: Pre-generated images in Cloudflare R2, served via CDN
- **Real-time**: Convex subscriptions for dashboard, Go→Convex bridge mutation after each scan

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid: Convex + Go microservice | Convex excels at real-time/CRUD, Go+PG excels at high-write hot path. Evaluated Convex-only (OCC bottleneck at 10K writes), Supabase ($1600/mo, architecture mismatch), NeonDB (30% write penalty). Hybrid gets best of both. | ✓ Good |
| Go for scan hot path (not Rust) | I/O-bound workload — Rust's 1.5x throughput advantage irrelevant when DB is the bottleneck. Go has 2-3x faster dev velocity. | ✓ Good |
| PostgreSQL + PgBouncer for scan DB | Handles 10K concurrent INSERT ON CONFLICT natively. CockroachDB/TiDB add distributed consensus latency without benefit for single-region events. | ✓ Good |
| Redis for atomic counters + pub/sub | INCR is lock-free, millions ops/sec. Pub/Sub bridges scan events from Go to Convex real-time layer. | ✓ Good |
| Cloudflare R2 for image storage | Zero egress fees for serving 60K QR/card images via CDN. S3-compatible API. | ✓ Good |
| Convex Pro for CRUD + real-time | Built-in real-time subscriptions for admin dashboard. Handles event/guest/vendor CRUD. Pro tier: 10K sessions, 256 concurrent queries. | ✓ Good |
| Device-based vendor sessions | Event staff won't remember credentials for 1-4 day events | ✓ Good |
| Admin-configurable QR modes | Different events have different needs — flexibility is core | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-11 after initialization*
