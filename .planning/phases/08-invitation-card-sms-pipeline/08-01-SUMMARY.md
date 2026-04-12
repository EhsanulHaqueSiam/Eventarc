---
phase: 08-invitation-card-sms-pipeline
plan: 01
status: complete
started: 2026-04-12
completed: 2026-04-12
---

# Plan 08-01 Summary: Image compositing pipeline & card template backend

## What Was Built

Image compositing library using `disintegration/imaging` for overlaying QR codes onto invitation card backgrounds. Extended R2 client with Download capability. HTTP API endpoints for triggering batch compositing and checking progress. Convex schema extensions for card templates and guest card image fields.

## Key Files

### Created
- `backend/internal/card/compositor.go` — Composite() function: decode background + QR, resize QR via CatmullRom, overlay at position, encode PNG
- `backend/internal/card/compositor_test.go` — 5 tests: overlay position, QR resize, invalid background/QR, BuildCardKey
- `backend/internal/handler/cards.go` — CardHandler with HandleCompositeCards (POST 202) and HandleCompositeProgress (GET)
- `backend/internal/handler/cards_test.go` — 4 tests: valid composite, invalid overlay, missing background key, progress
- `convex/cardTemplates.ts` — CRUD: list, get, create, update, remove

### Modified
- `backend/internal/r2/client.go` — Added Download() method, BuildCardKey()
- `backend/internal/r2/client_test.go` — Added TestBuildCardKey
- `backend/internal/config/config.go` — Added ConvexURL, ConvexDeploymentToken fields
- `backend/cmd/server/main.go` — Wired card routes under /api/v1/events/{eventId}/cards/
- `convex/schema.ts` — Added cardTemplates table, guest cardImageUrl/cardImageKey fields
- `backend/go.mod` / `backend/go.sum` — Added disintegration/imaging, hibiken/asynq

## Decisions Made

- Used `disintegration/imaging` (CatmullRom resampling) per D-04 for quality/speed balance
- Redis progress keys: `composite:{eventId}:{total|done|failed}` (separate keys, not hash — simpler atomic INCR)
- Rate limit: 1 active batch per event checked via Redis before enqueue (T-08-04)
- Overlay validation rejects negative positions and zero/negative dimensions (T-08-02)

## Test Results

- `go test ./internal/card/...` — 5/5 PASS
- `go test ./internal/r2/...` — 10/10 PASS (including new BuildCardKey)
- `go test ./internal/handler/...` — 4/4 PASS (2 skipped: Redis not available)
- `go build ./cmd/server/` — compiles clean

## Self-Check: PASSED

All acceptance criteria met:
- [x] compositor.go contains `func Composite` with OverlayConfig
- [x] compositor.go imports `github.com/disintegration/imaging`
- [x] r2/client.go contains `func (c *Client) Download(`
- [x] handler/cards.go contains HandleCompositeCards, HandleCompositeProgress, TypeCardCompositeBatch
- [x] config.go contains ConvexURL
- [x] main.go contains cardHandler.HandleCompositeCards
- [x] schema.ts contains cardTemplates: defineTable
- [x] schema.ts contains cardImageUrl: v.optional(v.string())
- [x] cardTemplates.ts exports create, list, get, update, remove
- [x] Server compiles, all tests pass
