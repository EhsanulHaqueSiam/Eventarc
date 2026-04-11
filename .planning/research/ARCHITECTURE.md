# Architecture Patterns

**Domain:** High-concurrency event management platform (QR-based entry + food tracking)
**Researched:** 2026-04-11
**Confidence:** HIGH (patterns verified across multiple authoritative sources)

## Recommended Architecture

### System Overview (Text Diagram)

```
                         +------------------+
                         |   Admin Browser   |
                         |  (React + Vite)   |
                         +--------+---------+
                                  |
                           SSE (real-time)
                           + REST API
                                  |
                         +--------v---------+
                         |   CDN / Edge      |
                         |  (Cloudflare)     |
                         +--------+---------+
                                  |
                    +-------------+-------------+
                    |                           |
           +-------v--------+         +--------v--------+
           | Static Assets  |         |   API Gateway    |
           | QR Images,     |         |   (Go HTTP)      |
           | Invitation     |         +--------+---------+
           | Cards (R2)     |                  |
           +----------------+     +------------+------------+
                                  |            |            |
                          +-------v--+  +------v-----+ +---v----------+
                          | Scan     |  | Admin      | | Background   |
                          | Service  |  | Service    | | Workers      |
                          | (hot     |  | (CRUD,     | | (SMS, Image  |
                          |  path)   |  |  config)   | |  Compositing)|
                          +----+-----+  +------+-----+ +---+----------+
                               |               |            |
                    +----------+----------+    |            |
                    |                     |    |            |
              +-----v------+      +------v----v---+  +-----v------+
              |   Redis     |      |  PostgreSQL   |  |  Task      |
              |  - Counters |      |  - Source of  |  |  Queue     |
              |  - Cache    |      |    truth      |  |  (Redis    |
              |  - Pub/Sub  |      |  - All data   |  |   Streams) |
              |  - Sessions |      +---------------+  +------------+
              +-------------+
```

### Vendor Scanner Data Flow (The Hot Path)

This is the most performance-critical flow -- 10K concurrent scans hitting simultaneously.

```
  Vendor Scanner Device (Browser)
         |
         | 1. Scan QR -> POST /api/v1/scans
         |    Body: { qr_token, stall_id, scan_type, idempotency_key, client_ts }
         v
  +------+-------+
  | API Gateway   |
  | (Go net/http) |
  +------+-------+
         |
         | 2. Validate QR token against Redis cache
         v
  +------+-------+
  | Redis Cache   |  Key: qr:{token} -> { guest_id, event_id, qr_type, status }
  | (Lookup)      |  TTL: duration of event + buffer
  +------+-------+
         |
         | 3. If cache miss -> DB lookup -> populate cache
         | 4. If cache hit -> proceed
         v
  +------+--------+
  | Idempotency   |  Key: scan:{idempotency_key}
  | Check (Redis) |  TTL: 24 hours
  +------+--------+
         |
         | 5. If already processed -> return cached result (200 OK, idempotent)
         | 6. If new -> proceed to write
         v
  +------+--------+
  | PostgreSQL    |  INSERT INTO scans (...) ON CONFLICT (idempotency_key) DO NOTHING
  | (Write)       |  RETURNING id, created_at
  +------+--------+
         |
         | 7. On successful insert:
         v
  +------+--------+
  | Redis Atomic  |  HINCRBY event:{id}:counters {field} 1
  | Counter       |  Fields: total_scans, entry_count, food:{category}_count
  | Increment     |  (single-threaded Redis = no race condition)
  +------+--------+
         |
         | 8. Publish event for dashboard
         v
  +------+--------+
  | Redis Pub/Sub |  PUBLISH event:{id}:live { scan_type, stall, timestamp, delta }
  +------+--------+
         |
         | 9. Fan out to all connected admin dashboards
         v
  +------+--------+
  | SSE Fanout    |  Go server maintains SSE connection pool per event
  | (Go Server)   |  Each dashboard client = 1 SSE goroutine
  +------+--------+
         |
         v
  Admin Dashboard (React) updates counters in real-time
```

### Component Boundaries

| Component | Responsibility | Communicates With | Concurrency Model |
|-----------|---------------|-------------------|-------------------|
| **API Gateway** | HTTP routing, auth middleware, rate limiting | All services | Go goroutines, net/http server |
| **Scan Service** | QR validation, idempotent scan recording, counter increments | Redis, PostgreSQL, Pub/Sub | Stateless handlers; all state in Redis/PG |
| **Admin Service** | Event CRUD, guest management, config, CSV import | PostgreSQL, Redis (cache invalidation) | Standard request/response |
| **SSE Fanout Service** | Maintain client connections, subscribe Redis Pub/Sub, push events | Redis Pub/Sub, Admin browsers | Goroutine per client connection |
| **Image Worker** | QR generation, invitation card compositing, upload to R2 | PostgreSQL (job queue), R2 storage | Worker pool consuming from queue |
| **SMS Worker** | Batch SMS dispatch with rate limiting | PostgreSQL (job queue), SMS API (BulkSMS) | Worker pool with backpressure |
| **Redis** | Cache, atomic counters, pub/sub, session store, task queue | All services | Single-threaded (atomic by design) |
| **PostgreSQL** | Source of truth for all persistent data | All services (via connection pool) | Row-level locks, UPSERT for idempotency |
| **Cloudflare R2 + CDN** | Object storage for QR images and invitation cards | Image Worker (write), CDN (read) | Eventual consistency (write-then-read) |

### Data Flow Summary

```
WRITE PATH (scan):   Scanner -> API -> Redis(validate+idempotency) -> PG(insert) -> Redis(counter++) -> Pub/Sub -> SSE -> Dashboard
READ PATH (dash):    Dashboard -> SSE(stream) <- Pub/Sub <- Redis(counters) [no DB queries for live data]
READ PATH (config):  Admin -> API -> Redis(cache) -> PG(fallback)
WRITE PATH (image):  Admin(upload design) -> API -> PG(job) -> Worker(compose) -> R2(store) -> CDN(serve)
WRITE PATH (SMS):    Admin(trigger send) -> API -> PG(job) -> Worker(batch) -> SMS API
```

## Database Schema Design for Idempotent Scans

### Core Tables

```sql
-- Events table
CREATE TABLE events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}',
    -- config contains: qr_strategy (unified/separate), food_qr_mode (guest_linked/anonymous),
    -- food_rules (JSON), food_qr_timing (pre_sent/after_entry)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guest categories per event (VIP, General, Staff, etc.)
CREATE TABLE guest_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES events(id),
    name        TEXT NOT NULL,
    privileges  JSONB NOT NULL DEFAULT '{}',
    -- privileges: { "food_limits": { "fuchka": 1, "biryani": 2 }, "entry_allowed": true }
    UNIQUE(event_id, name)
);

-- Guests
CREATE TABLE guests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id),
    category_id     UUID NOT NULL REFERENCES guest_categories(id),
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_guests_event (event_id),
    INDEX idx_guests_phone (event_id, phone)
);

-- QR Codes (pre-generated, 1:1 or 1:N with guest depending on mode)
CREATE TABLE qr_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id),
    guest_id        UUID REFERENCES guests(id),  -- NULL for anonymous food QRs
    token           TEXT NOT NULL UNIQUE,          -- The scannable value (short, URL-safe)
    qr_type         TEXT NOT NULL CHECK (qr_type IN ('entry', 'food')),
    image_url       TEXT,                          -- R2/CDN URL of QR image
    card_image_url  TEXT,                          -- Composited invitation card URL
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_qr_token (token),                   -- Critical: lookup by scanned value
    INDEX idx_qr_guest (guest_id)
);

-- Scans (the hot write table -- idempotent by design)
CREATE TABLE scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,          -- Client-generated: {device_id}:{qr_token}:{timestamp_bucket}
    event_id        UUID NOT NULL REFERENCES events(id),
    qr_code_id      UUID NOT NULL REFERENCES qr_codes(id),
    guest_id        UUID,                          -- NULL for anonymous food scans
    stall_id        UUID NOT NULL REFERENCES stalls(id),
    scan_type       TEXT NOT NULL CHECK (scan_type IN ('entry', 'food')),
    scanned_at      TIMESTAMPTZ NOT NULL,          -- Client timestamp (when actually scanned)
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Server timestamp (when received)
    device_id       TEXT NOT NULL,                 -- Scanning device identifier
    status          TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'duplicate_entry', 'limit_exceeded', 'invalid')),
    INDEX idx_scans_event (event_id),
    INDEX idx_scans_idempotency (idempotency_key), -- Already UNIQUE, but explicit
    INDEX idx_scans_guest_type (guest_id, scan_type, event_id)
);

-- Vendor hierarchy: types -> categories -> stalls
CREATE TABLE vendor_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES events(id),
    name        TEXT NOT NULL CHECK (name IN ('entry', 'food')),
    UNIQUE(event_id, name)
);

CREATE TABLE vendor_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_type_id  UUID NOT NULL REFERENCES vendor_types(id),
    event_id        UUID NOT NULL REFERENCES events(id),
    name            TEXT NOT NULL, -- "fuchka", "biryani", "main_gate"
    UNIQUE(event_id, name)
);

CREATE TABLE stalls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID NOT NULL REFERENCES vendor_categories(id),
    event_id        UUID NOT NULL REFERENCES events(id),
    name            TEXT NOT NULL, -- "fuchka-1", "fuchka-2"
    is_active       BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(event_id, name)
);

-- Device sessions (no login, device-based)
CREATE TABLE device_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id),
    stall_id        UUID NOT NULL REFERENCES stalls(id),
    device_id       TEXT NOT NULL UNIQUE,           -- Browser fingerprint or generated ID
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_device_event (event_id, device_id)
);

-- Atomic counters persisted (synced from Redis periodically)
CREATE TABLE event_counters (
    event_id        UUID NOT NULL REFERENCES events(id),
    counter_key     TEXT NOT NULL,  -- "entry_count", "food:fuchka:count", "stall:fuchka-1:count"
    value           BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, counter_key)
);
```

### Idempotency Mechanism

The `idempotency_key` on the `scans` table is the cornerstone of race condition prevention at the database level.

**Key format:** `{device_id}:{qr_token}:{scan_type}:{timestamp_bucket}`

- The `timestamp_bucket` is a 10-second window (floor of unix timestamp to nearest 10s). This prevents the same QR from being scanned at the same stall type within a 10-second window, while still allowing legitimate re-scans (e.g., guest returns for food later).

**Insert pattern:**

```sql
INSERT INTO scans (idempotency_key, event_id, qr_code_id, guest_id, stall_id, scan_type, scanned_at, device_id, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id, status;
```

- If `RETURNING` gives a row: new scan recorded, proceed to increment counters.
- If `RETURNING` gives nothing: duplicate, return the previously cached result.
- No advisory locks needed. The UNIQUE constraint on `idempotency_key` plus `ON CONFLICT DO NOTHING` is atomic and non-blocking under high concurrency.

### Food Limit Enforcement (Guest-Linked Mode)

For guest-linked food tracking where per-person limits apply:

```sql
-- Check current consumption before allowing scan
WITH current_consumption AS (
    SELECT COUNT(*) as count
    FROM scans
    WHERE guest_id = $1
      AND event_id = $2
      AND scan_type = 'food'
      AND status = 'valid'
      -- Optional: filter by food category via stall join
)
INSERT INTO scans (...)
SELECT $values
WHERE (SELECT count FROM current_consumption) < $limit
RETURNING id, status;
```

**Race condition prevention for limits:** This CTE + INSERT is atomic within a single statement. PostgreSQL's MVCC ensures the count reflects committed transactions. For the edge case where two scans for the same guest arrive in the same millisecond, the UNIQUE `idempotency_key` prevents double-counting, and the second transaction will see the first's committed insert (serializable isolation not needed -- READ COMMITTED with the idempotency key is sufficient).

## Redis Caching Strategy

### Cache Layers

```
Layer 1: QR Token Lookup Cache
  Key:    qr:{token}
  Value:  { guest_id, event_id, qr_type, category_id, is_active }
  TTL:    Event duration + 2 hours
  Write:  On QR generation (warm cache), on first scan (lazy load)
  Evict:  On QR deactivation

Layer 2: Guest Consumption Cache (for food limit checks)
  Key:    consumption:{event_id}:{guest_id}:{food_category}
  Value:  integer count
  TTL:    Event duration + 2 hours
  Write:  INCR on valid food scan
  Read:   Before food scan (check limit)
  Sync:   Periodic reconciliation with PG (every 60s)

Layer 3: Event Config Cache
  Key:    event:{id}:config
  Value:  Full event config JSON
  TTL:    5 minutes (short, config changes are rare but must propagate)
  Evict:  On admin config update (explicit invalidation)

Layer 4: Idempotency Cache
  Key:    idem:{idempotency_key}
  Value:  { result_status, scan_id, processed_at }
  TTL:    24 hours
  Write:  After successful DB insert
  Read:   Before DB insert (fast-path duplicate rejection)

Layer 5: Device Session Cache
  Key:    device:{device_id}
  Value:  { event_id, stall_id, last_seen }
  TTL:    Event duration
  Write:  On session creation/update
```

### Cache Warming Strategy

Before an event goes live, a background job pre-loads all QR tokens into Redis. For 60K guests:

- Each QR cache entry is approximately 200 bytes
- 60K entries x 2 QR types = 120K keys = ~24 MB (negligible for Redis)
- Warming takes < 30 seconds via PIPELINE batches of 1000

## Atomic Counter Patterns

### Redis Counter Structure

```
Hash Key:   event:{event_id}:counters
Fields:
  total_entry_scans       -> integer
  total_food_scans        -> integer
  unique_attendees        -> integer
  food:fuchka:count       -> integer
  food:biryani:count      -> integer
  stall:fuchka-1:count    -> integer
  stall:fuchka-2:count    -> integer
  stall:main-gate:count   -> integer
```

**Why HINCRBY on a hash, not separate keys:**

1. Single HGETALL retrieves all counters for a dashboard refresh (1 round trip)
2. HINCRBY is atomic within Redis's single-threaded model -- no race conditions
3. Hash keys are memory-efficient compared to individual keys
4. Grouping by event makes cleanup trivial (DEL the hash after event ends)

**Increment pattern (Go pseudo-code):**

```go
func recordScan(ctx context.Context, rdb *redis.Client, scan ScanRecord) error {
    pipe := rdb.Pipeline()

    counterKey := fmt.Sprintf("event:%s:counters", scan.EventID)

    // Atomic increments -- all execute in a single Redis round trip
    pipe.HIncrBy(ctx, counterKey, "total_"+scan.ScanType+"_scans", 1)

    if scan.ScanType == "food" {
        pipe.HIncrBy(ctx, counterKey, "food:"+scan.FoodCategory+":count", 1)
    }
    pipe.HIncrBy(ctx, counterKey, "stall:"+scan.StallName+":count", 1)

    if scan.ScanType == "entry" {
        pipe.HIncrBy(ctx, counterKey, "unique_attendees", 1)
    }

    _, err := pipe.Exec(ctx)
    return err
}
```

### Write-Behind Flush to PostgreSQL

Redis counters are the live source of truth during events. PostgreSQL counters are the durable backup.

```
Every 10 seconds:
  1. HGETALL event:{id}:counters from Redis
  2. For each field:
     INSERT INTO event_counters (event_id, counter_key, value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (event_id, counter_key)
     DO UPDATE SET value = $3, updated_at = NOW();
  3. Log sync timestamp
```

**Data loss window:** Maximum 10 seconds of counter data if Redis crashes. Acceptable because:
- The `scans` table in PostgreSQL has every individual scan (source of truth)
- Counters can be fully reconstructed from scans via `SELECT COUNT(*) GROUP BY ...`
- Reconstruction is slow but only needed for disaster recovery, not live operations

## SSE Fanout for Real-Time Dashboard

### Architecture

```
                Redis Pub/Sub
                channel: event:{id}:live
                     |
        +------------+------------+
        |            |            |
   +----v----+  +----v----+  +----v----+
   | Go SSE  |  | Go SSE  |  | Go SSE  |   (multiple server instances)
   | Server  |  | Server  |  | Server  |
   | Pod 1   |  | Pod 2   |  | Pod 3   |
   +----+----+  +----+----+  +----+----+
        |            |            |
   [clients]    [clients]    [clients]
```

### Why SSE over WebSocket

For this system, SSE is the correct choice because:

1. **Unidirectional data flow** -- Dashboard only receives; it never sends data back on this channel. Admin actions use standard REST calls.
2. **Automatic reconnection** -- SSE has built-in browser reconnect with `Last-Event-ID`, so if a dashboard disconnects, it resumes from where it left off. WebSocket requires custom reconnection logic.
3. **HTTP/2 multiplexing** -- Multiple SSE streams share one TCP connection, eliminating the head-of-line blocking concern.
4. **Simpler infrastructure** -- SSE works through CDNs, load balancers, and proxies without special configuration. WebSocket requires upgrade-aware proxies.
5. **Go efficiency** -- Go SSE server holds thousands of connections at under 20MB RAM, each connection is a single goroutine.

### SSE Implementation Pattern

```go
// Simplified SSE fanout manager
type SSEBroker struct {
    clients    map[string]map[chan []byte]struct{} // eventID -> set of client channels
    mu         sync.RWMutex
    redisSub   *redis.PubSub
}

// Client connects: GET /api/v1/events/{id}/live
func (b *SSEBroker) HandleSSE(w http.ResponseWriter, r *http.Request) {
    eventID := chi.URLParam(r, "id")
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "SSE not supported", http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")

    ch := make(chan []byte, 64) // buffered to absorb burst
    b.addClient(eventID, ch)
    defer b.removeClient(eventID, ch)

    // Send initial counter snapshot
    counters := b.getCounterSnapshot(eventID)
    fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", counters)
    flusher.Flush()

    // Stream updates
    for {
        select {
        case msg := <-ch:
            fmt.Fprintf(w, "event: update\ndata: %s\n\n", msg)
            flusher.Flush()
        case <-r.Context().Done():
            return
        }
    }
}
```

### Event Payload Format

```json
{
    "type": "scan",
    "scan_type": "entry",
    "stall": "main-gate",
    "timestamp": "2026-04-11T15:30:00Z",
    "counters": {
        "total_entry_scans": 4521,
        "unique_attendees": 4520,
        "stall:main-gate:count": 2100
    }
}
```

**Optimization:** Rather than sending full counter state on every scan, send deltas. The React dashboard applies deltas to its local state. Every 30 seconds, send a full snapshot to correct any drift.

## Queue-Based Offline Sync

### Client-Side Queue (Vendor Scanner)

```
Scanner Device (Browser)
    |
    v
+---+-------------------+
| IndexedDB Queue        |
| Table: pending_scans   |
| Columns:               |
|   - id (auto)          |
|   - idempotency_key    |
|   - qr_token           |
|   - stall_id           |
|   - scan_type          |
|   - client_timestamp   |
|   - retry_count        |
|   - status (pending/   |
|     syncing/failed)    |
+---+-------------------+
    |
    | Online? -> POST /api/v1/scans
    | Offline? -> Queue locally, show green checkmark optimistically
    |
    v
+---+-------------------+
| Sync Manager           |
| - Monitors navigator   |
|   .onLine              |
| - On reconnect: drain  |
|   queue FIFO           |
| - On success: delete   |
|   from IndexedDB       |
| - On 409 (duplicate):  |
|   delete (already      |
|   processed)           |
| - On 5xx: retry with   |
|   exponential backoff  |
|   (max 5 retries)      |
+------------------------+
```

### Idempotency Across Offline Sync

The `idempotency_key` is generated client-side at scan time, not at sync time. This guarantees:

1. If the scan was sent but the response was lost (network blip mid-request), the retry uses the same key and gets a 200 OK (idempotent).
2. If multiple devices scan the same QR simultaneously, each device has a different `device_id` in the key, so both are recorded (correct behavior -- the business logic layer decides if this is a duplicate entry attempt).
3. The server never double-counts because `ON CONFLICT DO NOTHING` in PostgreSQL and the Redis idempotency cache both guard against it.

### Sync Protocol

```
Client                          Server
  |                               |
  |-- POST /api/v1/scans ------->|
  |   { idempotency_key, ... }   |
  |                               |-- Check Redis idem cache
  |                               |-- If cached: return cached result
  |                               |-- If new: insert PG, incr counters
  |<-- 200 { status, scan_id } --|
  |                               |
  |-- (next queued scan) ------->|
  |   ...                         |
```

## QR Image Generation and Storage Pipeline

### Pipeline Architecture

```
Admin creates event + imports guests
         |
         v
+--------+--------+
| Job Scheduler    |  Inserts batch job into task queue
| (Admin Service)  |  job_type: "generate_qr_batch"
+--------+--------+
         |
         v
+--------+--------+
| Redis Streams    |  XADD tasks:qr_generation * job_id {id} batch_size 500
| (Task Queue)     |
+--------+--------+
         |
         v (consumed by worker pool)
+--------+--------+
| QR Worker Pool   |  4-8 workers (configurable)
| (Go goroutines)  |
+--------+--------+
         |
    For each guest in batch:
         |
    1. Generate unique token (nanoid, 12 chars, URL-safe)
    2. Generate QR image (skip2/go-qrcode, 300x300 PNG)
    3. Upload QR image to R2: /events/{event_id}/qr/{token}.png
    4. Update qr_codes row: set image_url, token
    5. Report progress (XADD tasks:progress)
         |
         v
+--------+--------+
| Cloudflare R2    |  /events/{event_id}/qr/{token}.png
| + CDN            |  Served via: https://cdn.eventarc.app/events/...
+-----------------+
```

**Performance estimates for 60K guests:**

- QR generation: ~5ms per image (Go, CPU-bound)
- Upload to R2: ~20ms per image (network-bound, parallelized)
- With 8 workers: 60K images in ~2.5 minutes
- Total storage: 60K x ~5KB average = ~300 MB

### Invitation Card Compositing Service

```
Admin uploads card design + positions QR overlay
         |
         v
+--------+--------+
| Card Template    |  Stores: design_image_url, qr_position (x, y, w, h)
| (PostgreSQL)     |  per event
+--------+--------+
         |
         v (triggered after QR generation completes)
+--------+--------+
| Compositing Job  |  XADD tasks:card_compositing * event_id {id}
| (Redis Streams)  |
+--------+--------+
         |
         v
+--------+-----------+
| Image Worker Pool   |
| (Go + govips/bimg)  |  govips wraps libvips -- C-speed image processing
+--------+-----------+
         |
    For each guest:
         |
    1. Load card template image (cached in memory after first load)
    2. Load guest's QR image from R2 (or local cache)
    3. Composite QR onto card at configured position/size
    4. Encode as JPEG (quality 85, good balance of size/quality)
    5. Upload to R2: /events/{event_id}/cards/{guest_id}.jpg
    6. Update qr_codes row: set card_image_url
         |
         v
+--------+--------+
| Cloudflare R2    |  /events/{event_id}/cards/{guest_id}.jpg
| + CDN            |  ~50-100KB per card
+-----------------+
```

**Performance estimates for 60K cards:**

- Compositing with govips: ~15ms per image (libvips is extremely fast)
- Upload: ~20ms per image
- With 8 workers: 60K cards in ~7 minutes
- Total storage: 60K x ~80KB average = ~4.7 GB

**Why govips/bimg over pure Go image libraries:**
- libvips is 4-8x faster than Go's standard `image` package for compositing
- Memory efficient: streams images rather than loading entire files into RAM
- bimg was explicitly inspired by Node.js Sharp -- it is the Go equivalent

### Storage Layout in R2

```
bucket: eventarc-assets
  /events/
    /{event_id}/
      /qr/
        /{token}.png          -- Raw QR code images
      /cards/
        /{guest_id}.jpg       -- Composited invitation cards
      /designs/
        /template.{ext}       -- Admin-uploaded card design
```

## SMS Delivery Queue Architecture

### Pipeline

```
Admin triggers "Send Invitations"
         |
         v
+--------+--------+
| SMS Job Creator  |  Creates SMS jobs in batches of 100
| (Admin Service)  |
+--------+--------+
         |
         v
+--------+--------+
| Redis Streams    |  XADD tasks:sms * batch_id {id} recipients [...]
| (Task Queue)     |  Each message contains up to 100 recipients
+--------+--------+
         |
         v
+--------+--------+
| SMS Worker Pool  |  2-4 workers (rate-limited by provider)
+--------+--------+
         |
    For each batch:
         |
    1. Fetch card_image_url for each guest
    2. Compose SMS message with CDN link to invitation card
    3. Call BulkSMS API (batch endpoint)
    4. Record delivery status per recipient in PostgreSQL
    5. On rate limit (429): back off exponentially
    6. On failure: re-queue with retry_count + 1 (max 3)
         |
         v
+--------+-----------+
| SMS Delivery Log    |
| (PostgreSQL)        |
| - guest_id          |
| - status            |
| - provider_msg_id   |
| - sent_at           |
| - error_message     |
+---------+-----------+
```

### Rate Limiting and Backpressure

```
+------------------+    +------------------+    +------------------+
| Producer         |    | Token Bucket     |    | SMS API          |
| (Admin triggers  |--->| Rate Limiter     |--->| (BulkSMS.net)   |
|  bulk send)      |    | 30 msgs/sec      |    |                  |
+------------------+    | (per provider     |    +------------------+
                        |  TPS limit)       |
                        +------------------+
```

- **Token bucket** rate limiter sits in the SMS worker, not in Redis. This is simpler and sufficient for a single-producer, few-consumer queue.
- **Backpressure signal:** If the Redis Stream length exceeds 10K pending messages, the admin UI shows "SMS sending in progress" with a progress bar rather than accepting new bulk sends.
- **Dead letter queue:** After 3 failed attempts, SMS jobs move to a `tasks:sms:dead` stream for manual review.

## Patterns to Follow

### Pattern 1: Command-Query Responsibility Segregation (CQRS-lite)

**What:** Separate the write path (scans) from the read path (dashboard) at the data layer.
**When:** Always for the scan/dashboard flow.
**Why:** Writes go to PostgreSQL (durable) and increment Redis counters (fast). Reads come exclusively from Redis counters via SSE. The dashboard never queries PostgreSQL during a live event.

### Pattern 2: Event Sourcing for Scans

**What:** The `scans` table is an append-only event log. Never update or delete scan records. Every scan is an immutable event.
**When:** All scan operations.
**Why:** Full audit trail. Counters can be reconstructed from the event log. Idempotency is naturally expressed (duplicate events are rejected, not merged).

### Pattern 3: Cache-Aside with Warm-Up

**What:** Pre-load hot data (QR tokens, event config) into Redis before events go live. During the event, use cache-aside (check Redis first, fall back to PG, populate cache on miss).
**When:** Before event start, and during event for any cache misses.
**Why:** Eliminates cold-start latency. The first scan should not be slower than the 10,000th.

### Pattern 4: Bulkhead Isolation

**What:** Separate connection pools for hot-path (scans) vs. cold-path (admin CRUD). Scan handlers get 80% of the PostgreSQL connection pool.
**When:** Service initialization.
**Why:** An admin running a heavy CSV import should never starve the scan service of database connections.

## Anti-Patterns to Avoid

### Anti-Pattern 1: COUNT(*) for Dashboard

**What:** Running `SELECT COUNT(*) FROM scans WHERE event_id = $1` for real-time dashboard numbers.
**Why bad:** With 60K+ rows being inserted during a live event, COUNT queries become progressively slower, create lock contention, and compete with writes for I/O.
**Instead:** Use Redis HINCRBY atomic counters. Dashboard reads counters, never aggregates.

### Anti-Pattern 2: Distributed Locks for Scan Deduplication

**What:** Using Redis SETNX or Redlock to "lock" a QR code before processing a scan.
**Why bad:** Distributed locks add latency (lock acquire + release), can deadlock under network partition, and are unnecessary when idempotency keys provide the same guarantee without coordination.
**Instead:** Use idempotency keys with PostgreSQL `ON CONFLICT DO NOTHING`. No locks needed.

### Anti-Pattern 3: Synchronous Image Generation

**What:** Generating QR images or compositing invitation cards in the HTTP request path.
**Why bad:** Image generation is CPU-intensive. Blocking a web handler for 15ms per image means those goroutines are not handling scan requests.
**Instead:** Queue image work to background workers via Redis Streams. Return immediately with a job ID.

### Anti-Pattern 4: WebSocket for Dashboard

**What:** Using WebSocket when SSE suffices.
**Why bad:** WebSocket requires upgrade-aware proxies, manual reconnection logic, more complex client code, and bidirectional capabilities that are unused. It introduces unnecessary complexity.
**Instead:** SSE with Redis Pub/Sub. Built-in reconnection, works through standard HTTP infrastructure.

### Anti-Pattern 5: Single Redis Key per Counter

**What:** Using separate Redis keys like `event:1:entry_count`, `event:1:food_fuchka_count`, etc.
**Why bad:** Dashboard refresh requires N GET commands (one per counter). Network round trips multiply with counter count.
**Instead:** Use a single Redis Hash per event (`event:{id}:counters`) with HINCRBY. One HGETALL fetches all counters.

## Concurrency Strategy Per Component

| Component | Concurrency Threat | Prevention Mechanism |
|-----------|-------------------|---------------------|
| **Scan writes** | Two devices scan same QR simultaneously | `idempotency_key` UNIQUE constraint + `ON CONFLICT DO NOTHING` -- no locks, no race |
| **Food limit checks** | Guest scans food QR at two stalls simultaneously | Redis INCR returns new value atomically; if > limit, reject and DECR. PG idempotency_key prevents double-count |
| **Counter increments** | 10K simultaneous HINCRBY on same hash | Redis single-threaded model guarantees serial execution. No race by design |
| **SSE client management** | Clients connect/disconnect during broadcast | sync.RWMutex on client map; RLock for broadcast, Lock for add/remove |
| **Cache population** | Two requests both miss cache, both try to populate | SET with NX (set-if-not-exists) or simply let both write (last-write-wins is fine for cache) |
| **Background workers** | Two workers pick up same job | Redis Streams XREADGROUP with consumer groups -- each message delivered to exactly one consumer |
| **Offline sync replay** | Client retries a scan that was already processed | Idempotency key check (Redis fast-path, PG fallback) returns cached result |
| **Admin config updates** | Admin changes event config during live event | Write to PG + explicit Redis cache invalidation. Next read populates fresh cache. Short TTL (5 min) as safety net |

## Scalability Considerations

| Concern | 100 Attendees (dev/test) | 10K Attendees | 60K Attendees (target) |
|---------|--------------------------|---------------|------------------------|
| **PostgreSQL** | Single instance, no pooling needed | PgBouncer with 50 connections, scan table partitioned by event | PgBouncer with 100 connections, scan table partitioned by event_id + date |
| **Redis** | Single instance, no persistence needed | Single instance with RDB snapshots | Single instance (Redis handles 100K+ ops/sec on one core; 10K scans is 10% capacity) |
| **Go API servers** | Single instance | 2 instances behind load balancer | 3-4 instances behind load balancer (stateless, horizontally scalable) |
| **Background workers** | 1 worker process | 2 worker processes | 4 worker processes |
| **R2 storage** | Negligible | ~50 MB QR + 800 MB cards | ~300 MB QR + 4.7 GB cards |
| **SSE connections** | Direct, no pub/sub needed | Redis Pub/Sub for multi-instance | Redis Pub/Sub, multiple SSE server pods |

**Key insight:** At 60K attendees / 10K concurrent, this system does NOT need microservices, Kubernetes, or distributed databases. A well-architected monolith (or 2-3 services) with Redis + PostgreSQL handles this load comfortably. Redis alone can handle 100K+ operations per second on a single instance. PostgreSQL with proper indexing and connection pooling handles 10K writes per second on modest hardware.

## Suggested Build Order (Dependencies)

```
Phase 1: Foundation
  PostgreSQL schema + migrations
  Go HTTP server skeleton + routing
  Redis connection setup
  Basic auth (admin)
  --> Reason: Everything depends on the data layer and HTTP framework

Phase 2: Core Event + Guest Management
  Event CRUD
  Guest categories CRUD
  Guest management (manual + CSV import)
  --> Reason: Events and guests must exist before QR codes can be generated

Phase 3: QR Generation Pipeline
  QR token generation
  QR image generation (go-qrcode)
  R2 upload pipeline
  CDN serving
  --> Reason: QR codes must exist before scanning can work

Phase 4: Scan Hot Path (THE critical path)
  Redis cache warming (QR tokens)
  Scan API endpoint (idempotent writes)
  Atomic counter increments (Redis HINCRBY)
  Food limit enforcement
  Device session management
  --> Reason: This is the core value proposition. Must be rock-solid.

Phase 5: Real-Time Dashboard
  Redis Pub/Sub integration
  SSE server + fanout
  React dashboard with live counter updates
  Counter write-behind flush to PostgreSQL
  --> Reason: Depends on scan events flowing through the system

Phase 6: Invitation Card Pipeline
  Card template editor (drag-drop QR position)
  Image compositing worker (govips)
  Card storage + CDN serving
  --> Reason: Depends on QR images existing (Phase 3)

Phase 7: SMS Delivery
  SMS queue + worker
  BulkSMS.net integration
  Delivery tracking
  Rate limiting
  --> Reason: Depends on invitation cards existing (Phase 6)

Phase 8: Offline Resilience
  IndexedDB queue on scanner devices
  Sync manager with retry logic
  Idempotency verification end-to-end
  --> Reason: Depends on scan API being stable (Phase 4). Can be built in parallel with Phase 5-7.

Phase 9: Vendor Scanner UI
  Device-based session (no login)
  Stall selection dropdown
  Camera QR scanning interface
  Offline queue integration
  --> Reason: Depends on device sessions (Phase 4) and offline sync (Phase 8)
```

## Sources

- [Redis INCR Documentation](https://redis.io/docs/latest/commands/incr/) -- Atomic increment guarantees (HIGH confidence)
- [Redis HINCRBY Documentation](https://redis.io/docs/latest/commands/hincrby/) -- Hash field atomic increment (HIGH confidence)
- [Redis Pub/Sub Documentation](https://redis.io/docs/latest/develop/pubsub/) -- Fan-out messaging (HIGH confidence)
- [Redis Distributed Counters](https://oneuptime.com/blog/post/2026-01-27-redis-distributed-counters/view) -- Sharded counter patterns (MEDIUM confidence)
- [Sharded Counters with Redis Caching](https://medium.com/@sakshamsahgal5/counting-at-scale-sharded-counters-with-redis-caching-d0a4c5e81236) -- Write-behind pattern (MEDIUM confidence)
- [Distributed Counter System Design](https://systemdesign.one/distributed-counter-system-design/) -- Counter architecture (MEDIUM confidence)
- [PostgreSQL UPSERT Documentation](https://www.postgresql.org/docs/current/sql-insert.html) -- ON CONFLICT behavior (HIGH confidence)
- [Concurrently Safe Upsert in PostgreSQL](https://devandchill.com/posts/2020/02/postgres-building-concurrently-safe-upsert-queries/) -- Advisory lock vs upsert patterns (MEDIUM confidence)
- [SSE vs WebSocket](https://oneuptime.com/blog/post/2026-01-27-sse-vs-websockets/view) -- Protocol comparison (MEDIUM confidence)
- [Go + SSE at 500 Concurrent Connections](https://dev.to/brighto7700/your-next-real-time-feature-probably-doesnt-need-websockets-go-sse-at-500-concurrent-connections-39ne) -- Go SSE performance (MEDIUM confidence)
- [Go + Redis Pub/Sub + SSE Notification System](https://medium.com/@joicejoseph/leveraging-golang-redis-pub-sub-for-a-high-performance-sse-based-notification-system-666e97ef6bea) -- Full stack pattern (MEDIUM confidence)
- [go-pubssed: Redis PubSub to SSE bridge](https://github.com/whosonfirst/go-pubssed) -- Reference implementation (MEDIUM confidence)
- [govips: Lightning fast image processing for Go](https://github.com/davidbyttow/govips) -- Image compositing library (HIGH confidence)
- [bimg: High-level image processing powered by libvips](https://github.com/h2non/bimg) -- Sharp equivalent for Go (HIGH confidence)
- [skip2/go-qrcode](https://pkg.go.dev/github.com/skip2/go-qrcode) -- QR code generation for Go (HIGH confidence)
- [Offline Support: Foreground Queue vs Background Sync](https://blog.tomaszgil.me/offline-support-in-web-apps-foreground-queue-vs-background-sync) -- Offline queue patterns (MEDIUM confidence)
- [Idempotency in Distributed Systems](https://algomaster.io/learn/system-design/idempotency) -- Idempotency patterns (MEDIUM confidence)
- [Idempotent Consumer Pattern](https://microservices.io/patterns/communication-style/idempotent-consumer.html) -- At-least-once with idempotent processing (MEDIUM confidence)
- [Cloudflare R2 vs AWS S3 2025 Comparison](https://www.digitalapplied.com/blog/cloudflare-r2-vs-aws-s3-comparison) -- R2 zero-egress advantage (MEDIUM confidence)
- [Rust vs Go Performance Benchmarks 2025](https://markaicode.com/rust-vs-go-performance-benchmarks-microservices-2025/) -- Concurrency benchmarks (MEDIUM confidence)
- [Rust vs Go 2025 JetBrains](https://blog.jetbrains.com/rust/2025/06/12/rust-vs-go/) -- Language comparison (MEDIUM confidence)
- [Sentry: Buffering SQL Writes with Redis](https://blog.sentry.io/2016/02/23/buffering-sql-writes-with-redis/) -- Write-behind buffer pattern at scale (MEDIUM confidence)
- [AWS: Avoiding Insurmountable Queue Backlogs](https://aws.amazon.com/builders-library/avoiding-insurmountable-queue-backlogs/) -- Queue backpressure (HIGH confidence)
