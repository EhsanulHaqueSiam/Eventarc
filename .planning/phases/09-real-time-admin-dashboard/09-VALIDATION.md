---
phase: 9
slug: real-time-admin-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test (backend SSE/broker), vitest (frontend components) |
| **Config file** | `backend/go.mod` (go test), `frontend/vitest.config.ts` (vitest) |
| **Quick run command** | `cd backend && go test ./internal/sse/... -count=1 -timeout 30s` |
| **Full suite command** | `cd backend && go test ./... -count=1 -timeout 120s && cd ../frontend && pnpm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && go test ./internal/sse/... -count=1 -timeout 30s`
- **After every plan wave:** Run `cd backend && go test ./... -count=1 -timeout 120s && cd ../frontend && pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | DASH-06 | — | SSE streams events to connected clients | unit | `go test ./internal/sse/... -run TestBrokerBroadcast` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | DASH-05 | — | Reads only Redis counters, no scan table queries | unit | `go test ./internal/sse/... -run TestSnapshotReadsCounters` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | DASH-01 | — | Snapshot includes attendance counter values | unit | `go test ./internal/sse/... -run TestSnapshotAttendance` | ❌ W0 | ⬜ pending |
| 09-01-04 | 01 | 1 | DASH-02 | — | Food consumption counters in SSE payload | unit | `go test ./internal/sse/... -run TestFoodCounters` | ❌ W0 | ⬜ pending |
| 09-01-05 | 01 | 1 | DASH-03 | — | Stall activity data in SSE events | unit | `go test ./internal/sse/... -run TestStallActivity` | ❌ W0 | ⬜ pending |
| 09-01-06 | 01 | 1 | DASH-04 | — | Alert events for duplicate scans | unit | `go test ./internal/sse/... -run TestAlertDuplicate` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 2 | DASH-01 | — | Attendance counter updates on SSE event | component | `pnpm test -- --run src/components/dashboard/` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 2 | DASH-06 | — | EventSource auto-reconnects on error | component | `pnpm test -- --run src/hooks/use-sse.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/internal/sse/broker_test.go` — stubs for SSE broker broadcast, snapshot, alerts
- [ ] `frontend/src/hooks/use-sse.test.ts` — stubs for EventSource hook reconnection
- [ ] `frontend/src/components/dashboard/__tests__/` — stubs for dashboard component rendering

*Existing go test and vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SSE reconnection through Nginx proxy | DASH-06 | Requires real proxy infrastructure | Deploy behind Nginx, kill SSE connection, verify auto-reconnect within 3s |
| Dashboard visual layout and readability | DASH-01, DASH-02, DASH-03 | Visual verification | Open dashboard during simulated event, verify counters update within 2s of scan |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
