# Phase 8: Invitation Card Editor & SMS Pipeline - Research

**Researched:** 2026-04-12
**Status:** Complete

## 1. Card Editor (Fabric.js + React)

### Library Version & Setup
- **Fabric.js v7.0.0** is the latest release (available on npm as `fabric`)
- React integration uses uncontrolled component pattern: `useRef` for canvas DOM element, `useEffect` for Fabric.js `Canvas` initialization
- Alternative: `fabricjs-react` wrapper provides `FabricJSCanvas` component and `useFabricJSEditor` hook — but adds a dependency for minimal value; raw integration is straightforward

### Key API for Card Editor

**Canvas lifecycle:**
```typescript
import { Canvas, FabricImage } from 'fabric';

// Initialize
const canvas = new Canvas(canvasRef.current, { width: 800, height: 600 });

// Cleanup
canvas.dispose();
```

**Image loading (background card design):**
```typescript
const bgImage = await FabricImage.fromURL(uploadedImageUrl);
canvas.backgroundImage = bgImage;
canvas.renderAll();
```

**QR overlay positioning:**
```typescript
const qrImage = await FabricImage.fromURL(sampleQrUrl);
qrImage.set({
  left: 100,       // x position
  top: 200,        // y position
  scaleX: 0.5,     // width scale
  scaleY: 0.5,     // height scale
  hasControls: true // resize/rotate handles
});
canvas.add(qrImage);
canvas.setActiveObject(qrImage);
```

**Serialization (save template):**
```typescript
// Save canvas state
const templateJSON = canvas.toJSON();
// Restore
await canvas.loadFromJSON(templateJSON);
```

**Preview export:**
```typescript
const previewDataUrl = canvas.toDataURL({ format: 'png' });
```

### Template Data Model
A card template needs to persist:
- Background image URL (stored in R2)
- QR overlay position: `{ left, top, scaleX, scaleY, angle }`
- Canvas dimensions
- Template name and event association

This is a small JSON blob — store in Convex as a `cardTemplates` table.

### Performance Considerations
- Canvas rendering is client-side only; no server-side concerns
- `requestRenderAll()` is preferred over `renderAll()` for frequent updates (batches redraws)
- For large background images, resize to canvas dimensions before loading to avoid memory pressure

## 2. Image Compositing Pipeline (Go)

### Approach: `disintegration/imaging` Library

The `disintegration/imaging` package provides clean, high-level compositing functions. Better than raw `image/draw` for this use case because it handles NRGBA conversion, resampling filters, and encoding in one package.

**Key functions for compositing:**

```go
// Load background card image
background, err := imaging.Open("card-template.png")

// Load QR image (already generated in Phase 3)
qrImg, err := imaging.Open("qr-code.png")

// Resize QR to target dimensions from template config
qrResized := imaging.Resize(qrImg, targetWidth, targetHeight, imaging.Lanczos)

// Overlay QR onto card at position from template config
composite := imaging.Overlay(background, qrResized, image.Pt(posX, posY), 1.0)

// Encode to PNG bytes for R2 upload
var buf bytes.Buffer
err = imaging.Encode(&buf, composite, imaging.PNG)
```

**Resampling filter choices:**
| Filter | Quality | Speed | Use Case |
|--------|---------|-------|----------|
| Lanczos | Best | Slowest | Final production images |
| CatmullRom | Very good | Moderate | Good quality/speed balance |
| Linear | Adequate | Fast | High-throughput batch |
| NearestNeighbor | Worst | Fastest | Only for pixel art |

**Recommendation:** Use `imaging.CatmullRom` for 60K batch — good quality at ~2x faster than Lanczos. Can be configurable.

### Batch Processing Architecture

**Worker pool pattern using asynq:**
1. Admin triggers compositing from frontend
2. Go HTTP handler enqueues a "batch:composite" task with event ID
3. Batch task handler:
   a. Fetches all guest IDs for event from Convex
   b. For each guest, enqueues individual "composite:single" tasks
   c. Each single task: download template + QR from R2, composite, upload result to R2
4. Progress tracking via asynq `ResultWriter` or Redis counter

**Memory management (critical for 60K images):**
- Process one image at a time per worker (load, composite, encode, upload, release)
- Do NOT hold all images in memory
- Worker count: 4-8 concurrent workers (each worker uses ~50-100MB during compositing)
- With 8 workers: ~800MB peak memory — acceptable for a server process

**Crash recovery:**
- asynq provides at-least-once execution — if worker crashes, task is re-enqueued after lease expiry
- Individual guest compositing tasks are idempotent (re-upload same image to same R2 key)
- Batch orchestrator tracks completion via Redis counter: `INCR composite:{eventId}:done`
- On restart, completed tasks are skipped (R2 key already exists or task marked done)

### R2 Storage Keys for Composite Images
Following Phase 3's hierarchical pattern:
```
{eventId}/{guestId}/card.png        # Composite invitation card
{eventId}/template/background.png   # Uploaded card design template
```

### Performance Estimates
- Single composite (load + resize QR + overlay + encode PNG): ~50-100ms
- With 8 workers at 75ms average: ~8 workers * (1000ms/75ms) = ~106 images/sec
- 60K images at 106/sec = ~566 seconds = ~9.4 minutes
- **Well within acceptable range for background processing**

## 3. SMS Delivery Pipeline

### SMS.NET.BD API

**Endpoint:** `https://api.sms.net.bd/sendsms`

**Authentication:** API key (obtained from SMS Panel)

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `api_key` | Yes | API authentication key |
| `msg` | Yes | Message body (up to 800 chars, supports Bangla/Unicode) |
| `to` | Yes | Recipient numbers (comma-separated for bulk, 880XXXXXXXXX or 01XXXXXXXXX format) |
| `schedule` | No | Scheduled send: `Y-m-d H:i:s` |
| `sender_id` | No | Approved sender ID |
| `content_id` | No | Required for bulk campaigns — approved content template ID |

**Response:**
```json
{
  "error": 0,
  "msg": "Request Accepted Successfully",
  "data": {
    "request_id": "abc123",
    "recipients": [
      { "number": "8801800000000", "charge": 0.25, "status": "Sent" }
    ]
  }
}
```

**Error codes:** 0 (success), 400-405 (request errors), 409-420 (SMS-specific: expired account, invalid schedule, insufficient balance, blocked content)

**Delivery reporting:** `GET https://api.sms.net.bd/report/request/{request_id}/`

**Balance check:** `GET https://api.sms.net.bd/user/balance/`

**Rate capability:** Up to 50,000 SMS per minute (from provider docs)

**No webhook support** — delivery status must be polled via Report API

### SMS Provider Interface Design

```go
type SMSProvider interface {
    Send(ctx context.Context, req SendRequest) (*SendResponse, error)
    CheckStatus(ctx context.Context, requestID string) (*StatusResponse, error)
    CheckBalance(ctx context.Context) (*BalanceResponse, error)
}

type SendRequest struct {
    To      []string // Phone numbers in 880XXXXXXXXX format
    Message string
    SenderID string  // Optional
}

type SendResponse struct {
    RequestID  string
    Recipients []RecipientStatus
}

type RecipientStatus struct {
    Phone  string
    Status string // "Sent", "Failed", etc.
    Charge float64
}
```

### Throttling Strategy

Despite 50K/min capability, conservative throttling avoids carrier-level spam detection:

1. **Batch size:** Send in batches of 100 numbers per API call (comma-separated `to` parameter)
2. **Rate limit:** 10 batches per second = 1,000 SMS/sec = 60K/min (well under provider limit)
3. **Recommended:** Start with 5 batches/sec (500 SMS/sec) and increase if no issues
4. **At 500/sec:** 60K SMS in 120 seconds = 2 minutes
5. **Token bucket or sliding window rate limiter** in the SMS worker

### Retry Strategy

- **On API error (4xx/5xx):** Exponential backoff: 1s, 2s, 4s, 8s, 16s — max 5 retries
- **On "insufficient balance" (error 416):** Stop entire batch, alert admin
- **On individual recipient failure:** Re-enqueue just that recipient with delay
- **asynq handles worker-level retry** for crashes

### Delivery Status Tracking

Since SMS.NET.BD has no webhooks:
1. After each batch send, store `request_id` in Redis with guest mapping
2. Background polling job runs every 30 seconds, queries Report API for pending `request_id`s
3. Update guest status in Convex: `queued` -> `sent` -> `delivered` / `failed`
4. Polling stops for a request_id once all recipients have terminal status

### Status State Machine
```
queued -> sending -> sent -> delivered
                          -> failed -> retrying -> sent -> delivered
                                                        -> failed (final after max retries)
```

## 4. Convex Schema Extensions

### New Tables

**cardTemplates:**
```typescript
cardTemplates: defineTable({
  eventId: v.id("events"),
  name: v.string(),
  backgroundImageUrl: v.string(),     // R2 CDN URL of uploaded design
  backgroundImageKey: v.string(),     // R2 object key
  canvasWidth: v.number(),
  canvasHeight: v.number(),
  qrOverlay: v.object({
    left: v.number(),
    top: v.number(),
    scaleX: v.number(),
    scaleY: v.number(),
    angle: v.number(),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_event", ["eventId"])
```

**smsDeliveries:**
```typescript
smsDeliveries: defineTable({
  eventId: v.id("events"),
  guestId: v.id("guests"),
  phone: v.string(),
  status: v.union(
    v.literal("queued"),
    v.literal("sending"),
    v.literal("sent"),
    v.literal("delivered"),
    v.literal("failed"),
  ),
  providerRequestId: v.optional(v.string()),
  retryCount: v.number(),
  lastAttemptAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  failureReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_event", ["eventId"])
  .index("by_guest", ["guestId"])
  .index("by_event_status", ["eventId", "status"])
  .index("by_providerRequestId", ["providerRequestId"])
```

### Guest Table Extension
Add to existing `guests` table:
- `cardImageUrl: v.optional(v.string())` — CDN URL of composite card
- `cardImageKey: v.optional(v.string())` — R2 object key of composite card

## 5. Integration with Existing Codebase

### Reuse from Phase 3
- `backend/internal/r2/client.go` — Same `Upload()` and `PublicURL()` methods for composite cards
- `backend/internal/qr/generator.go` — QR images already in R2, just need to download for compositing
- asynq is already in `go.mod` — add new task types for compositing and SMS
- Redis connection already configured — add counters for compositing/SMS progress

### New Backend Packages
```
backend/internal/
  card/
    compositor.go     # Image compositing logic
    compositor_test.go
  sms/
    provider.go       # SMSProvider interface
    smsnetbd.go       # SMS.NET.BD implementation
    smsnetbd_test.go
    worker.go         # asynq task handlers for SMS delivery
  worker/
    card_tasks.go     # asynq task handlers for compositing
    sms_tasks.go      # asynq task handlers for SMS batching
```

### New Frontend Routes
```
frontend/src/routes/events/$eventId/cards.tsx  # Card editor page
```

### API Endpoints (Go chi)
```
POST   /api/events/{eventId}/cards/template    # Upload card template + save config
GET    /api/events/{eventId}/cards/template    # Get current template config
POST   /api/events/{eventId}/cards/composite   # Trigger batch compositing
GET    /api/events/{eventId}/cards/progress    # Get compositing progress
POST   /api/events/{eventId}/sms/send          # Trigger bulk SMS delivery
GET    /api/events/{eventId}/sms/progress      # Get SMS delivery progress
```

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Fabric.js v7 breaking changes from v6 docs | Medium | Pin exact version, test core features on integration |
| SMS.NET.BD rate limiting / account suspension | High | Start conservative (500/sec), add circuit breaker, admin alerts on balance/errors |
| 60K image compositing OOM | Medium | Process one at a time per worker, limit to 4-8 workers, monitor memory |
| No webhook for SMS status | Medium | Polling-based status check every 30s; batch polling for efficiency |
| Large background images causing slow compositing | Low | Resize background to target output dimensions before compositing |
| R2 upload rate limiting | Low | R2 has no egress fees and generous write limits; unlikely bottleneck |

## Validation Architecture

### Testable Claims
1. Card template serialization round-trips correctly (save -> load -> positions match)
2. QR overlay position from template config produces pixel-accurate composite
3. SMS provider interface is properly abstracted (mock provider passes same tests)
4. Batch compositing handles 100+ images without OOM (integration test with smaller batch)
5. SMS retry logic respects exponential backoff timing
6. Delivery status polling correctly updates Convex guest records
7. Progress counters accurately reflect completion (done/total matches actual R2 uploads)

### Integration Test Strategy
- Use testcontainers for Redis (progress counters)
- Mock R2 client for upload verification
- Mock SMS provider for delivery flow testing
- Frontend card editor: Playwright test for drag-drop position verification

## RESEARCH COMPLETE
