# Phase 5: Food Scan & Rules Engine - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement food scan processing with per-person and per-category consumption limits enforced across all stalls in real-time. Admin configures food rules via a matrix (guest categories x food categories). Supports guest-linked mode (per-person tracking) and anonymous mode (per-token tracking with same rules). Redis Lua scripts for atomic check-and-increment. No vendor UI (Phase 6), no offline handling (Phase 7).

Requirements: SCAN-03, FOOD-01, FOOD-02, FOOD-03, FOOD-04

</domain>

<decisions>
## Implementation Decisions

### Food Rules Configuration
- **D-01:** Admin configures food rules via a matrix table: rows are guest categories (VIP, General, Staff), columns are food categories (fuchka, coke, biryani). Admin fills in the limit at each intersection.
- **D-02:** Limits support both numeric values AND an "unlimited" option. Unlimited means no enforcement for that food category for that guest category. Useful for items like water or bread.

### Cross-Stall Enforcement
- **D-03:** Claude's discretion on Redis data structures for per-guest-per-category consumption tracking. Should be optimized for 10K concurrent cross-stall reads/writes.
- **D-04:** Food scan check-and-increment uses a Redis Lua script for single atomic operation: read current count, check against limit, increment if allowed, return result. No race condition possible between read and write. Zero tolerance for over-serving.

### Anonymous Mode Mechanics
- **D-05:** Claude's discretion on token ID format (QR payload hash vs separate UUID). Should align with the Phase 3 compact binary payload format.
- **D-06:** Anonymous tokens use the same food rules matrix as guest-linked mode. When an anonymous QR is generated, it inherits the limits of the guest category it was assigned to. No separate "anonymous limits" configuration.

### Food Scan Response
- **D-07:** Successful food scan returns: food category scanned, current consumption count, remaining allowance (e.g., "fuchka: 1/3 used, 2 remaining"). Vendor sees the full picture.
- **D-08:** Rejected food scan (limit reached) shows consumption history: which stalls the guest already consumed this category at, with timestamps (e.g., "fuchka limit reached (1/1). Consumed at: fuchka-stall-2 at 2:30 PM"). Helps vendor explain to guest.

### Claude's Discretion
Claude has flexibility on: Redis data structure for consumption tracking (D-03), token ID format for anonymous mode (D-05), food rules storage model in Convex, Lua script implementation details, food scan endpoint error codes, consumption history depth/format.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Architecture
- `.planning/PROJECT.md` — Core value (zero race conditions at scale)
- `.planning/REQUIREMENTS.md` — SCAN-03, FOOD-01 through FOOD-04
- `.planning/ROADMAP.md` — Phase 5 success criteria, dependency graph

### Upstream Dependencies
- `.planning/phases/01-foundation-domain-model/01-CONTEXT.md` — Go microservice, Redis setup, guest categories (D-10/D-11), vendor hierarchy (VNDR-01)
- `.planning/phases/03-qr-code-generation-pipeline/03-CONTEXT.md` — Food QR modes (D-09: single food QR, D-10: guest-linked vs anonymous, D-12: post-entry distribution)
- `.planning/phases/04-scan-processing-core/04-CONTEXT.md` — Entry scan pipeline (dual-write, Redis-first, atomic counters, load testing approach)
- `.planning/phases/04-scan-processing-core/04-RESEARCH.md` — Redis Lua script patterns, asynq workers, counter reconciliation
- `backend/internal/handler/` — Existing scan handler patterns from Phase 4
- `convex/schema.ts` — Existing schema (events config, guestCategories, vendorCategories, stalls)

### External Documentation (researcher should fetch latest)
- Redis Lua scripting (EVAL/EVALSHA) — atomic multi-step operations
- Redis HGETALL/HINCRBY — hash operations for consumption tracking

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 4 entry scan handler — same dual-write pattern (Redis-first, PG background retry)
- Phase 4 Redis Lua script pattern — extend for food consumption check-and-increment
- Phase 4 asynq workers — same PG write retry pattern for food scan records
- `convex/schema.ts` — guestCategories table already exists, extend with food rules

### Established Patterns
- Redis Lua atomic operations (Phase 4 entry scan)
- Scan endpoint JSON response format (success/error envelopes from Phase 4)
- Consumption counter pattern (HINCRBY from Phase 4 entry counters)

### Integration Points
- `POST /api/v1/scan/food` — food scan endpoint to implement
- Convex needs new `foodRules` table or nested config (rules matrix)
- Redis consumption tracking keys alongside entry scan keys
- Food rules need to be synced to Redis (same go-live sync pattern as event data)
- Vendor scanner UI (Phase 6) will consume the food scan response

</code_context>

<specifics>
## Specific Ideas

- Matrix table for food rules is the most visual way to configure limits across guest categories x food categories
- Unlimited option prevents unnecessary tracking overhead for abundant items
- Lua script atomicity is non-negotiable — the entire read-check-increment must be one Redis operation
- Consumption history in rejection response is valuable for large events where guests may forget which stalls they visited
- Anonymous mode inherits the same rules matrix — no separate configuration, just different tracking identity

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-food-scan-rules-engine*
*Context gathered: 2026-04-12*
