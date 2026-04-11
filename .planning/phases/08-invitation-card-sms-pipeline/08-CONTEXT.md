# Phase 8: Invitation Card Editor & SMS Pipeline - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Visual drag-drop card editor (Fabric.js) for positioning QR overlay on invitation designs. 60K image compositing pipeline via Go asynq workers (Go stdlib image/draw). Composite images stored in R2 via CDN. Bulk SMS delivery with provider abstraction (SMS.NET.BD initial), throttling, per-guest delivery status tracking, retry on failure. Card templates saveable and reusable across events.

Requirements: INVT-01, INVT-02, INVT-03, INVT-04, INVT-05, INVT-06

</domain>

<decisions>
## Implementation Decisions

### Card Editor
- **D-01:** Fabric.js canvas-based drag-drop editor. Admin uploads a design image, positions and resizes QR code overlay with transform handles (resize, drag). Live preview of final composite.
- **D-02:** Card templates are saveable and reusable across events. Admin saves a card design (background image + QR position/size config) as a named template. Can apply to future events.
- **D-03:** Claude's discretion on editor UI details (toolbar, zoom, undo, export preview).

### Compositing Pipeline
- **D-04:** Claude's discretion on compositing approach. Go stdlib image/draw is the baseline (no external dependencies). If performance is insufficient for 60K images, escalate to libvips. Crash recovery via asynq job state.
- **D-05:** Progress tracking same pattern as Phase 3 QR generation: real-time progress bar with count and ETA. Admin can navigate away and return.

### SMS Delivery
- **D-06:** SMS provider abstracted behind a Go interface. Start with SMS.NET.BD implementation. Interface makes provider swappable without code changes beyond the adapter.
- **D-07:** Claude's discretion on throttling strategy (rate limiting to avoid carrier spam detection), retry logic (exponential backoff for failures), delivery status webhook handling.
- **D-08:** Per-guest SMS status tracking: queued, sent, delivered, failed. Stored in Convex. Admin sees status per guest.

### Claude's Discretion
Claude has flexibility on: editor UI details (D-03), compositing library choice (D-04), SMS throttling rates (D-07), batch sizes, SMS message template format, image quality/format settings, composite image naming in R2.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Upstream Dependencies
- `.planning/phases/03-qr-code-generation-pipeline/03-CONTEXT.md` — QR images in R2, hierarchical key structure (D-08), CDN URLs
- `.planning/phases/02-guest-management/02-CONTEXT.md` — Guest data model, phone number format (BD)
- `convex/schema.ts` — Guest records for SMS delivery targeting
- CLAUDE.md — Fabric.js for card editor, Go stdlib image/draw, Cloudflare R2, SMS.NET.BD

### External Documentation (researcher should fetch latest)
- Fabric.js documentation — canvas editor, object transforms, serialization
- SMS.NET.BD API documentation — REST API, delivery webhooks, rate limits
- Go image/draw package — compositing, scaling operations

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 3 asynq job pattern — same batch processing for image compositing
- Phase 3 R2 upload pattern — same SDK for composite image upload
- Phase 3 progress tracking — same real-time pattern

### Integration Points
- Card editor is a new frontend route (/events/$eventId/cards)
- Compositing pipeline triggers after QR generation (Phase 3) completes
- SMS delivery reads guest phone numbers from Convex
- SMS status updates write back to Convex guest records

</code_context>

<specifics>
## Specific Ideas

- SMS provider is abstracted because Bangladesh market may require switching providers based on rates/reliability
- Card templates save time for recurring events (same organization hosting monthly events)
- Go stdlib image/draw is sufficient for overlay compositing — libvips only if benchmarks show bottleneck

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-invitation-card-sms-pipeline*
*Context gathered: 2026-04-12*
