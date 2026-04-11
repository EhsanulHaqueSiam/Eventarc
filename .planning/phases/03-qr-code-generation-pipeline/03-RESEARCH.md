# Phase 3: QR Code Generation Pipeline - Research

**Researched:** 2026-04-11
**Phase Goal:** System generates unique, cryptographically signed QR code images for every guest and serves them instantly via CDN
**Requirements:** QRCD-01, QRCD-02, QRCD-03, QRCD-04, QRCD-05, QRCD-06, INFR-05

---

## 1. QR Payload Binary Format Design

### Requirement
D-01/D-02/D-03 from CONTEXT.md: Compact binary encoding with fixed-length fields. 1-byte version prefix + guestId + eventId + qrType + creation timestamp + HMAC-SHA256 signature.

### Key Insight: Convex IDs Are Strings
Convex document IDs (e.g., `events._id`, `guests._id`) are opaque strings like `"jd7f2g3h4k5m6n"` — NOT UUIDs or integers. They are variable-length base62-ish strings. This impacts binary payload design: we cannot use fixed 16-byte UUID fields.

### Recommended Binary Layout

```
Version (1 byte) | QR Type (1 byte) | EventID Length (1 byte) | EventID (N bytes) | GuestID Length (1 byte) | GuestID (N bytes) | Timestamp (8 bytes, uint64 unix epoch seconds) | HMAC-SHA256 (32 bytes)
```

**Field breakdown:**
- **Version** (1 byte): `0x01` for v1. Scanner checks this first. Allows format evolution.
- **QR Type** (1 byte): `0x01` = entry, `0x02` = food, `0x03` = unified. Fixed enum.
- **EventID Length** (1 byte): Length of Convex event ID string (max 255 bytes, typical ~14).
- **EventID** (variable): Raw bytes of the Convex event ID string.
- **GuestID Length** (1 byte): Length of Convex guest ID string.
- **GuestID** (variable): Raw bytes of the Convex guest ID string.
- **Timestamp** (8 bytes): uint64 big-endian, Unix epoch seconds. Creation time.
- **HMAC-SHA256** (32 bytes): Covers all preceding bytes (version through timestamp).

**Total size estimate:** 1 + 1 + 1 + ~14 + 1 + ~14 + 8 + 32 = ~72 bytes typical. Well within QR alphanumeric capacity (up to 4,296 bytes for version 40 QR).

### Encoding for QR Content
The binary payload must be encoded as a string to embed in a QR code. Options:
- **Base64URL** (recommended): ~96 characters for 72 bytes. URL-safe, no padding needed with raw encoding. Fits easily in QR alphanumeric mode.
- **Hex**: ~144 characters. Simpler but ~50% larger.

**Decision: Base64URL** — `encoding/base64.RawURLEncoding` in Go. The scanner decodes Base64URL, then parses the binary structure.

### HMAC Signing in Go

```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/binary"
)

func signPayload(data []byte, secret []byte) []byte {
    mac := hmac.New(sha256.New, secret)
    mac.Write(data)
    return mac.Sum(nil) // 32 bytes
}

func verifyPayload(data, signature, secret []byte) bool {
    expected := signPayload(data, secret)
    return hmac.Equal(expected, signature)
}
```

The existing `backend/internal/middleware/hmac.go` uses the same `crypto/hmac` + `crypto/sha256` pattern for request-level HMAC. QR payload signing reuses this approach at the data level.

### Sharing the HMAC Secret
The HMAC secret used for QR payload signing MUST be the same secret used for request-level HMAC authentication (already in `config.HMACSecret`). This is because:
1. The Go service both generates QR codes and validates scans
2. A single secret simplifies operational management
3. The signing context is different (request body vs QR payload), so there's no collision risk

---

## 2. QR Code Image Generation (yeqown/go-qrcode v2)

### Library Architecture
yeqown/go-qrcode v2 splits functionality into modules:
- `github.com/yeqown/go-qrcode/v2` — Core QR encoding
- `github.com/yeqown/go-qrcode/writer/standard` — Image writer (PNG/JPEG)

### Core API

```go
import (
    "github.com/yeqown/go-qrcode/v2"
    "github.com/yeqown/go-qrcode/writer/standard"
)

// Create QR code from data
qrc, err := qrcode.NewWith(base64Data,
    qrcode.WithEncodingMode(qrcode.EncModeByte),
    qrcode.WithErrorCorrectionLevel(qrcode.ErrorCorrectionQuart),
)
```

### Writing to bytes.Buffer (for R2 upload)
The `standard.NewWithWriter` accepts `io.WriteCloser`, enabling in-memory generation:

```go
type nopCloser struct{ io.Writer }
func (nopCloser) Close() error { return nil }

var buf bytes.Buffer
w := standard.NewWithWriter(nopCloser{&buf},
    standard.WithQRWidth(10),
    standard.WithBuiltinImageEncoder(standard.PNG_FORMAT),
    standard.WithBgColorRGBHex("#ffffff"),
    standard.WithFgColorRGBHex("#000000"),
)
if err := qrc.Save(w); err != nil { ... }
// buf.Bytes() contains PNG image data
```

### Available Writer Options
| Option | Purpose | Recommended |
|--------|---------|-------------|
| `WithQRWidth(uint8)` | Pixel width per QR block | 10 (produces ~300px image) |
| `WithBorderWidth(int...)` | Border padding | 20 (clean margin) |
| `WithBgColorRGBHex(string)` | Background color | "#ffffff" |
| `WithFgColorRGBHex(string)` | QR code color | "#000000" |
| `WithBuiltinImageEncoder(format)` | PNG or JPEG | PNG_FORMAT (lossless) |
| `WithCircleShape()` | Round QR blocks | Optional aesthetic |
| `WithLogoImage(image.Image)` | Center logo overlay | Not needed for v1 |

### Performance Considerations
- Each QR generation is CPU-bound (~1-5ms per code on modern hardware)
- For 60K guests: ~60-300 seconds if sequential
- With asynq workers (10 concurrent goroutines): ~6-30 seconds total
- Memory: each QR PNG is ~2-5KB. 60K images = ~120-300MB total bandwidth to R2

---

## 3. Cloudflare R2 Storage (AWS SDK Go v2)

### Client Configuration

```go
import (
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/credentials"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

cfg, err := config.LoadDefaultConfig(context.TODO(),
    config.WithCredentialsProvider(
        credentials.NewStaticCredentialsProvider(accessKeyId, accessKeySecret, ""),
    ),
    config.WithRegion("auto"),
)

client := s3.NewFromConfig(cfg, func(o *s3.Options) {
    o.BaseEndpoint = aws.String(
        fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountId),
    )
})
```

### Upload (PutObject)

```go
_, err := client.PutObject(ctx, &s3.PutObjectInput{
    Bucket:      aws.String(bucketName),
    Key:         aws.String(key),          // e.g., "evt123/guest456/entry.png"
    Body:        bytes.NewReader(imgBytes),
    ContentType: aws.String("image/png"),
})
```

### R2 Key Structure (from D-08)
`{eventId}/{guestId}/{entry|food|unified}.png`

Examples:
- `jd7f2g3h4k5m6n/km8n9p0q1r2s3t/entry.png`
- `jd7f2g3h4k5m6n/km8n9p0q1r2s3t/food.png`
- `jd7f2g3h4k5m6n/km8n9p0q1r2s3t/unified.png`

### Public Access via Custom Domain
R2 public bucket with custom domain (e.g., `cdn.eventarc.app`):
- Objects accessible at `https://cdn.eventarc.app/{key}`
- Automatic CDN caching at Cloudflare edge
- Zero egress fees (R2's key advantage over S3)
- Configure via Cloudflare dashboard: R2 bucket settings > Public Access > Connect Domain

### Config Requirements
New environment variables needed in `config.go`:
- `R2_ACCOUNT_ID` — Cloudflare account ID
- `R2_ACCESS_KEY_ID` — R2 API token access key
- `R2_SECRET_ACCESS_KEY` — R2 API token secret key
- `R2_BUCKET_NAME` — Bucket name (e.g., "eventarc-qr")
- `R2_PUBLIC_URL` — CDN base URL (e.g., "https://cdn.eventarc.app")

---

## 4. Background Workers (asynq)

### Architecture
asynq provides a Redis-backed task queue with:
- Task definition via `asynq.NewTask(type, payload)`
- Server with configurable concurrency
- Handler registration via `asynq.ServeMux`
- Built-in retries, scheduling, priority queues
- Web UI monitoring via `asynqmon`

### Integration with Existing Go Server
The Go server (`cmd/server/main.go`) currently runs only the HTTP server. asynq requires a separate process or goroutine for the worker:

**Option A: Separate binary** — `cmd/worker/main.go`
**Option B: Goroutine in same process** — Both HTTP server and asynq server run concurrently

**Recommendation: Option A (separate binary).** Reasons:
1. Independent scaling — can run more workers without more API servers
2. Crash isolation — worker crash doesn't take down the API
3. Clear separation of concerns
4. Docker Compose can scale `worker` service independently

### Task Design for QR Generation

**Job 1: `qr:generate-batch` (per-event bulk generation)**
- Triggered when admin clicks "Generate QR Codes"
- Payload: `{ eventId, qrStrategy, foodQrMode, foodQrTiming }`
- Handler fetches all guests for the event, then enqueues individual tasks

**Job 2: `qr:generate-single` (per-guest generation)**
- Payload: `{ eventId, guestId, guestCategoryId, qrTypes: ["entry", "food"] }`
- Handler: generates QR image(s), uploads to R2, updates guest record in Convex

### asynq Server Configuration

```go
srv := asynq.NewServer(
    asynq.RedisClientOpt{Addr: redisAddr},
    asynq.Config{
        Concurrency: 10,  // 10 concurrent workers
        Queues: map[string]int{
            "critical": 6,  // QR generation during event setup
            "default":  3,
            "low":      1,
        },
        RetryDelayFunc: asynq.DefaultRetryDelayFunc,
    },
)

mux := asynq.NewServeMux()
mux.HandleFunc("qr:generate-batch", handleGenerateBatch)
mux.HandleFunc("qr:generate-single", handleGenerateSingle)
```

### Progress Tracking
asynq's `ResultWriter` can store progress data:

```go
func handleGenerateBatch(ctx context.Context, task *asynq.Task) error {
    // Parse payload
    var p GenerateBatchPayload
    json.Unmarshal(task.Payload(), &p)
    
    // Fetch guests, enqueue individual tasks
    // Track progress via Redis key
    progressKey := fmt.Sprintf("qr:progress:%s", p.EventID)
    redis.HSet(ctx, progressKey, "total", totalGuests, "completed", 0, "status", "running")
    
    // ... enqueue individual tasks ...
    return nil
}
```

For the real-time progress bar (D-06), use a dedicated Redis hash:
- Key: `qr:progress:{eventId}`
- Fields: `total`, `completed`, `failed`, `status` (running/complete/failed)
- Each `qr:generate-single` handler increments `completed` via `HINCRBY`
- Frontend polls the Go API endpoint `GET /api/v1/qr/progress/{eventId}` which reads from Redis

### Task Aggregation
asynq supports GroupAggregator for batching tasks, but for QR generation, individual tasks are better:
- Each task is independent (one guest, one QR)
- Progress tracking per-guest is simpler
- Failure isolation — one guest's failure doesn't block others
- Retry granularity — failed individual tasks retry independently

---

## 5. Convex Integration Points

### Triggering QR Generation
Admin clicks "Generate QR Codes" on event page. Flow:
1. Frontend calls Convex action `qr.triggerGeneration({ eventId })`
2. Convex action makes HMAC-signed HTTP POST to Go: `POST /api/v1/qr/generate`
3. Go handler validates request, enqueues `qr:generate-batch` asynq task
4. Returns `{ jobId }` to Convex
5. Convex stores `jobId` on event record

### Updating Guest QR Status
After each QR is generated and uploaded:
1. Go worker calls Convex HTTP action to update guest record
2. Same HMAC-signed pattern as sync: `POST /api/v1/convex-callback` or direct Convex HTTP endpoint
3. Updates guest fields: `qrGenerated: true`, `qrUrls: { entry: "https://cdn.../entry.png", food: "https://cdn.../food.png" }`

**Alternative approach (simpler):** Instead of calling Convex per-guest, batch-update via a single Convex action after all QRs for an event are complete. The batch completion handler calls Convex once with the full list of `{ guestId, qrUrls }` pairs.

### Schema Changes Needed
The `guests` table (created in Phase 2) needs:
- `qrGenerated: v.boolean()` — default false
- `qrUrls: v.optional(v.object({ ... }))` — CDN URLs for each QR type

The `events` table needs:
- `qrGenerationStatus: v.optional(v.union(v.literal("pending"), v.literal("running"), v.literal("complete"), v.literal("failed")))`
- `qrJobId: v.optional(v.string())` — asynq job ID for progress tracking

---

## 6. QR Strategy Combinations (from D-09 through D-13)

### Matrix of QR Codes Generated Per Guest

| QR Strategy | Food QR Mode | Food QR Timing | QR Codes Generated | Notes |
|-------------|-------------|----------------|-------------------|-------|
| unified | guestLinked | preSent | 1 unified QR | Single QR for everything |
| unified | guestLinked | postEntry | 1 unified QR | Same — unified covers all |
| unified | anonymous | preSent | 1 unified QR | Anonymous irrelevant for unified |
| unified | anonymous | postEntry | 1 unified QR | Anonymous irrelevant for unified |
| separate | guestLinked | preSent | 2 QRs: entry + food | Both generated upfront |
| separate | guestLinked | postEntry | 2 QRs: entry + food | Both pre-generated; food distributed at gate |
| separate | anonymous | preSent | 2 QRs: entry + food | Food QR uses token-based tracking |
| separate | anonymous | postEntry | 2 QRs: entry + food | Food QR pre-generated, distributed at gate |

**Key insight:** All 8 combinations generate QRs at the same time (bulk generation). The `postEntry` timing only affects distribution (SMS vs physical handout), not generation timing (D-12).

### Unified QR Payload Difference
- Unified QR type `0x03` tells the scanner to check both entry AND food in one scan
- Separate QRs have distinct types (`0x01` entry, `0x02` food)
- The scanner logic (Phase 4) handles the type field differently

---

## 7. Incremental Generation (D-05)

When new guests are added after initial QR generation:
1. Guest import/creation in Convex detects `event.qrGenerationStatus === "complete"`
2. Convex triggers Go endpoint to generate QR for the new guest(s) only
3. Same `qr:generate-single` task type, just for the new guests
4. Existing QR codes remain unchanged

This means the Convex guest creation mutation needs a post-hook:
```typescript
// After guest insert, if event QR generation is already complete
if (event.qrGenerationStatus === "complete") {
    await ctx.scheduler.runAfter(0, internal.qr.triggerIncrementalGeneration, {
        eventId, guestIds: [newGuestId]
    });
}
```

---

## 8. Error Handling & Recovery

### Failure Modes
1. **QR generation failure** (library error): asynq retries with exponential backoff (3 retries default)
2. **R2 upload failure** (network/auth): Same retry. After max retries, mark guest as `qrFailed: true`
3. **Convex callback failure**: Non-blocking. QR is generated and in R2. Retry callback separately.
4. **Bulk job crash mid-way**: On restart, check which guests already have QR URLs. Only generate for missing ones. Idempotent by design.

### Idempotency
- `qr:generate-single` checks if QR already exists in R2 before generating
- R2 PutObject is naturally idempotent (overwrites same key)
- Guest `qrGenerated` flag prevents duplicate callbacks

---

## 9. Go Module Dependencies

New dependencies for Phase 3:
```
github.com/yeqown/go-qrcode/v2        # QR code generation
github.com/yeqown/go-qrcode/writer/standard  # QR image writer
github.com/hibiken/asynq              # Background task queue
github.com/aws/aws-sdk-go-v2/aws      # AWS SDK core
github.com/aws/aws-sdk-go-v2/config   # AWS SDK config
github.com/aws/aws-sdk-go-v2/credentials  # AWS SDK credentials
github.com/aws/aws-sdk-go-v2/service/s3   # S3 client (R2 compatible)
```

---

## 10. Validation Architecture

### Critical Validation Points
1. **QR payload integrity**: HMAC signature covers all data fields. Any modification invalidates the signature.
2. **QR type consistency**: QR type in payload must match event's configured QR strategy.
3. **Idempotent generation**: Re-running generation for same guest produces same R2 key (overwrite, not duplicate).
4. **Progress accuracy**: Redis HINCRBY ensures atomic counter updates even with concurrent workers.
5. **CDN URL correctness**: URLs follow deterministic pattern from eventId + guestId + type.

### Testing Strategy
- **Unit tests**: Binary payload encoding/decoding, HMAC sign/verify, QR type determination from event config
- **Integration tests**: Full pipeline — generate QR, upload to R2 (or mock), verify accessible
- **Concurrency tests**: Multiple workers generating simultaneously, verify no race conditions in progress tracking
- **Configuration matrix tests**: All 8 QR strategy combinations produce correct number and type of QR codes

---

## RESEARCH COMPLETE
