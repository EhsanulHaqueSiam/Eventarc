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

```
                    +------------------+
                    |    Frontend      |
                    |  React + Vite    |
                    |  TanStack Router |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
    +---------v----------+       +----------v---------+
    |      Convex        |       |    Go Backend      |
    |  CRUD / Real-time  |       |  Scan Hot Path     |
    |  Auth / Dashboard  |       |  QR / Cards / SMS  |
    +--------+-----------+       +----+-----+---------+
             |                        |     |
             |    HMAC-signed sync    |     |
             +<-----------------------+     |
                                      |     |
                              +-------v-+ +-v---------+
                              |  Redis  | | PostgreSQL |
                              | Counters| | Scan Data  |
                              | Pub/Sub | | via        |
                              | Cache   | | PgBouncer  |
                              +---------+ +------------+
                                      |
                              +-------v---------+
                              | Cloudflare R2   |
                              | QR & Card Images|
                              | (CDN delivery)  |
                              +-----------------+
```

**Why hybrid?** Convex excels at real-time subscriptions and CRUD with zero-config. But QR scan processing at 10K concurrent writes needs PostgreSQL advisory locks, Redis atomic counters, and Lua scripts for race-condition-free operation. Each system does what it does best.

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
