# Phase 10: Pre-Launch Hardening - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Production-scale validation before any real event. Load testing at 10K concurrent, integration tests for all event configuration combinations, QR security tests (modified tokens, replayed entries), SMS batch delivery test, 60K image generation stress test with crash recovery verification. No new features — purely testing and hardening existing functionality.

Requirements: Validates all existing requirements — no new ones introduced.

</domain>

<decisions>
## Implementation Decisions

### All Areas — Claude's Discretion
- **D-01:** Claude designs the full test suite based on the 5 success criteria. Full discretion on test tooling, test data setup, staging environment configuration, and pass/fail thresholds.
- **D-02:** Load test from Phase 4 (k6, 10K VUs, p95 < 200ms) is the foundation. Phase 10 extends it to cover food scans + entry scans simultaneously with all config combinations active.
- **D-03:** Configuration combinations to test: unified + guest-linked + pre-sent, unified + anonymous + pre-sent, separate + guest-linked + pre-sent, separate + guest-linked + post-entry, separate + anonymous + pre-sent, separate + anonymous + post-entry. All 6 combinations need E2E coverage.

### Claude's Discretion
Full flexibility on: test framework choices, staging environment setup (Docker Compose based), test data generation (fake 60K guests), load test scenarios, security test patterns, SMS mock vs real provider for batch test, acceptable thresholds for image generation timing, memory bounds definition.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### All Phase Contexts
- All phase CONTEXT.md files (01-09) — the test suite must validate every decision made
- `.planning/REQUIREMENTS.md` — All requirements must pass E2E
- Phase 4 load test infrastructure (k6) — extend, don't rebuild

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 4 k6 load test scripts — extend for Phase 10 comprehensive testing
- Docker Compose infrastructure — staging environment uses same config
- Go race detector tests from Phase 4 — extend to full system

</code_context>

<specifics>
## Specific Ideas

- 6 configuration combinations cover the full matrix of QR strategy x food mode x timing
- SMS batch test should use a real provider sandbox if available, mock if not
- Image generation stress test must verify crash recovery (kill mid-generation, resume)

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>

---

*Phase: 10-pre-launch-hardening*
*Context gathered: 2026-04-12*
