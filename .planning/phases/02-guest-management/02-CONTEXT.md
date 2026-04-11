# Phase 2: Guest Management - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin populates events with up to 60K guests through bulk CSV/Excel import or manual entry. System handles duplicate detection (intra-file and against DB), search/filtering at scale via Convex search indexes, and lifecycle status tracking per guest per event. No QR generation, no scanning, no invitation sending — those are later phases.

Requirements: GUST-01, GUST-02, GUST-03, GUST-04, GUST-05

</domain>

<decisions>
## Implementation Decisions

### Bulk Import Flow
- **D-01:** Step-by-step wizard: 1) Upload file, 2) Preview rows + map columns, 3) Review validation errors, 4) Resolve duplicates, 5) Confirm import.
- **D-02:** Client-side CSV/Excel parsing (instant preview in browser), server-side validation and insert via Convex mutations.
- **D-03:** Validation errors shown as error summary with counts by error type, plus a downloadable CSV of failed rows with error details. Admin fixes CSV and re-imports failed rows.
- **D-04:** Claude's discretion on batch processing strategy for 60K rows (chunked uploads with progress bar vs all-at-once). Should consider Convex mutation limits.

### Duplicate Resolution
- **D-05:** Duplicates detected both intra-file (within the uploaded CSV itself) and against existing guests in the event database. Detection is by phone number.
- **D-06:** Separate "Resolve Duplicates" step in the import wizard. All duplicates listed in one view before final import.
- **D-07:** Three resolution actions per duplicate: Skip (ignore new row), Replace (overwrite existing with new data), Keep Both (create second entry).
- **D-08:** Bulk resolution shortcuts: "Skip All" / "Replace All" buttons at top, with per-row individual override. Admin can bulk-skip then individually replace important ones.

### Search & Filtering
- **D-09:** Use Convex built-in search indexes for full-text search on guest name and phone number. No external search service.
- **D-10:** Filter dimensions: guest category (dropdown), lifecycle status (tabs or chips), and free-text search on name/phone. Three dimensions — no custom tags.
- **D-11:** Paginated table display (e.g., 50 per page). Classic pagination with page numbers. Server-side search + filter.

### Guest Data Model
- **D-12:** Minimal guest fields: name (string, required), phone (string, required), categoryId (reference to guestCategories), status (lifecycle enum). No email, no notes, no custom tags.
- **D-13:** Phone number validation: Bangladesh format only — accepts 01XXXXXXXXX or +8801XXXXXXXXX. Reject international/non-BD formats.
- **D-14:** Guest lifecycle states: invited, smsSent, smsDelivered, checkedIn. "Not arrived" is derived (guest status is not checkedIn AND event status is completed), not stored as an explicit state.

### Claude's Discretion
Claude has flexibility on: batch processing strategy for large imports (D-04), Convex search index configuration, pagination page size, column mapping UI details, wizard step transitions, client-side CSV parsing library choice.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Architecture
- `.planning/PROJECT.md` — Core value, constraints, key decisions (hybrid Convex + Go architecture)
- `.planning/REQUIREMENTS.md` — Full v1 requirements with traceability to phases
- `.planning/ROADMAP.md` — Phase details, success criteria, and dependency graph

### Phase 1 Foundation (upstream dependency)
- `.planning/phases/01-foundation-domain-model/01-CONTEXT.md` — Phase 1 decisions including Convex schema conventions, guest category model (D-10, D-11)
- `.planning/phases/01-foundation-domain-model/01-RESEARCH.md` — Convex schema patterns, Better Auth setup, established conventions
- `convex/schema.ts` — Existing Convex schema (events, guestCategories, vendorTypes, vendorCategories, stalls)
- `convex/categories.ts` — Guest category CRUD patterns to follow

### External Documentation (researcher should fetch latest)
- Convex search indexes documentation — search index configuration, full-text search capabilities and limits
- Convex pagination documentation — cursor-based pagination patterns for large datasets
- SheetJS (xlsx) or Papa Parse — client-side CSV/Excel parsing library options

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/schema.ts` — Existing schema to extend with guests table
- `convex/categories.ts` — CRUD mutation patterns (create, update, delete with validation) to replicate for guests
- `convex/model/events.ts` — Business logic helper pattern (thin public functions + model helpers)
- `frontend/src/components/events/` — Event CRUD components as UI pattern reference
- `frontend/src/components/layout/` — App shell, sidebar navigation for adding guest management pages

### Established Patterns
- Convex mutations for CRUD with auth checks (`ctx.auth.getUserIdentity()`)
- camelCase Convex fields, separate model/ directory for business logic
- shadcn/ui components (Table, Dialog, Button, Tabs) for UI
- TanStack Router file-based routing for page structure

### Integration Points
- Guest table needs `eventId: v.id("events")` and `categoryId: v.id("guestCategories")` references
- Guest management pages integrate into existing sidebar navigation
- Import wizard is a new route under events (e.g., `/events/$eventId/import`)
- Search must use Convex `searchIndex` on the guests table

</code_context>

<specifics>
## Specific Ideas

- Phone validation is Bangladesh-specific (01XXXXXXXXX or +8801XXXXXXXXX) — this is the primary market
- "Not arrived" status is derived, not stored — simplifies the state machine and avoids bulk state transitions after events end
- Import wizard has 5 steps including a dedicated duplicate resolution step — duplicates are not buried in error reports
- Bulk resolve shortcuts (Skip All / Replace All) are essential given potential for hundreds of duplicates in 60K imports
- Client-side parsing means instant preview — admin doesn't wait for server round-trip to see their data

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-guest-management*
*Context gathered: 2026-04-11*
