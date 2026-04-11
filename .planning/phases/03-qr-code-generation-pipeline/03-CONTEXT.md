# Phase 3: QR Code Generation Pipeline - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Generate unique, HMAC-signed QR code images for every guest in an event. Store images in Cloudflare R2, serve via CDN. Support all configuration combinations: unified vs separate QR strategy, guest-linked vs anonymous food mode, pre-sent vs post-entry food timing. Background async generation via asynq workers in the Go microservice. No invitation cards, no SMS delivery, no scan processing — those are later phases.

Requirements: QRCD-01, QRCD-02, QRCD-03, QRCD-04, QRCD-05, QRCD-06, INFR-05

</domain>

<decisions>
## Implementation Decisions

### QR Payload Format (LOCKED — cannot change after cards are generated)
- **D-01:** Payload structure: 1-byte version prefix + guestId + eventId + qrType (entry/food/unified) + creation timestamp (unix epoch) + HMAC-SHA256 signature. Compact binary format, not JSON.
- **D-02:** Compact binary encoding with fixed-length fields. No base64 JSON — raw binary for smallest possible QR code and fastest parsing. Claude designs the exact byte layout.
- **D-03:** 1-byte version prefix as first byte of payload. Scanner checks version and parses accordingly. Allows payload format evolution across events without invalidating older QR codes.

### Generation Trigger & Flow
- **D-04:** Admin explicitly triggers QR generation by clicking a "Generate QR Codes" button on the event page. No automatic generation on event state transitions.
- **D-05:** Incremental auto-generation: when new guests are added after initial generation (import or manual add), their QR codes are generated automatically. Existing QR codes remain unchanged.
- **D-06:** Real-time progress bar during generation showing "Generating: 12,847 / 60,000" with estimated time remaining. Admin can navigate away and return — progress persists via asynq job status.

### R2 Storage & CDN
- **D-07:** Public CDN URLs for QR images. No signed/expiring URLs. Security relies on QR payload HMAC (the scan validates the cryptographic signature), not URL secrecy. Simplest delivery for SMS links.
- **D-08:** Hierarchical R2 key structure: `{eventId}/{guestId}/{entry|food|unified}.png`. Easy to list all QR codes for an event or guest. Easy bulk delete by event prefix.

### Food QR Modes
- **D-09:** In both guest-linked and anonymous modes, each guest gets ONE food QR code that covers ALL food categories. Admin sets per-category limits (e.g., 1 fuchka, 2 cokes). The QR is scanned at any food stall, and the system tracks consumption per QR token across all stalls per category. When category limit is reached, scan is rejected regardless of stall.
- **D-10:** Guest-linked vs anonymous difference: guest-linked ties the food QR to a specific person (system knows WHO ate what). Anonymous ties it to a token (system knows the TOKEN's consumption but not who holds it).
- **D-11:** For "separate" QR strategy: guest gets 2 QR codes total — one entry QR + one food QR. The food QR is a single code covering all food categories (not one QR per category).
- **D-12:** For "post-entry" food QR timing: food QR codes are still pre-generated in bulk before the event (same as pre-sent), but instead of being sent via SMS, they are printed on physical bracelets or cards and handed to guests at the entry gate after entry scan is validated. The system generates them — physical printing is outside system scope.
- **D-13:** For "pre-sent" food QR timing: food QR codes are generated alongside entry QR codes and included in the SMS invitation (Phase 8 handles the actual SMS delivery).

### Claude's Discretion
Claude has flexibility on: exact binary payload byte layout (D-02), QR image dimensions and visual customization, asynq job configuration (concurrency, retry policy, priority), R2 bucket configuration, batch size for generation workers, progress tracking mechanism details.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Architecture
- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — Full v1 requirements (QRCD-01 through QRCD-06, INFR-05)
- `.planning/ROADMAP.md` — Phase details, success criteria, dependency graph

### Upstream Dependencies
- `.planning/phases/01-foundation-domain-model/01-CONTEXT.md` — Go microservice scaffold, HMAC authentication, Redis setup
- `.planning/phases/01-foundation-domain-model/01-RESEARCH.md` — Go project structure, asynq setup, yeqown/go-qrcode v2 patterns
- `.planning/phases/02-guest-management/02-CONTEXT.md` — Guest data model, phone format (BD only), lifecycle states
- `convex/schema.ts` — Existing Convex schema (events with config.qrStrategy/foodQrMode/foodQrTiming)
- `backend/internal/` — Go microservice internal packages

### External Documentation (researcher should fetch latest)
- yeqown/go-qrcode v2 API documentation — QR generation, customization options
- Cloudflare R2 S3-compatible API — bucket creation, object upload, public access configuration
- asynq documentation — task definition, handler registration, progress tracking, web UI
- HMAC-SHA256 in Go (crypto/hmac) — signing and verification patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/internal/middleware/hmac.go` — HMAC verification middleware (same signing scheme for QR payload)
- `backend/internal/config/config.go` — Environment-based config (add R2 credentials, HMAC secret)
- `backend/cmd/server/main.go` — Server entrypoint (add asynq worker initialization)
- `convex/events.ts` — Event queries (read QR config: qrStrategy, foodQrMode, foodQrTiming)

### Established Patterns
- Go chi router with middleware composition
- slog structured logging with request context
- Domain error types in `model/errors.go`
- Convex mutations with auth checks

### Integration Points
- Go microservice needs new asynq worker process for background QR generation
- Convex needs to trigger Go QR generation via HTTP action (same HMAC-signed pattern as sync)
- R2 upload happens from Go workers (S3-compatible SDK)
- Frontend needs QR generation status display (real-time progress from asynq job state)
- Guest records in Convex need `qrGenerated: boolean` and `qrUrls` fields

</code_context>

<specifics>
## Specific Ideas

- QR payload is LOCKED once generated — version byte allows future evolution without invalidating existing codes
- Compact binary format chosen for smallest QR code size and fastest scan-time parsing
- Post-entry food QR is still pre-generated (not generated on the fly at entry) — it's physically distributed at the gate via bracelets/cards, not sent via SMS
- Anonymous mode still tracks per-token consumption across stalls — it's not truly anonymous in the "no tracking" sense, just "not tied to a person"
- One food QR per guest regardless of category count — keeps guest's QR count to maximum 2 (entry + food in separate mode, or 1 in unified mode)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-qr-code-generation-pipeline*
*Context gathered: 2026-04-11*
