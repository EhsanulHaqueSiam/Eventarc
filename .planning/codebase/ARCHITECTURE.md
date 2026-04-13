# Architecture

**Analysis Date:** 2026-04-12

## Pattern Overview

**Overall:** Hybrid dual-backend architecture -- Convex handles CRUD/real-time subscriptions, Go handles the scan hot path and background processing.

**Key Characteristics:**
- Two separate backends with distinct responsibilities, connected via HMAC-signed HTTP sync
- Redis-first scan processing with atomic Lua scripts for zero-race-condition guarantees
- Three-tier durability: Redis (instant) -> PostgreSQL (background job) -> Convex (background job)
- Offline-first scanner UI with IndexedDB queuing and automatic reconnection sync
- SSE for real-time dashboard updates, Convex subscriptions for admin CRUD real-time

## High-Level Architecture

```
                        +---------------------------+
                        |      Frontend (React)     |
                        |   TanStack Router + Vite  |
                        +------+--------+-----------+
                               |        |
              Convex React     |        |  HTTP (scan/session/SSE)
              subscriptions    |        |
                               v        v
              +----------------+    +---+------------------+
              |    Convex      |    |   Go API Server      |
              | (CRUD/Auth/    |    |   (chi router)       |
              |  Real-time)    |    |   Port 8080          |
              +-------+--------+    +---+------+-----------+
                      |                 |      |
      HMAC sync       |   +-------------+      |  Redis Pub/Sub
      (HTTP POST)     |   |                    |
                      v   v                    v
              +-------+---+--+    +------------+----------+
              | Convex HTTP  |    |        Redis 8        |
              | Actions      |    |  (cache + counters +  |
              | /internal/*  |    |   Lua scripts +       |
              +--------------+    |   Pub/Sub + queues)   |
                                  +----------+------------+
                                             |
                                  +----------+------------+
                                  |   asynq Worker        |
                                  |  (QR gen, cards,      |
                                  |   SMS, PG writes,     |
                                  |   Convex sync)        |
                                  +----------+------------+
                                             |
                              +--------------+--------------+
                              |                             |
                    +---------+--------+        +-----------+---------+
                    | PostgreSQL 17    |        | Cloudflare R2       |
                    | (via PgBouncer)  |        | (QR images, cards)  |
                    +------------------+        +---------------------+
```

## Layers

**Frontend (React SPA):**
- Purpose: Admin dashboard, guest management, scanner UI, card editor
- Location: `frontend/src/`
- Contains: Routes, components, hooks, stores, utility libraries
- Depends on: Convex (subscriptions + mutations), Go API (scan endpoints, SSE, sessions)
- Used by: Admin users and vendor scanner operators

**Convex Backend (CRUD + Auth + Real-time):**
- Purpose: All non-scan CRUD operations, authentication, real-time subscriptions for admin UI
- Location: `convex/`
- Contains: Schema, queries, mutations, actions, auth config, model helpers
- Depends on: Go API (via HMAC-signed HTTP for triggering QR gen, card compositing, SMS)
- Used by: Frontend via Convex React client; Go backend via HTTP actions (bridge mutations)

**Go API Server (Scan Hot Path):**
- Purpose: QR scan validation, session management, SSE dashboard streaming, data sync endpoints
- Location: `backend/cmd/server/main.go`
- Contains: HTTP handlers, scan service, SSE broker, middleware
- Depends on: Redis (atomic operations), PostgreSQL (durability), Convex (bridge mutations)
- Used by: Frontend scanner UI, Convex actions (admin gateway)

**Go Worker (Background Processing):**
- Purpose: QR image generation, card compositing, SMS delivery, durable PG writes, Convex sync
- Location: `backend/cmd/worker/main.go`
- Contains: asynq task handlers for all background job types
- Depends on: Redis (asynq queue), PostgreSQL, R2 storage, Convex HTTP API, SMS provider
- Used by: Triggered by asynq task enqueue from the API server or Convex actions

**Redis (Hot State):**
- Purpose: Atomic scan counters, guest cache, session tokens, food consumption tracking, real-time Pub/Sub
- Contains: Guest hashes, event config, check-in sets, counter hashes, food consumption counts
- Used by: Go API server (scan processing), Go worker (progress tracking), SSE handler

**PostgreSQL (Durable State):**
- Purpose: Permanent audit trail for entry scans and food scans
- Location: `backend/migrations/`
- Contains: `entry_scans`, `food_scans`, `event_counters` tables
- Used by: Go worker (background writes), Go API server (PG fallback lookups)

**Cloudflare R2 (Object Storage):**
- Purpose: QR code images, invitation card composites
- Used by: Go worker (upload), Frontend/SMS (CDN delivery)

## Data Flow

**Event Setup Flow (Admin):**

1. Admin creates event via Convex mutation (`convex/events.ts` -> `create`)
2. Admin configures categories, vendors, stalls, food rules via Convex mutations
3. Admin imports guests via bulk import wizard (CSV/XLSX -> Convex mutation `convex/guests.ts`)
4. When event transitions to "active", Convex action `convex/sync.ts` -> `pushEventToGo` syncs full dataset to Go API via `POST /api/v1/sync/event`
5. Go API stores event config, guest profiles, stall metadata in Redis hashes

**QR Generation Flow:**

1. Admin triggers QR generation from frontend (Convex action `convex/adminGateway.ts` -> signed request to Go)
2. Go API handler (`backend/internal/handler/qr.go`) enqueues batch task via asynq
3. Worker (`backend/internal/worker/qr_handler.go`) generates QR images per guest, uploads to R2
4. Worker updates progress in Redis; frontend polls Convex action for progress

**Card Compositing Flow:**

1. Admin designs card template in Fabric.js editor (`frontend/src/components/cards/card-editor.tsx`)
2. Admin triggers compositing via Convex action -> Go API (`POST /api/v1/events/{eventId}/cards/composite`)
3. Go worker (`backend/internal/handler/cards_worker.go`) overlays QR onto card background, uploads to R2
4. Worker syncs card URL back to Convex via HMAC-signed POST to `convex/http.ts` -> `/internal/sync/guest-card`

**SMS Delivery Flow:**

1. Admin triggers SMS send via Convex action (`convex/adminGateway.ts` -> `triggerSmsSend`)
2. Go API enqueues SMS batch task; worker (`backend/internal/sms/worker.go`) sends via SMS.NET.BD
3. Worker polls delivery status, updates progress in Redis
4. SMS delivery records synced to Convex `smsDeliveries` table

**Entry Scan Flow (Hot Path):**

1. Scanner device POSTs to `POST /api/v1/scan/entry` with QR payload + session token
2. Go handler (`backend/internal/scan/handler.go`) validates session token from Redis
3. Service (`backend/internal/scan/service.go` -> `ProcessEntryScan`) decodes QR HMAC payload
4. Redis Lua script (`backend/internal/scan/lua.go`) atomically: checks SISMEMBER, marks guest checked in (SADD), increments counters (HINCRBY)
5. Durable persistence (`backend/internal/scan/durability.go`): enqueues asynq tasks for PG write + Convex sync
6. Counter update published to Redis Pub/Sub channel `event:{eventId}:scans`
7. SSE handler (`backend/internal/sse/handler.go`) receives Pub/Sub message, streams to connected dashboard clients

**Food Scan Flow (Hot Path):**

1. Scanner device POSTs to `POST /api/v1/scan/food` with QR payload + session token + food_category_id
2. Go service (`backend/internal/scan/food_service.go` -> `ProcessFoodScan`) resolves food mode (guest-linked vs anonymous)
3. Redis Lua script (`backend/internal/scan/food_lua.go`) atomically: checks consumption count against limit, increments if allowed
4. On limit_reached: returns rejection with consumption history from Redis log
5. Durable persistence: enqueues asynq tasks for PG write + Convex sync (same pattern as entry scan)

**Real-Time Dashboard Flow:**

1. Admin opens Live tab on event detail page
2. Frontend `useSSE` hook (`frontend/src/hooks/use-sse.ts`) connects to `GET /api/v1/events/{eventId}/live`
3. SSE handler (`backend/internal/sse/handler.go`) builds initial snapshot from Redis counters, sends as `snapshot` event
4. Handler subscribes to Redis Pub/Sub channel `event:{eventId}:scans`
5. Incoming scan events are parsed and forwarded as SSE `counters` events
6. Heartbeat sent every 15 seconds to keep connection alive through proxies

**State Management:**
- Server state (events, guests, categories): Convex subscriptions via `useQuery` hooks
- Scanner UI state (network status, pending count, rejections): Zustand store (`frontend/src/stores/scanner-store.ts`)
- Scanner scan flow state (idle/reviewing/confirming/flash/ready): Zustand store (`frontend/src/hooks/use-scanner.ts`)
- Offline scan queue: IndexedDB via `idb` library (`frontend/src/lib/offline-queue.ts`)
- Dashboard real-time counters: SSE events via `useSSE` hook

## Key Abstractions

**Scan Service (`scan.Service`):**
- Purpose: Core scan processing engine -- entry and food scans
- Files: `backend/internal/scan/service.go`, `backend/internal/scan/food_service.go`
- Pattern: Redis-first with atomic Lua scripts, background durability writes, fallback direct writes

**SSE Broker:**
- Purpose: Manages per-event SSE client connections and broadcasting
- Files: `backend/internal/sse/broker.go`, `backend/internal/sse/handler.go`
- Pattern: In-memory subscriber map with channel-based pub/sub; slow clients are dropped (non-blocking send)

**Convex Sync Client:**
- Purpose: HMAC-signed HTTP bridge from Go back to Convex for data sync
- Files: `backend/internal/convexsync/client.go`
- Pattern: Signed POST requests to Convex HTTP actions with timestamp-based replay protection

**Offline Queue:**
- Purpose: Client-side scan persistence when network is unavailable
- Files: `frontend/src/lib/offline-queue.ts`, `frontend/src/hooks/use-offline-sync.ts`
- Pattern: IndexedDB store with idempotency keys; syncs sequentially on reconnection

**Admin Gateway:**
- Purpose: Convex actions that proxy admin requests to Go API with HMAC authentication
- Files: `convex/adminGateway.ts`
- Pattern: Convex action verifies user auth, constructs signed request, forwards to Go

**Internal Gateway:**
- Purpose: Convex HTTP actions that receive signed callbacks from Go backend
- Files: `convex/internalGateway.ts`, `convex/http.ts`
- Pattern: HMAC verification of incoming Go requests, delegates to internal mutations

## Entry Points

**Frontend App:**
- Location: `frontend/src/main.tsx`
- Triggers: Browser navigation
- Responsibilities: Renders React app with Convex provider, Better Auth provider, TanStack Router

**Go API Server:**
- Location: `backend/cmd/server/main.go`
- Triggers: HTTP requests from frontend and Convex
- Responsibilities: Scan processing, session management, SSE streaming, data sync

**Go Worker:**
- Location: `backend/cmd/worker/main.go`
- Triggers: asynq task dequeue from Redis
- Responsibilities: QR generation, card compositing, SMS delivery, PG writes, Convex sync

**Convex HTTP Router:**
- Location: `convex/http.ts`
- Triggers: HTTP requests from Go backend
- Responsibilities: Auth routes (Better Auth), internal sync endpoints (guest-card, guest-checkin, food-consumption)

## API Endpoints (Go Server)

**Public:**
- `GET /api/v1/health` - Health check (Redis + PG connectivity)
- `POST /api/v1/session` - Create device session (scanner)
- `GET /api/v1/session` - Validate device session token
- `POST /api/v1/scan/entry` - Process entry scan (session token required)
- `POST /api/v1/scan/food` - Process food scan (session token required)
- `GET /api/v1/events/{eventId}/live` - SSE dashboard stream

**HMAC-Protected (admin/Convex -> Go):**
- `DELETE /api/v1/admin/session/{token}` - Revoke device session
- `POST /api/v1/sync/event` - Full event dataset sync (Convex -> Redis)
- `POST /api/v1/sync/food-rules` - Food rules sync (Convex -> Redis)
- `POST /api/v1/qr/generate` - Trigger QR batch generation
- `GET /api/v1/qr/progress/{eventId}` - QR generation progress
- `POST /api/v1/events/{eventId}/cards/composite` - Trigger card compositing
- `GET /api/v1/events/{eventId}/cards/progress` - Card compositing progress
- `POST /api/v1/events/{eventId}/sms/send` - Trigger SMS batch send
- `GET /api/v1/events/{eventId}/sms/progress` - SMS delivery progress

**Convex HTTP Endpoints (Go -> Convex):**
- `POST /internal/sync/guest-card` - Sync card image URL to guest record
- `POST /internal/sync/guest-checkin` - Mark guest as checked in
- `POST /internal/sync/food-consumption` - Record food consumption

## Error Handling

**Strategy:** Layered error handling with structured JSON responses and graceful degradation

**Go API Patterns:**
- Sentinel errors (`model.ErrNotFound`, `qr.ErrInvalidSignature`, etc.) mapped to HTTP status codes in `backend/internal/scan/handler.go`
- Structured error JSON: `{"error": {"code": "ERROR_CODE", "message": "Human description"}}`
- Status codes: 400 (bad request), 401 (auth), 403 (scope mismatch), 404 (not found), 422 (wrong QR type), 500 (internal)

**Durability Patterns:**
- asynq task enqueue failure -> fallback to direct PG write / direct Convex HTTP call (`backend/internal/scan/durability.go`)
- Redis guest cache miss -> PG fallback lookup for existing check-ins (`backend/internal/scan/service.go`)
- Startup recovery: Redis counter reseed from PG on server restart (`backend/internal/scan/recovery.go`, `backend/internal/scan/reseed.go`)

**Frontend Patterns:**
- Network failure during scan -> queue to IndexedDB, show "network_error" outcome
- SSE disconnection -> auto-reconnect (native EventSource), status transitions: connecting -> connected -> reconnecting -> disconnected
- Session revocation -> clear localStorage, show revoked state

**Convex Patterns:**
- Sync actions retry 3 times with exponential backoff (1s, 2s, 4s) in `convex/sync.ts`
- Authentication errors caught and returned as null (not thrown) in `convex/auth.ts` -> `getCurrentUser`

## Cross-Cutting Concerns

**Authentication:**
- Admin auth: Better Auth via Convex (email/password, session cookies)
- Scanner auth: Device session tokens stored in Redis, created via `POST /api/v1/session`, validated per-scan
- Go-to-Convex auth: HMAC-SHA256 signatures with timestamp-based replay protection (5-minute drift window)
- Convex-to-Go auth: Same HMAC-SHA256 signature scheme via `middleware.HMACAuth`

**Authorization:**
- Role-based: `admin` (full access) and `eventManager` (per-event permissions) roles in `convex/authz.ts`
- Per-event permissions: `eventPermissions` table with `canEdit` flag
- First registered user automatically gets `admin` role
- Scanner sessions scoped to specific event + stall; scope validation on every scan

**Logging:**
- Go: `slog` (stdlib) with JSON format in production, text format in development
- Convex: `console.log`/`console.error` with `[SYNC]` prefix for sync operations
- Frontend: `console.error` for failures, `console.warn` for non-critical issues

**Validation:**
- QR payloads: HMAC-SHA256 signature verification in `backend/internal/qr/payload.go`
- Request bodies: Manual field validation in Go handlers
- Convex args: `v.string()`, `v.id()`, `v.union()` validators in all function definitions
- Phone numbers: Normalized to `01XXXXXXXXX` format in `convex/model/phone.ts`

**Idempotency:**
- Entry scans: Redis SISMEMBER check prevents duplicate attendance counting (Lua script)
- Food scans: Idempotency key per scan, `UNIQUE` constraint on `idempotency_key` in PG
- Offline sync: UUID idempotency keys generated client-side, server handles duplicate submission gracefully

**Concurrency Control:**
- Redis Lua scripts for atomic multi-key operations (check + set + increment in single evaluation)
- PgBouncer transaction pooling (150 pool size, 10K max client connections)
- Redis `noeviction` memory policy ensures counters are never silently dropped

---

*Architecture analysis: 2026-04-12*
