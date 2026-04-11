---
phase: 1
slug: foundation-domain-model
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-11
---

# Phase 1 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test (backend), vitest (frontend), convex test harness |
| **Config file** | `frontend/vitest.config.ts` (created in Plan 01-03 Task 1b) |
| **Quick run command** | `cd backend && go test ./...` |
| **Full suite command** | `cd backend && go test -v -race ./... && cd ../frontend && pnpm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && go test ./...`
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | INFR-01 | -- | N/A | integration | `docker compose up -d && docker compose ps` | N/A (infra) | pending |
| 01-01-02 | 01 | 1 | INFR-02 | -- | N/A | unit | `cd backend && go test ./internal/config/...` | yes (Task 1) | pending |
| 01-02-01 | 02 | 1 | EVNT-01 | -- | N/A | typecheck | `npx convex typecheck 2>&1` | yes (Plan 02) | pending |
| 01-02-02 | 02 | 1 | EVNT-02 | -- | N/A | typecheck | `npx convex typecheck 2>&1` | yes (Plan 02) | pending |
| 01-02-03 | 02 | 1 | EVNT-03 | -- | N/A | typecheck | `npx convex typecheck 2>&1` | yes (Plan 02) | pending |
| 01-02-04 | 02 | 1 | EVNT-04 | -- | N/A | typecheck | `npx convex typecheck 2>&1` | yes (Plan 02) | pending |
| 01-03-01a | 03 | 2 | VNDR-01 | -- | N/A | typecheck | `npx convex typecheck 2>&1` | yes (Plan 03) | pending |
| 01-03-01b | 03 | 2 | VNDR-02 | -- | N/A | build | `cd frontend && pnpm build 2>&1` | yes (Task 1b) | pending |
| 01-03-02 | 03 | 2 | VNDR-03 | -- | N/A | build | `cd frontend && pnpm build 2>&1` | yes (Task 2) | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `backend/internal/config/config_test.go` -- config loading tests (created in Plan 01-01 Task 1)
- [x] Go test infrastructure (go test built-in, no extra install)
- [x] `frontend/vitest.config.ts` -- Vitest config for frontend (created in Plan 01-03 Task 1b)
- [ ] `convex/tests/` -- Convex function test stubs (deferred: Convex test harness requires running dev server; typecheck serves as automated verification for Plans 02/03)

*Wave 0 establishes test infrastructure for both Go and frontend layers. Convex verification uses `npx convex typecheck` which validates all types, argument validators, and schema references without requiring a running dev server.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker Compose services start | INFR-01 | Requires Docker daemon | Run `docker compose up -d`, verify all services healthy |
| Convex dashboard shows schema | EVNT-01 | Requires Convex dev deployment | Run `npx convex dev`, check dashboard |
| Full UI verification | ALL | Visual/functional check | Plan 01-03 Task 3 checkpoint |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (revision pass)
