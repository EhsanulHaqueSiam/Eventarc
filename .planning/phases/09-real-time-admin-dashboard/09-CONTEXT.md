# Phase 9: Real-Time Admin Dashboard - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Live admin dashboard displaying event metrics in real-time via Server-Sent Events (SSE). Attendance counters, food consumption per stall and category, vendor activity rates, system health alerts. Reads only from atomic Redis counters — never queries scan tables for aggregation. SSE auto-reconnects on connection loss. No new scan logic (Phase 4/5 already handles that).

Requirements: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06

</domain>

<decisions>
## Implementation Decisions

### Dashboard Design
- **D-01:** Claude's discretion on dashboard layout, metrics presentation, and visualizations. Should implement all 6 DASH requirements: live attendance, food consumption metrics, vendor activity monitor, alerts, counter-only reads, SSE with auto-reconnect.

### SSE Implementation
- **D-02:** Go SSE endpoint in the microservice reads Redis counters and pub/sub events, pushes to connected admin clients. Auto-reconnects on loss (standard SSE behavior via EventSource API).
- **D-03:** Redis pub/sub for real-time scan event broadcasting. Each scan publishes to a channel, SSE handler subscribes and pushes to connected dashboards.

### Claude's Discretion
Claude has full flexibility on: dashboard layout and component design, metric card styling, chart types (if any), alert thresholds, SSE event format, refresh intervals for counters, Redis pub/sub channel naming, alert severity levels.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Upstream Dependencies
- `.planning/phases/04-scan-processing-core/04-CONTEXT.md` — Redis atomic counters (HINCRBY), counter re-seeding strategy
- `.planning/phases/05-food-scan-rules-engine/05-CONTEXT.md` — Food consumption counters across stalls
- `.planning/phases/06-vendor-scanning-interface/06-CONTEXT.md` — Admin session monitoring (D-09: scan rate + status)
- CLAUDE.md — SSE for dashboard (unidirectional), Redis Pub/Sub for broadcasting

### External Documentation
- Server-Sent Events specification — EventSource API, reconnection
- Redis Pub/Sub — subscribe patterns, message broadcasting

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 6 admin session monitoring — similar real-time status display pattern
- Redis counter keys established in Phase 4/5 — dashboard reads these
- Frontend event detail page — dashboard integrates as a tab or separate "Live" view

### Integration Points
- New Go SSE endpoint: GET /api/v1/events/:id/live (admin only)
- Frontend connects via EventSource, updates TanStack Query cache on events
- Redis pub/sub channels per event for scan broadcasts

</code_context>

<specifics>
## Specific Ideas

- Dashboard reads Redis counters only (DASH-05) — never COUNT(*) on scan tables
- SSE chosen over WebSocket because dashboard is server-to-client only (CLAUDE.md decision)
- Admin session monitoring from Phase 6 feeds into the vendor activity section

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-real-time-admin-dashboard*
*Context gathered: 2026-04-12*
