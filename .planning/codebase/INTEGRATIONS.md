# External Integrations

**Analysis Date:** 2026-04-12

## Architecture Overview

EventArc uses a hybrid architecture where two backends cooperate:
- **Convex** handles CRUD, real-time subscriptions, auth, and admin dashboard
- **Go backend** handles the scan hot path (entry + food QR scanning), background jobs (QR generation, card compositing, SMS delivery), and real-time event broadcasting

Communication between them is bidirectional via HMAC-signed HTTP requests.

## Convex (Backend-as-a-Service)

**Purpose:** CRUD operations, real-time data subscriptions, authentication, admin dashboard data

**Client SDK:**
- Frontend: `convex` ^1.35.1 via `ConvexReactClient` (`frontend/src/lib/convex.ts`)
- Provider: `ConvexBetterAuthProvider` wraps app in `frontend/src/main.tsx`

**Schema:** `convex/schema.ts` - 12 tables:
- `appUsers` - Application user profiles (admin, eventManager roles)
- `eventPermissions` - Per-event user access control
- `events` - Event definitions with QR strategy config
- `guestCategories` - Guest categorization per event
- `vendorTypes` - Vendor type definitions (entry, food)
- `vendorCategories` - Vendor category definitions per type
- `stalls` - Physical scanning stations
- `guests` - Guest records with QR URLs and card image URLs
- `foodRules` - Per-category food consumption limits
- `foodScans` - Food scan audit trail (synced from Go)
- `smsDeliveries` - SMS delivery tracking
- `deviceSessions` - Scanner device session management
- `cardTemplates` - Invitation card template definitions with QR overlay positioning

**Convex Functions:**
- `convex/events.ts` - Event CRUD (queries + mutations)
- `convex/guests.ts` - Guest management, bulk operations, search
- `convex/auth.ts` - Authentication, user profile management
- `convex/authz.ts` - Authorization helpers (role resolution, admin checks)
- `convex/foodRules.ts` - Food rule configuration
- `convex/stalls.ts` - Stall management
- `convex/vendors.ts` - Vendor CRUD
- `convex/vendorTypes.ts`, `convex/vendorCategories.ts` - Vendor type/category management
- `convex/categories.ts` - Guest category management
- `convex/qr.ts` - QR generation triggers and progress tracking
- `convex/cardTemplates.ts` - Card template CRUD
- `convex/smsDeliveries.ts` - SMS delivery status tracking
- `convex/deviceSessions.ts` - Device session management
- `convex/seed.ts` - Development seed data

**Convex Config:**
- `convex/convex.config.ts` - App definition with Better Auth component
- `convex/auth.config.ts` - Auth provider config using `@convex-dev/better-auth`

**Convex HTTP Routes (`convex/http.ts`):**
- Auth routes (registered by Better Auth component)
- `POST /internal/sync/guest-card` - Go -> Convex card image sync
- `POST /internal/sync/guest-checkin` - Go -> Convex check-in sync
- `POST /internal/sync/food-consumption` - Go -> Convex food scan sync

**Convex Environment Variables (set in Convex dashboard):**
- `HMAC_SECRET` - Shared HMAC secret for Go<->Convex communication
- `SITE_URL` - Frontend origin for auth CORS
- `GO_API_URL` or `GO_BACKEND_URL` - Go backend URL for gateway calls

## Go Backend API

**Purpose:** Scan processing hot path, background job processing, real-time SSE

**Server:** `backend/cmd/server/main.go` - chi router on port 8080

### API Endpoints

**Public:**
- `GET /api/v1/health` - Health check (Redis + PostgreSQL connectivity)

**Scanner Session (no auth):**
- `POST /api/v1/session` - Create scanner device session
- `GET /api/v1/session` - Validate session token

**Admin Session (HMAC-protected):**
- `DELETE /api/v1/admin/session/{token}` - Revoke device session

**Scan Processing (session token + QR payload HMAC):**
- `POST /api/v1/scan/entry` - Process entry QR scan
- `POST /api/v1/scan/food` - Process food QR scan

**Data Sync (HMAC-protected, Convex -> Go):**
- `POST /api/v1/sync/event` - Full event dataset sync (guests, categories, stalls, config)
- `POST /api/v1/sync/food-rules` - Food rules sync

**QR Generation (HMAC-protected):**
- `POST /api/v1/qr/generate` - Trigger batch QR generation
- `GET /api/v1/qr/progress/{eventId}` - Poll QR generation progress

**Card Compositing (HMAC-protected):**
- `POST /api/v1/events/{eventId}/cards/composite` - Trigger card compositing
- `GET /api/v1/events/{eventId}/cards/progress` - Poll compositing progress

**SMS Delivery (HMAC-protected):**
- `POST /api/v1/events/{eventId}/sms/send` - Trigger SMS batch send
- `GET /api/v1/events/{eventId}/sms/progress` - Poll SMS progress

**SSE (real-time dashboard):**
- `GET /api/v1/events/{eventId}/live` - Server-Sent Events stream for live dashboard counters

### Authentication Patterns

**HMAC-SHA256 Signing (Go <-> Convex):**
- Headers: `X-Signature` (hex-encoded HMAC), `X-Timestamp` (RFC3339)
- Payload: `HMAC-SHA256(secret, timestamp + body)`
- Timestamp drift tolerance: 5 minutes
- Implementation: `backend/internal/middleware/hmac.go`, `convex/internalGateway.ts`

**Scanner Session Tokens:**
- Opaque tokens stored in Redis, validated per-request
- No HMAC required (vendors have no credentials)
- Session enforcement: `backend/internal/scan/session_enforcement.go`

## Convex Admin Gateway (Convex -> Go)

**Purpose:** Authenticated Convex actions that proxy requests to Go backend for admin operations

**Implementation:** `convex/adminGateway.ts`

**Actions:**
- `triggerCardCompositing` - Forwards card composite request to `POST /api/v1/events/{eventId}/cards/composite`
- `getCardCompositingProgress` - Polls `GET /api/v1/events/{eventId}/cards/progress`
- `triggerSmsSend` - Forwards SMS send request to `POST /api/v1/events/{eventId}/sms/send`
- `getSmsProgress` - Polls `GET /api/v1/events/{eventId}/sms/progress`

**Auth:** Each action calls `ensureEventAccess()` to verify Convex user identity + event permissions before proxying to Go.

## Convex Data Sync (Convex -> Go)

**Purpose:** Push event configuration data from Convex (source of truth) to Go Redis cache

**Implementation:** `convex/sync.ts`

**Internal Actions:**
- `pushEventToGo` - Syncs full event dataset (event config, guest categories, food categories, stalls, guests, counters) to `POST /api/v1/sync/event`
- `syncFoodRules` - Syncs food consumption rules to `POST /api/v1/sync/food-rules`

**Retry logic:** 3 attempts with exponential backoff (1s, 2s, 4s)

**Data flow:**
1. Admin creates/modifies event in Convex UI
2. Convex mutation triggers `pushEventToGo` internal action
3. Go backend receives signed payload, populates Redis hashes for scan lookup
4. Redis keys: `guest:{eventId}:{guestId}` (HASH), `foodrules:{eventId}` (HASH)

## Go -> Convex Sync (Internal Gateway)

**Purpose:** Write scan results back to Convex for dashboard display and audit trail

**Implementation:** `backend/internal/convexsync/client.go`

**Sync Operations:**
- `SyncGuestCheckIn` -> `POST /internal/sync/guest-checkin` -> `convex/guests.internalMarkCheckedIn`
- `SyncGuestCard` -> `POST /internal/sync/guest-card` -> `convex/guests.internalSetCardImage`
- `SyncFoodConsumption` -> `POST /internal/sync/food-consumption` -> `convex/guests.internalRecordFoodConsumption`

**Auth:** HMAC-SHA256 signed requests (same shared secret as Go backend)

**Verification:** `convex/internalGateway.ts` verifies HMAC signature and timestamp before executing mutations

## Redis Usage

**Purpose:** Atomic scan counters, real-time pub/sub, guest data cache, session storage, job queue

**Connection:** `redis://localhost:6379` (dev), `redis://redis:6379` (Docker)
**Client:** `github.com/redis/go-redis/v9` v9.18.0
**Version:** Redis 8 Alpine (Docker image `redis:8-alpine`)

### Data Structures

**Guest Lookup Cache (HASH):**
- Key: `guest:{eventId}:{guestId}`
- Fields: `name`, `category`, `photoUrl`
- Source: Populated by `POST /api/v1/sync/event` from Convex

**Check-In Set (SET):**
- Key: `checkedin:{eventId}`
- Members: guest IDs that have checked in
- Used by Lua script for duplicate detection

**Check-In Details (HASH):**
- Key: `checkin:{eventId}:{guestId}`
- Fields: `timestamp`, `stallId`, `deviceId`, `status`

**Event Counters (HASH):**
- Key: `counters:{eventId}`
- Fields: `attendance`, `scans_total`, `scans_reentry`, `scans_duplicate`, `{category}:checkedin`, `food:{categoryId}:served`, `stall:{stallId}:served`

**Food Consumption (HASH):**
- Key: `food:{eventId}:{guestOrTokenId}`
- Fields: `{foodCategoryId}` -> count

**Food Rules Cache (HASH):**
- Key: `foodrules:{eventId}`
- Fields: `{guestCategoryId}:{foodCategoryId}` -> limit (-1 unlimited, 0+ specific)

**Food Consumption Log (LIST):**
- Key: `foodlog:{eventId}:{guestOrTokenId}`
- Entries: `{timestamp}|{stallId}|{stallName}` (last 50 entries)

### Lua Scripts (Atomic Operations)

**Entry Check-In Script** (`backend/internal/scan/lua.go`):
- Atomic SISMEMBER + SADD + HSET + HINCRBY
- Handles first-time check-in and re-entry differently
- Increments per-category counters

**Food Scan Script** (`backend/internal/scan/food_lua.go`):
- Atomic rule lookup + consumption check + increment
- Returns `OK`, `LIMIT_REACHED`, or `NO_RULE`
- Updates dashboard counters atomically

### Pub/Sub

**Channel:** `event:{eventId}:scans`
- Published by scan service after every scan (`backend/internal/scan/realtime.go`)
- Consumed by SSE handler (`backend/internal/sse/`) and pushed to connected admin dashboards
- Payload: JSON `{type: "scan", timestamp, counters: {key: value}}`

### Task Queue (via Asynq)

Redis is the backing store for the Asynq task queue. Worker queues defined in `backend/cmd/worker/main.go`:
- `critical` (priority 6) - Scan processing tasks
- `pg-writes` (priority 4) - PostgreSQL write-behind tasks
- `convex-sync` (priority 2) - Convex sync tasks
- `default` (priority 3) - QR generation, card compositing, SMS
- `low` (priority 1) - Low-priority background tasks

## PostgreSQL

**Purpose:** Durable storage for scan records, event counters (write-behind from Redis)

**Connection:** Via PgBouncer on port 6432 (transaction pooling mode)
**Driver:** `github.com/jackc/pgx/v5` v5.9.1 with `pgxpool`
**Code Gen:** sqlc v2 (`backend/sqlc.yaml`) -> `backend/internal/db/`
**Version:** PostgreSQL 17 (Docker image `postgres:17`)

### Tables (`backend/migrations/`)

**`entry_scans`** (migration 000001 + 000002):
- UUID primary key, idempotency_key (unique), event_id, guest_id, stall_id, scanned_at, device_id, status, guest_category
- Indexes: by_event, by_guest (unique compound), reconcile (event+status+category), guest_lookup

**`event_counters`** (migration 000001):
- Composite PK (event_id, counter_key), value (BIGINT), updated_at
- Used for counter reconciliation when Redis restarts

**`food_scans`** (migration 000003):
- UUID primary key, idempotency_key (unique), event_id, guest_id, food_category_id, stall_id, scanned_at, device_id, guest_category, is_anonymous, consumption_count, status
- Indexes: by_event, reconcile (event+guest+food_category+status), by_stall, history (descending time)

### Queries (`backend/queries/`)

**`scans.sql`:** InsertEntryScan, GetEntryScanByGuest, CountEntryScansByEvent, CountEntryScansByCategory, UpsertEventCounter, GetCheckedInGuestIDs

**`food_scans.sql`:** InsertFoodScan, GetFoodConsumptionHistory, GetFoodConsumptionCounts, GetFoodCountersByCategory, GetFoodCountersByStall, GetFoodConsumptionPerGuest

### Write Pattern

Redis-first, PostgreSQL write-behind via Asynq background jobs:
1. Scan processed atomically in Redis (Lua script)
2. Background task enqueued to `pg-writes` queue
3. Worker writes to PostgreSQL using sqlc-generated queries
4. Separate task syncs to Convex via `convex-sync` queue
5. Recovery: On startup, `RunStartupRecovery` re-seeds Redis counters from PostgreSQL

## Cloudflare R2 (Object Storage)

**Purpose:** Store QR code images and composite invitation cards, served via CDN

**Client:** AWS SDK v2 S3-compatible (`backend/internal/r2/client.go`)
- `github.com/aws/aws-sdk-go-v2/service/s3` v1.99.0
- Endpoint: `https://{accountId}.r2.cloudflarestorage.com`

**Bucket:** Configured via `R2_BUCKET_NAME` env var (default: `eventarc-qr`)

**Object Key Patterns:**
- QR codes: `events/{eventID}/guests/{guestID}/qr/{entry|food|unified}.png`
- Card composites: `events/{eventID}/guests/{guestID}/cards/card.png`
- Template backgrounds: `events/{eventID}/templates/{templateID}/background.png`
- Legacy QR: `{eventID}/{guestID}/{typeName}.png`

**Operations:**
- `Upload(ctx, key, data, contentType)` - PutObject
- `Download(ctx, key)` - GetObject (used for card compositing to fetch QR + background)
- `PublicURL(key)` - Returns `{R2_PUBLIC_URL}/{key}` for CDN access

**CDN URL:** Configured via `R2_PUBLIC_URL` env var (e.g., `https://cdn.eventarc.app`)

## SMS Provider (SMS.NET.BD)

**Purpose:** Bulk SMS delivery for event invitations with card image URLs

**Implementation:** `backend/internal/sms/smsnetbd.go` (implements `SMSProvider` interface)

**Provider Interface** (`backend/internal/sms/provider.go`):
```go
type SMSProvider interface {
    Send(ctx context.Context, req SendRequest) (*SendResponse, error)
    CheckStatus(ctx context.Context, requestID string) (*StatusResponse, error)
    CheckBalance(ctx context.Context) (*BalanceResponse, error)
}
```

**API Endpoints Used:**
- `POST {baseURL}/sendsms` - Send SMS (form-encoded: api_key, msg, to, sender_id)
- `GET {baseURL}/report/request/{requestID}/` - Check delivery status
- `GET {baseURL}/user/balance/` - Check account balance

**Default Base URL:** `https://api.sms.net.bd`

**Error Handling:**
- Error code 416 -> `ErrInsufficientBalance` (pre-send balance check)
- Non-zero error codes -> `APIError` with code and message
- `IsInsufficientBalance()` helper for error classification

**SMS Worker** (`backend/internal/sms/worker.go`):
- Task types: `TypeSMSBatch`, `TypeSMSSendBatch`, `TypeSMSStatusPoll`, `TypeSMSRetry`
- Processes batches, handles retries, polls delivery status

**Config env vars:**
- `SMS_PROVIDER_API_KEY` - API key
- `SMS_PROVIDER_SENDER_ID` - Approved sender ID
- `SMS_PROVIDER_BASE_URL` - Override base URL (default: sms.net.bd)

## Better Auth (Authentication)

**Purpose:** Email/password authentication with Convex integration

**Frontend Client:** `frontend/src/lib/auth-client.ts`
```typescript
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL,
  plugins: [convexClient(), crossDomainClient()],
});
```

**Convex Server:** `convex/auth.ts`
- `betterAuth()` with email/password enabled, no email verification required
- Plugins: `crossDomain` (CORS for auth cookies), `convex` (Convex adapter)
- Secure cookies in non-development environments
- Trusted origins from `SITE_URL` env var

**Auth Routes:** Registered automatically by `authComponent.registerRoutes(http, createAuth, { cors: true })` in `convex/http.ts`

**Role System:** First registered user gets `admin` role, subsequent users get `eventManager` role (`convex/auth.ts` `ensureCurrentUserProfile`)

**Authorization:** `convex/authz.ts` provides:
- `requireAuthenticated(ctx)` - Validates identity
- `resolveUserRole(ctx, tokenIdentifier)` - Returns user role from `appUsers` table
- `ensureAdminAccess(ctx)` - Guards admin-only operations

## Background Job Processing (Asynq)

**Purpose:** Async task processing for QR generation, card compositing, SMS delivery, scan write-behind

**Library:** `github.com/hibiken/asynq` v0.26.0 (Redis-backed)

**Worker Process:** `backend/cmd/worker/main.go`
- Concurrency: 10 goroutines
- 5 priority queues: critical(6), pg-writes(4), default(3), convex-sync(2), low(1)

**Task Types:**
- `worker.TaskQRGenerateBatch` / `worker.TaskQRGenerateSingle` - QR image generation -> R2 upload
- `handler.TypeCardCompositeBatch` / `handler.TypeCardCompositeSingle` - Card image compositing -> R2 upload -> Convex sync
- `scan.TaskPGWrite` - Entry scan PostgreSQL write-behind
- `scan.TaskConvexSync` - Entry scan Convex sync
- `scan.TaskFoodScanPGWrite` - Food scan PostgreSQL write-behind
- `scan.TaskFoodScanConvexSync` - Food scan Convex sync
- `sms.TypeSMSBatch` / `sms.TypeSMSSendBatch` - SMS batch orchestration
- `sms.TypeSMSStatusPoll` - SMS delivery status polling
- `sms.TypeSMSRetry` - SMS retry for failed deliveries

## SSE (Server-Sent Events)

**Purpose:** Real-time dashboard counter updates

**Implementation:** `backend/internal/sse/broker.go`
- `SSEBroker` manages per-event client channels
- Subscribe/unsubscribe with cleanup function
- Broadcast to all connected clients (slow clients dropped)

**Endpoint:** `GET /api/v1/events/{eventId}/live`
**Handler:** `backend/internal/sse/` - Subscribes to Redis Pub/Sub channel `event:{eventId}:scans` and forwards to SSE stream

**Frontend Consumer:** `frontend/src/hooks/use-sse.ts` - Custom hook for SSE connection with auto-reconnect

## QR Code Generation

**Purpose:** Generate HMAC-signed QR codes for guest entry and food tracking

**Libraries:**
- `github.com/yeqown/go-qrcode/v2` v2.2.5 - QR code image generation
- `github.com/ehsanul-haque-siam/eventarc/internal/qr` - Payload encoding/decoding with HMAC verification

**QR Payload Types** (`backend/internal/qr/payload.go`):
- `0x01` = Entry QR
- `0x02` = Food QR
- `0x03` = Unified QR (entry + food combined)

**Flow:**
1. Admin triggers via Convex action -> Go API `POST /api/v1/qr/generate`
2. Asynq batch task fans out to per-guest single tasks
3. Each task: encode payload with HMAC, generate QR image, upload to R2
4. Progress tracked in Redis, polled by frontend

## Card Compositing

**Purpose:** Overlay QR code onto invitation card template background

**Implementation:** `backend/internal/card/compositor.go`
- Downloads template background from R2
- Downloads guest QR code from R2
- Resizes QR to specified dimensions (from template overlay config)
- Composites QR onto background at specified position
- Uploads composite card to R2
- Syncs card URL back to Convex guest record

**Libraries:** `github.com/disintegration/imaging` v1.6.2 for image resizing, Go stdlib `image/draw` for compositing

## Offline Scanner Support

**Purpose:** Allow vendor scanning stations to operate during network interruptions

**Frontend Implementation:**
- `frontend/src/lib/offline-queue.ts` - IndexedDB-backed offline scan queue (uses `idb` ^8.0.3)
- `frontend/src/hooks/use-offline-sync.ts` - Sync pending scans when network restores
- `frontend/src/hooks/use-network-status.ts` - Network connectivity detection
- `frontend/src/stores/scanner-store.ts` - Zustand store for offline scanner UI state

**Browser QR Scanner:**
- `frontend/src/hooks/use-scanner.ts` - Custom hook wrapping `html5-qrcode` ^2.3.8
- `frontend/src/hooks/use-audio-feedback.ts` - Audio feedback for scan results
- `frontend/src/hooks/use-device-session.ts` - Device session management

## Load Testing

**Tools:**
- k6 JavaScript test scripts (`backend/tests/load/scan_load_test.js`, `backend/tests/load/scenarios/`)
- Go integration tests with testcontainers (`backend/tests/hardening/`)
- Custom Go load test runner (`backend/tests/load/cmd/`)

**Config:** `backend/tests/load/config_matrix.js` - Multiple test scenarios
**Runners:** `backend/tests/load/run.sh`, `backend/tests/load/run_matrix.sh`

## Webhooks & Callbacks

**Incoming (Go backend):**
- `POST /api/v1/sync/event` - Convex pushes event data to Go cache
- `POST /api/v1/sync/food-rules` - Convex pushes food rules to Go cache

**Incoming (Convex HTTP):**
- `POST /internal/sync/guest-card` - Go pushes card image metadata
- `POST /internal/sync/guest-checkin` - Go pushes check-in status
- `POST /internal/sync/food-consumption` - Go pushes food scan records

**Outgoing:**
- Go -> Convex HTTP actions (HMAC-signed sync calls)
- Go -> SMS.NET.BD API (SMS delivery)
- Go -> Cloudflare R2 (S3 API for image storage)

---

*Integration audit: 2026-04-12*
