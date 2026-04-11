# Phase 3: QR Code Generation Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-11
**Phase:** 03-qr-code-generation-pipeline
**Areas discussed:** QR payload format, Generation trigger & flow, R2 storage & CDN setup, Food QR modes behavior

---

## QR Payload Format

| Option | Description | Selected |
|--------|-------------|----------|
| Guest ID + Event ID + Type + HMAC | Compact, scanner looks up details from Redis | |
| Guest ID + Event ID + Type + Timestamp + HMAC | Adds creation timestamp for replay protection and audit | ✓ |
| You decide | Claude designs optimal payload | |

**User's choice:** Guest ID + Event ID + Type + Timestamp + HMAC
**Notes:** Timestamp adds traceability and audit trail

---

| Option | Description | Selected |
|--------|-------------|----------|
| Base64-encoded JSON + HMAC suffix | Human-debuggable when decoded | |
| Compact binary format | Fixed-length binary, smallest QR, fastest parsing | ✓ |
| You decide | Claude picks | |

**User's choice:** Compact binary format

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — 1-byte version prefix | Allows payload evolution across events | ✓ |
| No versioning — locked forever | Fixed at v1, simpler but inflexible | |
| You decide | Claude picks | |

**User's choice:** Yes — 1-byte version prefix

---

## Generation Trigger & Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Admin clicks 'Generate QR Codes' | Explicit action button, admin controls timing | ✓ |
| Automatic on event activation | Auto-trigger on draft→active transition | |
| You decide | Claude picks | |

**User's choice:** Admin clicks 'Generate QR Codes'

---

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-generate for new guests | New guests get QR automatically, existing unchanged | ✓ |
| Manual re-trigger required | Admin clicks generate again | |
| You decide | Claude picks | |

**User's choice:** Auto-generate for new guests

---

| Option | Description | Selected |
|--------|-------------|----------|
| Real-time progress bar with count | "Generating: 12,847 / 60,000" with ETA | ✓ |
| Background notification only | Toast when complete, no live progress | |
| You decide | Claude picks | |

**User's choice:** Real-time progress bar with count

---

## R2 Storage & CDN Setup

| Option | Description | Selected |
|--------|-------------|----------|
| Public CDN URLs | Publicly accessible, security via HMAC not URL | ✓ |
| Signed/expiring URLs | Signed with expiration, more secure but complex | |
| You decide | Claude picks | |

**User's choice:** Public CDN URLs

---

| Option | Description | Selected |
|--------|-------------|----------|
| event-id/guest-id/type.png | Hierarchical, easy bulk delete by event | ✓ |
| Flat with composite key | All at one level, simpler | |
| You decide | Claude picks | |

**User's choice:** event-id/guest-id/type.png (hierarchical)

---

## Food QR Modes Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| One token per food category per guest slot | N tokens per guest per category | |
| Pooled tokens per category | Admin sets total pool size | |
| Other (user described) | One food QR per guest, per-category limits tracked across stalls | ✓ |

**User's choice:** One food QR per guest covering all categories. Admin sets per-category limits (1 fuchka, 2 cokes). System tracks consumption per QR across all stalls. Rejects when category limit reached.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Single food QR for all categories | One food QR, system checks per-category limits internally | ✓ |
| One QR per food category | Separate QR per food type | |
| You decide | Claude picks | |

**User's choice:** Single food QR for all categories

---

| Option | Description | Selected |
|--------|-------------|----------|
| Generated on entry scan, displayed to vendor | Food QR generated and shown at gate | |
| Generated on entry scan, sent via SMS | Food QR generated and SMS'd | |
| Other (user described) | Pre-generated in bulk, printed on bracelets/cards, handed at entry gate | ✓ |

**User's choice:** Post-entry food QR codes are pre-generated in bulk (same as pre-sent) but printed on physical bracelets or cards. Handed to guests at entry gate after scan validation.

---

## Claude's Discretion

- Exact binary payload byte layout
- QR image dimensions and visual customization
- asynq job configuration (concurrency, retry, priority)
- R2 bucket configuration
- Batch size for generation workers
- Progress tracking mechanism details

## Deferred Ideas

None — discussion stayed within phase scope
