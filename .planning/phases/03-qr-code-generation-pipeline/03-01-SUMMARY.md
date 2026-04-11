---
phase: 03-qr-code-generation-pipeline
plan: 01
subsystem: backend/qr-generation
tags: [qr, hmac, r2, go]
key-files:
  created:
    - backend/internal/qr/payload.go
    - backend/internal/qr/payload_test.go
    - backend/internal/qr/generator.go
    - backend/internal/qr/generator_test.go
    - backend/internal/r2/client.go
    - backend/internal/r2/client_test.go
  modified:
    - backend/internal/config/config.go
    - backend/go.mod
    - backend/go.sum
    - .env.example
metrics:
  tasks: 3
  commits: 3
  tests_added: 27
  tests_passing: 27
---

# Plan 03-01 Summary: QR Payload, Image Generation, R2 Client

## What was built

Three core Go packages for the QR code generation pipeline:

1. **QR Payload Binary Format** (`backend/internal/qr/payload.go`): Compact binary encoding with version prefix, variable-length Convex ID fields, uint64 timestamp, and HMAC-SHA256 signature. Base64URL output for QR content embedding. DetermineQRTypes maps all event config combinations to correct QR type arrays.

2. **QR Image Generator** (`backend/internal/qr/generator.go`): In-memory PNG generation using yeqown/go-qrcode v2 with configurable dimensions, colors, and border. GenerateGuestQRCodes orchestrates payload encoding + image generation for all QR types per guest.

3. **Cloudflare R2 Client** (`backend/internal/r2/client.go`): S3-compatible client using aws-sdk-go-v2 with PutObject upload, hierarchical key construction ({eventId}/{guestId}/{type}.png), and CDN URL generation.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 6657050 | QR payload binary encoding with HMAC-SHA256 signing |
| 2 | 88cc2e2 | QR code image generation with yeqown/go-qrcode v2 |
| 3 | c04ad8b | Cloudflare R2 storage client and config extension |

## Deviations

None. All tasks executed as planned.

## Self-Check: PASSED

- [x] All 3 tasks executed
- [x] Each task committed individually
- [x] 27 tests added, all passing
- [x] Race detector clean (`go test ./... -race` passes)
- [x] All acceptance criteria from plan verified
- [x] Config extended with R2 credentials
- [x] .env.example updated with R2 placeholders
