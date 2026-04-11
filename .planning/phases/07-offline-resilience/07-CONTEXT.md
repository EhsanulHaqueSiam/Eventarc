# Phase 7: Offline Resilience - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Add offline resilience to the vendor scanning interface. When network drops, scans are queued locally in IndexedDB with idempotency keys. On reconnect, queued scans are re-validated sequentially against current server state. Retroactively rejected scans notify the vendor. Brief safety net (minutes), not sustained operation. 30-minute retention window.

Requirements: OFFL-01, OFFL-02, OFFL-03, OFFL-04, OFFL-05

</domain>

<decisions>
## Implementation Decisions

### Offline Scan Behavior
- **D-01:** When offline, confirmed scans show a clear "Scan Queued — will validate when online" state. No green checkmark, no optimistic approval. Vendor knows it's not confirmed.
- **D-02:** No client-side limit tracking while offline. All scans are queued without local limit checks. Server validates everything on reconnect. Simpler implementation, acceptable because offline is a brief safety net.
- **D-03:** Persistent "X scans pending" indicator visible on the scanner UI while operating offline (OFFL-05 requirement).

### Sync & Re-validation
- **D-04:** Queued scans processed sequentially in timestamp order on reconnect. Each scan validated against current server state. Failed ones marked as rejected.
- **D-05:** Retroactively rejected scans show a persistent toast notification with details: "Scan rejected retroactively: Guest X — fuchka limit reached while offline". Vendor acknowledges to dismiss.
- **D-06:** Idempotency keys generated client-side before queueing (same INSERT ON CONFLICT pattern from Phase 4). Prevents double-counting on sync retries (OFFL-05).

### Offline Data Model
- **D-07:** 30-minute retention window for queued scans in IndexedDB. Scans older than 30 minutes are auto-deleted. Offline is a brief safety net — 30+ minutes offline indicates a serious problem.
- **D-08:** Claude's discretion on IndexedDB schema structure. Should store: scan payload, idempotency key, timestamp, scan type (entry/food), stall info, sync status (pending/synced/rejected).

### Claude's Discretion
Claude has flexibility on: IndexedDB schema design (D-08), network detection mechanism (navigator.onLine vs WebSocket heartbeat), sync retry strategy, offline indicator UI design, queued scan list display, cleanup scheduling.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Architecture
- `.planning/PROJECT.md` — Core value (zero data loss, zero double-counting)
- `.planning/REQUIREMENTS.md` — OFFL-01 through OFFL-05
- `.planning/ROADMAP.md` — Phase 7 success criteria

### Upstream Dependencies
- `.planning/phases/04-scan-processing-core/04-CONTEXT.md` — Idempotency keys, INSERT ON CONFLICT pattern (D-06)
- `.planning/phases/06-vendor-scanning-interface/06-CONTEXT.md` — Scanner UI, two-step confirm flow (D-02), device sessions (D-04)
- `frontend/src/routes/scanner/` — Existing scanner UI from Phase 6

### External Documentation (researcher should fetch latest)
- IndexedDB API documentation — storage, transactions, cursor operations
- Service Worker / navigator.onLine — network detection approaches
- Dexie.js or idb — IndexedDB wrapper library options

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 6 scanner UI — add offline state management layer
- Phase 4 idempotency key pattern — same key format for offline-generated keys
- Zustand scanner state store — extend with offline queue state

### Integration Points
- Scanner component needs offline detection + queue management
- Sync endpoint (existing scan endpoints) handles queued scans on reconnect
- Vendor UI shows pending count indicator + toast notifications for rejections

</code_context>

<specifics>
## Specific Ideas

- Clear "queued" state (not optimistic approval) — honest UX, vendor knows status
- Sequential processing on reconnect — preserves temporal ordering of scans
- 30-minute window — aggressive cleanup aligns with "brief safety net" philosophy
- Toast notifications for retroactive rejections — vendor needs to know what was reversed
- No client-side limit tracking — keeps offline logic simple, server is the authority

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-offline-resilience*
*Context gathered: 2026-04-12*
