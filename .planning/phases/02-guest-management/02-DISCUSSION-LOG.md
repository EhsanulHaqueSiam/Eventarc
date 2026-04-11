# Phase 2: Guest Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-11
**Phase:** 02-guest-management
**Areas discussed:** Bulk import flow, Duplicate resolution, Search & filtering at scale, Guest data model

---

## Bulk Import Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Step-by-step wizard | Multi-step flow: Upload, Preview+Map, Errors, Duplicates, Confirm | ✓ |
| Single-page inline | Everything on one page with auto-detect and inline errors | |
| You decide | Claude picks | |

**User's choice:** Step-by-step wizard
**Notes:** Clear progress indicators at each step preferred

---

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side parsing + server-side validation | Parse CSV/Excel in browser, send to Convex for validation | ✓ |
| Full server-side processing | Upload raw file, server handles everything | |
| You decide | Claude picks | |

**User's choice:** Client-side parsing + server-side validation
**Notes:** Instant preview without waiting for upload

---

| Option | Description | Selected |
|--------|-------------|----------|
| Error summary + downloadable report | Summary with breakdown + downloadable CSV of failed rows | ✓ |
| Inline error table with fix-in-place | Scrollable error table with inline editing | |
| You decide | Claude picks | |

**User's choice:** Error summary + downloadable report
**Notes:** Admin fixes CSV and re-imports failed rows

---

| Option | Description | Selected |
|--------|-------------|----------|
| Batched with progress bar | Chunks of 500, progress bar, cancel mid-import | |
| All-at-once with loading state | Send all rows, spinner | |
| You decide | Claude picks based on Convex limits | ✓ |

**User's choice:** You decide (Claude's discretion)
**Notes:** Claude should consider Convex mutation rate limits for batch strategy

---

## Duplicate Resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Separate review step in wizard | Dedicated step listing all conflicts with per-duplicate actions | ✓ |
| Grouped in error report | Duplicates as error category in summary/report | |
| You decide | Claude picks | |

**User's choice:** Separate review step in wizard

---

| Option | Description | Selected |
|--------|-------------|----------|
| Skip, Replace, or Keep Both | Three actions per duplicate: flexible | ✓ |
| Skip or Replace only | Two actions: simpler, one phone = one guest | |
| You decide | Claude picks | |

**User's choice:** Skip, Replace, or Keep Both

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, both intra-file and against DB | Detect within CSV and against existing guests | ✓ |
| Only against existing DB records | Only match against database | |
| You decide | Claude picks | |

**User's choice:** Yes, both intra-file and against DB

---

| Option | Description | Selected |
|--------|-------------|----------|
| Bulk actions + individual override | Skip All / Replace All buttons plus per-row override | ✓ |
| Individual only | Each duplicate resolved one by one | |
| You decide | Claude picks | |

**User's choice:** Bulk actions + individual override

---

## Search & Filtering at Scale

| Option | Description | Selected |
|--------|-------------|----------|
| Convex search indexes | Built-in full-text search, no external service | ✓ |
| Client-side filtering with pagination | Load paginated, filter client-side | |
| You decide | Claude picks | |

**User's choice:** Convex search indexes

---

| Option | Description | Selected |
|--------|-------------|----------|
| Category + Status + Search | Three filter dimensions | |
| Category + Status + Search + Custom tags | Four dimensions with tag management | Initially selected |
| You decide | Claude picks | |

**User's choice:** Initially selected Custom tags, then dropped after conflict with minimal guest model → **Category + Status + Search** (three dimensions)
**Notes:** Conflict resolved: user wanted minimal guest fields, so custom tags filter was dropped

---

| Option | Description | Selected |
|--------|-------------|----------|
| Paginated table | Classic table with page numbers, 50 per page | ✓ |
| Virtual-scrolled table | Infinite scroll with on-demand loading | |
| You decide | Claude picks | |

**User's choice:** Paginated table

---

## Guest Data Model

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal — name, phone, category, status | Just what's needed for QR and scanning | ✓ |
| Extended — add email, notes, custom tags | More useful for coordinators | |
| You decide | Claude picks | |

**User's choice:** Minimal

---

| Option | Description | Selected |
|--------|-------------|----------|
| Bangladesh format only | 01XXXXXXXXX or +8801XXXXXXXXX | ✓ |
| International with country code | E.164 format, any country | |
| You decide | Claude picks | |

**User's choice:** Bangladesh format only

---

| Option | Description | Selected |
|--------|-------------|----------|
| Derived — not arrived = invited + event completed | Computed status, no explicit transition | ✓ |
| Explicit state after event ends | System marks unchecked guests explicitly | |
| You decide | Claude picks | |

**User's choice:** Derived

---

## Claude's Discretion

- Batch processing strategy for 60K row imports (chunked vs all-at-once)
- Convex search index configuration details
- Pagination page size
- Column mapping UI details
- Wizard step transition animations/UX
- Client-side CSV parsing library choice

## Deferred Ideas

None — discussion stayed within phase scope
