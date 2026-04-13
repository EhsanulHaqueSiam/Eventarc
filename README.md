# EventArc

A multi-event management platform built for large-scale events with up to 60,000 attendees and 10,000 concurrent users. QR-based entry control, configurable food distribution tracking, real-time admin dashboards, and bulk SMS invitations with custom card designs.

![EventArc Dashboard](docs/screenshots/dashboard.png)

---

## Features

### Event Management
- **Multi-event support** — create and manage multiple events with independent configurations
- **Event lifecycle** — draft, active, live, completed, archived status tracking
- **Configurable QR strategy** — unified (single QR for entry + food) or separate QRs per event
- **Configurable food tracking** — guest-linked mode (per-person limits) or anonymous mode (volume tracking)

### Guest Management
- **Bulk import** — CSV and Excel (.xlsx) file import for guest lists up to 60K
- **Manual entry** — add individual guests with name, phone, and category assignment
- **Guest categories** — admin-configurable categories (VIP, General, Staff, etc.) with different food/access privileges
- **Full-text search** — search guests by name or phone number across events
- **Status tracking** — invited, SMS sent, SMS delivered, checked in

### QR Code Generation
- **Batch generation** — async QR code generation for entire guest lists via background workers
- **HMAC-signed payloads** — cryptographically signed QR data prevents forgery
- **CDN-hosted images** — pre-generated QR images stored in Cloudflare R2, served via CDN
- **Progress tracking** — real-time generation progress with percentage and ETA

### Invitation Card Designer
- **Visual editor** — canvas-based drag-and-drop editor built with Fabric.js
- **Template system** — upload background designs, position and resize QR overlay
- **Batch compositing** — async card generation overlaying guest-specific QR codes onto templates
- **CDN delivery** — final card images stored in R2 and served via Cloudflare CDN

### SMS Delivery
- **Bulk sending** — send SMS invitations to entire guest lists or filtered segments
- **Progress tracking** — real-time delivery status (queued, sending, sent, delivered, failed)
- **Retry logic** — automatic retries for failed deliveries with exponential backoff
- **Provider abstraction** — swappable SMS provider interface (SMS.net.bd default)

### QR Scanning and Access Control
- **Entry scanning** — QR-based guest check-in at entry gates with duplicate detection
- **Food scanning** — QR-based food distribution tracking at vendor stalls
- **Zero-credential vendor sessions** — device-based sessions, no login required for operators
- **Offline resilience** — local queue with automatic sync when connection restores
- **Idempotent processing** — duplicate scans are safely rejected without race conditions
- **Lua-scripted Redis operations** — atomic scan validation with zero race conditions at 10K concurrent

### Real-Time Dashboard
- **Live attendance** — real-time guest check-in counter via SSE (Server-Sent Events)
- **Food consumption analytics** — per-stall and per-category consumption tracking
- **Vendor activity** — active scanning stations, scan rates, last activity timestamps
- **Atomic counters** — Redis-backed counters for instant aggregates (no COUNT queries)

### Vendor Management
- **Vendor hierarchy** — vendor types (entry, food) > categories (biryani, fuchka) > stalls (stall-1, stall-2)
- **Food rules engine** — configurable per-category limits (e.g., "1 fuchka per guest regardless of stall")
- **Session management** — admin can view active sessions and revoke device access

### Authentication and Authorization
- **Email/password auth** — via Better Auth with Convex adapter
- **Role-based access** — admin (full access) and event manager (scoped to assigned events)
- **Event permissions** — granular per-event read/edit permissions for event managers
- **First-user auto-admin** — first registered user automatically becomes admin

---

## Screenshots

### Events Dashboard
![Events Dashboard](docs/screenshots/dashboard.png)

### Event Detail & Configuration
![Event Configuration](docs/screenshots/event-config.png)

### Guest Management
![Guest Management](docs/screenshots/guests.png)

### Invitation Card Designer
![Card Designer](docs/screenshots/card-designer.png)

### Scanner Interface
![Scanner Interface](docs/screenshots/scanner.png)

### Live Event Dashboard
![Live Dashboard](docs/screenshots/live-dashboard.png)

### Login
![Login](docs/screenshots/login.png)

---

## Architecture

### System Overview

```mermaid
graph TB
    subgraph Clients["Clients"]
        Admin["Admin Dashboard<br/><i>React · TanStack Router · Query</i>"]
        Scanner["Vendor Scanner<br/><i>React · Zustand · IndexedDB offline queue</i>"]
    end

    subgraph Convex["Convex — CRUD & Real-time"]
        ConvexDB[("Convex DB")]
        Auth["Better Auth<br/><i>email/password · RBAC</i>"]
        CRUD["Mutations & Queries<br/><i>events · guests · vendors<br/>stalls · food rules · categories</i>"]
        Sync["Sync Endpoints<br/><i>/internal/sync/guest-checkin<br/>/internal/sync/food-consumption<br/>/internal/sync/guest-card</i>"]
        AdminGW["Admin Gateway<br/><i>HMAC-signed calls to Go</i>"]
    end

    subgraph Go["Go Backend"]
        API["API Server — chi v5<br/><i>scan validation · SSE broker<br/>device sessions · task dispatch</i>"]
        Worker["Worker — asynq<br/><i>QR generation · card compositing<br/>SMS delivery · R2 upload</i>"]
    end

    subgraph Data["Data Layer"]
        Redis[("Redis 8<br/><i>Lua scripts · atomic counters<br/>pub/sub · scan cache · job queue</i>")]
        PG[("PostgreSQL 17<br/>via PgBouncer<br/><i>entry_scans · food_scans<br/>event_counters</i>")]
        R2[("Cloudflare R2<br/><i>QR images · card images<br/>zero-egress CDN</i>")]
        SMS["SMS Provider<br/><i>sms.net.bd</i>"]
    end

    Admin -- "Convex React subscriptions<br/>(real-time CRUD)" --> CRUD
    Admin -- "SSE<br/>(live counters)" --> API
    Scanner -- "HTTP POST<br/>(scan requests)" --> API
    Scanner -- "offline queue → sync on reconnect" --> API

    CRUD --> ConvexDB
    Auth --> ConvexDB
    AdminGW -- "HMAC POST<br/>/api/v1/qr/generate<br/>/api/v1/cards/composite<br/>/api/v1/sms/send" --> API

    API -- "Lua scripts<br/>(atomic check-in & food rules)" --> Redis
    API -- "publish counter updates" --> Redis
    API -- "asynq enqueue" --> Worker
    API -- "PG durability write" --> PG

    Worker -- "progress tracking" --> Redis
    Worker -- "upload images" --> R2
    Worker -- "send SMS" --> SMS
    Worker -- "HMAC sync<br/>(guest-checkin, food-consumption, guest-card)" --> Sync

    Sync --> ConvexDB

    style Clients fill:#e0f2fe,stroke:#0284c7
    style Convex fill:#fef3c7,stroke:#d97706
    style Go fill:#dcfce7,stroke:#16a34a
    style Data fill:#f3e8ff,stroke:#9333ea
```

### Why Hybrid?

Convex excels at real-time subscriptions and CRUD with zero-config. But QR scan processing at 10K concurrent writes needs Redis Lua scripts for atomic validation and PostgreSQL for durable storage. Each system does what it does best.

### Admin Flow — Event Setup to SMS Delivery

```mermaid
sequenceDiagram
    participant A as Admin Dashboard
    participant C as Convex
    participant G as Go API Server
    participant W as Go Worker (asynq)
    participant R as Redis
    participant S3 as Cloudflare R2
    participant SMS as SMS Provider

    Note over A,C: 1. Event & Guest Setup (Convex CRUD)
    A->>C: Create event, configure food rules
    A->>C: Import guests (CSV/Excel, up to 60K)
    A->>C: Configure guest categories & vendor stalls

    Note over A,SMS: 2. Go Live — Sync to Go Backend
    A->>C: Set event status → "live"
    C->>G: HMAC POST /api/v1/sync/event<br/>(full dataset: guests, stalls, rules, categories)
    G->>R: Bulk-load event config, guests, stalls,<br/>food rules, categories into Redis hashes

    Note over A,S3: 3. QR Generation
    A->>C: Trigger QR generation
    C->>G: HMAC POST /api/v1/qr/generate<br/>(eventId, qrStrategy, foodQrMode)
    G->>W: Enqueue TaskQRGenerateBatch
    W->>W: Fan-out: one task per guest
    W->>S3: Upload QR images to R2
    W->>C: HMAC sync guest.qrUrls
    W->>R: Update qr:progress:{eventId}
    A-->>G: Poll GET /api/v1/qr/generate/{id}/progress

    Note over A,S3: 4. Card Compositing
    A->>C: Design card template (Fabric.js editor)
    A->>C: Trigger card compositing
    C->>G: HMAC POST /api/v1/cards/composite<br/>(eventId, templateId, overlay config)
    G->>W: Enqueue card:composite:batch
    W->>W: Fan-out: overlay QR onto template per guest
    W->>S3: Upload card images to R2
    W->>C: HMAC POST /internal/sync/guest-card

    Note over A,SMS: 5. SMS Delivery
    A->>C: Trigger SMS send
    C->>G: HMAC POST /api/v1/sms/send<br/>(guest list with card URLs)
    G->>W: Enqueue sms:batch
    W->>W: Split into batches of 100, rate-limited
    W->>SMS: Send SMS with card image links
    W->>R: Update sms:{eventId}:sent/failed counters
```

### Scanner Flow — QR Scan Processing

```mermaid
sequenceDiagram
    participant S as Vendor Scanner
    participant G as Go API Server
    participant R as Redis
    participant PG as PostgreSQL
    participant C as Convex
    participant D as Admin Dashboard

    Note over S,G: 1. Session Creation (zero-credential)
    S->>G: POST /api/v1/session<br/>{stallId, eventId, vendorType}
    G->>R: HSET session:{token} → session metadata
    G-->>S: {token} → stored in localStorage

    Note over S,C: 2. Entry Scan (Lua-atomic)
    S->>G: POST /api/v1/scan/entry<br/>Authorization: Bearer {token}<br/>{qr_payload, additional_guests}
    G->>G: HMAC-verify QR payload
    G->>R: HGETALL guest:{eventId}:{guestId}
    G->>R: Execute Lua check-in script atomically:<br/>SISMEMBER checkedin:{eventId} → duplicate?<br/>SADD guestId to checkedin set<br/>HSET checkin details<br/>HINCRBY attendance counter
    alt Duplicate scan
        G-->>S: 409 Conflict (original scan details)
        G->>R: HINCRBY scans_duplicate
    else Valid scan
        G-->>S: 200 OK (guest info + scan result)
        G->>R: PUBLISH event:{eventId}:scans → counter update
        G->>PG: asynq → INSERT INTO entry_scans (durable)
        G->>C: asynq → HMAC POST /internal/sync/guest-checkin
    end

    Note over S,C: 3. Food Scan (Lua-atomic with rules)
    S->>G: POST /api/v1/scan/food<br/>{qr_payload}
    G->>R: Execute Lua food scan script atomically:<br/>HGET foodrules:{eventId} → get limit<br/>Check current count vs limit<br/>HINCRBY consumption if allowed<br/>LPUSH to foodlog (last 50)
    alt Limit reached
        G-->>S: 200 {status: "limit_reached", history}
    else Allowed
        G-->>S: 200 {status: "valid", consumption}
        G->>R: PUBLISH counter update
        G->>PG: asynq → INSERT INTO food_scans
        G->>C: asynq → HMAC POST /internal/sync/food-consumption
    end

    Note over D,R: 4. Real-time Dashboard (SSE)
    D->>G: GET /api/v1/events/{eventId}/live (SSE)
    G->>R: HGETALL counters:{eventId} → initial snapshot
    G-->>D: SSE event: "snapshot" (full counter state)
    G->>R: SUBSCRIBE event:{eventId}:scans
    loop On each scan
        R-->>G: Pub/Sub message (counter update)
        G-->>D: SSE event: "counters" (delta)
    end

    Note over S,S: 5. Offline Resilience
    S->>S: Network lost → queue scans in IndexedDB
    S->>S: Network restored → replay pending scans
    S->>G: Sequential POST for each queued scan
```

### Data Store Responsibilities

```mermaid
graph LR
    subgraph Redis["Redis 8 — Hot Path (in-memory)"]
        R1["Lua Scripts<br/><i>atomic check-in dedup<br/>food rule enforcement</i>"]
        R2a["Atomic Counters<br/><i>HINCRBY attendance, food served<br/>per-category, per-stall</i>"]
        R3["Pub/Sub<br/><i>event:{eventId}:scans<br/>→ SSE broker → dashboard</i>"]
        R4["Scan Cache<br/><i>guest profiles, check-in state<br/>food consumption, food rules</i>"]
        R5["Job Queue<br/><i>asynq: QR gen, cards,<br/>SMS, PG writes, Convex sync</i>"]
        R6["Sessions<br/><i>session:{token}<br/>device → event+stall scope</i>"]
    end

    subgraph PG["PostgreSQL 17 — Durable Storage"]
        P1["entry_scans<br/><i>idempotency_key UNIQUE<br/>event_id, guest_id, stall_id<br/>status, additional_guests</i>"]
        P2["food_scans<br/><i>idempotency_key UNIQUE<br/>food_category_id, consumption_count<br/>is_anonymous, guest_category</i>"]
        P3["event_counters<br/><i>attendance, scans_total<br/>per-category breakdowns</i>"]
        P4["PgBouncer<br/><i>150 pool size<br/>10K max client connections</i>"]
    end

    subgraph ConvexDB["Convex — Canonical Source"]
        C1["events<br/><i>config, status lifecycle<br/>draft→active→live→completed</i>"]
        C2["guests<br/><i>qrUrls, cardImageUrl<br/>status: invited→checkedIn</i>"]
        C3["vendors · stalls · categories<br/><i>hierarchy: type→category→stall</i>"]
        C4["foodRules<br/><i>per-category limits<br/>guest category × food category</i>"]
        C5["smsDeliveries · cardTemplates<br/><i>delivery tracking, template config</i>"]
    end

    style Redis fill:#fef3c7,stroke:#d97706
    style PG fill:#dcfce7,stroke:#16a34a
    style ConvexDB fill:#e0f2fe,stroke:#0284c7
```

### Consistency Model

| Path | Speed | Guarantee | How |
|------|-------|-----------|-----|
| **Scan → Redis** | Sub-ms | Atomic (Lua script) | Single Redis transaction, no race conditions |
| **Redis → PostgreSQL** | Async (~100ms) | Eventual, idempotent | asynq task with `ON CONFLICT DO NOTHING` |
| **Redis → Convex** | Async (~200ms) | Eventual, HMAC-verified | asynq task with retry (5 attempts) |
| **Convex → Redis** | On "go live" | Full sync | Bulk-load entire event dataset to Redis hashes |
| **Scanner → Go** (offline) | On reconnect | Sequential replay | IndexedDB queue, idempotency keys prevent dupes |

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19, Vite 8, TailwindCSS 4.2 | SPA with responsive scanner UI |
| **Routing** | TanStack Router | Type-safe file-based routing |
| **State** | TanStack Query, Zustand, Convex React | Server state, UI state, real-time subscriptions |
| **Canvas** | Fabric.js | Invitation card template editor |
| **Auth** | Better Auth + Convex adapter | Email/password with role-based access |
| **CRUD / Real-time** | Convex | Event/guest/vendor CRUD, live subscriptions |
| **Scan Processing** | Go 1.25, chi v5 | High-concurrency QR scan validation |
| **Database** | PostgreSQL 17 + PgBouncer | Scan data with connection pooling (10K connections) |
| **Cache / Counters** | Redis 8 | Atomic counters, pub/sub, scan caching |
| **Background Jobs** | Asynq (Redis-backed) | QR generation, card compositing, SMS delivery |
| **Object Storage** | Cloudflare R2 | QR/card images with zero-egress CDN |
| **Real-time Push** | SSE (dashboard), WebSocket (scanner) | Live event updates |
| **SMS** | SMS.net.bd (swappable) | Bulk invitation delivery |
| **Testing** | Vitest, Playwright, Go testing, testcontainers | Unit, E2E, integration |
| **Infrastructure** | Docker, Docker Compose | Containerized local dev and deployment |

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | 20+ | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| **pnpm** | 10+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| **Go** | 1.25+ | [go.dev/dl](https://go.dev/dl/) |
| **Docker** | 24+ | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| **Docker Compose** | v2+ | Included with Docker Desktop, or install separately |
| **golang-migrate** | v4 | `go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest` |
| **sqlc** | v1 | `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest` |

**Optional tools:**

| Tool | Purpose | Install |
|------|---------|---------|
| **Playwright** | E2E testing | `cd frontend && pnpm exec playwright install` |
| **k6** | Load testing | [k6.io/docs/get-started/installation](https://k6.io/docs/get-started/installation/) |

---

## Getting Started

### 1. Clone and install dependencies

```bash
git clone https://github.com/your-org/eventarc.git
cd eventarc

# Install root + Convex dependencies
pnpm install

# Install frontend dependencies
cd frontend && pnpm install && cd ..

# Install Go dependencies
cd backend && go mod download && cd ..
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. At minimum for local development:

```bash
# Generate an HMAC secret (required, minimum 32 bytes)
openssl rand -hex 32
# Paste the output as HMAC_SECRET in .env
```

See [`.env.example`](.env.example) for full documentation on every variable.

### 3. Start infrastructure services

```bash
docker compose up -d
```

This starts PostgreSQL 17, PgBouncer, and Redis 8. Wait for healthy status:

```bash
docker compose ps
# All services should show "healthy"
```

### 4. Run database migrations

```bash
migrate -path backend/migrations \
  -database "postgres://eventarc:dev_password@localhost:5432/eventarc?sslmode=disable" up
```

> **Note:** Migrations run against PostgreSQL directly (port 5432), not through PgBouncer.

### 5. Set up Convex

```bash
# First time: creates a new Convex project and deploys schema + functions
npx convex dev
```

This populates `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` in `.env.local`.

Set the required environment variables in the [Convex Dashboard](https://dashboard.convex.dev) under **Settings > Environment Variables**:

| Variable | Value |
|----------|-------|
| `GO_API_URL` | `http://localhost:8080` (or your Go backend URL) |
| `HMAC_SECRET` | Same value as in your `.env` |
| `SITE_URL` | `http://localhost:5173` |
| `NODE_ENV` | `development` |

### 6. Start the Go backend

```bash
# Terminal 1 — API server
cd backend && go run ./cmd/server

# Terminal 2 — Background worker (QR generation, card compositing, SMS)
cd backend && go run ./cmd/worker
```

### 7. Start the frontend

```bash
cd frontend && pnpm dev
```

The app is now running at **http://localhost:5173**.

### 8. Create your first account

1. Open http://localhost:5173
2. Register with email and password
3. The first registered user automatically becomes an **admin**
4. Create your first event from the dashboard

---

## Project Structure

```
eventarc/
+-- backend/                  # Go microservice
|   +-- cmd/
|   |   +-- server/           # HTTP API server entrypoint
|   |   +-- worker/           # Asynq background worker entrypoint
|   +-- internal/
|   |   +-- config/           # Environment config loading
|   |   +-- handler/          # HTTP handlers (QR, cards, SMS, sync, sessions)
|   |   +-- middleware/       # CORS, HMAC auth, rate limiting, logging
|   |   +-- scan/             # Scan processing (entry + food), Lua scripts
|   |   +-- card/             # Card compositing (QR overlay on templates)
|   |   +-- r2/               # Cloudflare R2 client (S3-compatible)
|   |   +-- sms/              # SMS delivery worker
|   |   +-- sse/              # Server-Sent Events broker
|   |   +-- convexsync/       # Go -> Convex HTTP sync client
|   |   +-- model/            # Shared types (session, scan records)
|   |   +-- worker/           # Asynq task handlers
|   +-- migrations/           # PostgreSQL migrations (golang-migrate)
+-- convex/                   # Convex backend
|   +-- schema.ts             # Database schema
|   +-- auth.ts               # Better Auth configuration
|   +-- events.ts             # Event CRUD mutations/queries
|   +-- guests.ts             # Guest management
|   +-- stalls.ts             # Vendor stall management
|   +-- foodRules.ts          # Food distribution rules
|   +-- cardTemplates.ts      # Card template CRUD
|   +-- smsDeliveries.ts      # SMS tracking
|   +-- sync.ts               # Go backend sync endpoints
|   +-- http.ts               # HTTP router (auth + internal sync)
+-- frontend/                 # React SPA
|   +-- src/
|   |   +-- routes/           # TanStack Router file-based routes
|   |   +-- components/       # React components
|   |   +-- hooks/            # Custom hooks (scanner, sessions, offline)
|   |   +-- lib/              # API client, auth, Convex setup
|   +-- e2e/                  # Playwright E2E tests
+-- docker-compose.yml        # Local dev infrastructure
+-- docker-compose.staging.yml# Production-tuned overrides
+-- .env.example              # Environment variable template
```

---

## Running Tests

### Go backend

```bash
cd backend

# Unit tests
go test ./...

# Integration tests (requires Docker — uses testcontainers)
go test -tags=integration ./...
```

### Frontend

```bash
cd frontend

# Unit tests
pnpm exec vitest

# E2E tests (requires running app + infrastructure)
pnpm test:e2e

# E2E with browser UI
pnpm test:e2e:ui
```

---

## Docker Compose Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `postgres` | `postgres:17` | 5432 | Primary database |
| `pgbouncer` | `edoburu/pgbouncer:1.25.1` | 6432 | Connection pooling (150 pool, 10K max clients) |
| `redis` | `redis:8-alpine` | 6379 | Cache, atomic counters, pub/sub, job queue |
| `worker` | Built from `backend/` | -- | Background job processor (QR, cards, SMS) |

### Staging overrides

For production-scale local testing:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

This applies tuned PostgreSQL settings (`shared_buffers`, `work_mem`), PgBouncer pool sizing, Redis memory limits, and Go runtime constraints (`GOMAXPROCS`, `GOMEMLIMIT`).

---

## Environment Variables

See [`.env.example`](.env.example) for the complete reference with inline documentation.

### Quick reference

| Variable | Required | Where | Description |
|----------|----------|-------|-------------|
| `HMAC_SECRET` | Yes | Go + Convex | Request signing key (min 32 bytes) |
| `DATABASE_URL` | Yes | Go | PostgreSQL connection via PgBouncer |
| `REDIS_URL` | Yes | Go | Redis connection |
| `PG_PASSWORD` | Yes | Docker | PostgreSQL password |
| `R2_ACCOUNT_ID` | For QR/cards | Go | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | For QR/cards | Go | R2 API access key |
| `R2_SECRET_ACCESS_KEY` | For QR/cards | Go | R2 API secret key |
| `R2_BUCKET_NAME` | For QR/cards | Go | R2 bucket name |
| `R2_PUBLIC_URL` | For QR/cards | Go | CDN base URL |
| `CONVEX_DEPLOYMENT` | Yes | Convex CLI | Deployment identifier |
| `VITE_CONVEX_URL` | Yes | Frontend | Convex API endpoint |
| `VITE_CONVEX_SITE_URL` | Yes | Frontend | Convex site URL for auth |
| `VITE_API_URL` | Yes | Frontend | Go backend URL |
| `SMS_PROVIDER_API_KEY` | For SMS | Go | SMS provider API key |
| `SITE_URL` | Yes | Convex | Frontend URL for auth redirects |
| `ALLOWED_ORIGINS` | Production | Go | CORS allowed origins |

### Convex dashboard variables

These are set in the Convex web dashboard, not in `.env`:

| Variable | Description |
|----------|-------------|
| `GO_API_URL` | Go backend URL for Convex -> Go HTTP calls |
| `HMAC_SECRET` | Shared signing secret (same as Go backend) |
| `SITE_URL` | Frontend URL for auth redirects |
| `CONVEX_SITE_URL` | Convex site URL for email verification links |
| `NODE_ENV` | `development` or `production` |

---

## Documentation

- [Infrastructure Sizing Guide](docs/SIZING-GUIDE.md) — Server configurations and cost estimates by event scale

---

## License

Private. All rights reserved.
