---
phase: 1
slug: foundation-domain-model
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test (backend), vitest (frontend), convex test harness |
| **Config file** | none — Wave 0 installs |
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
| 01-01-01 | 01 | 1 | INFR-01 | — | N/A | integration | `docker compose up -d && docker compose ps` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | INFR-02 | — | N/A | unit | `cd backend && go test ./internal/config/...` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | EVNT-01 | — | N/A | unit | `cd backend && go test ./internal/...` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | EVNT-02 | — | N/A | unit | `npx convex dev --run tests` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | EVNT-03 | — | N/A | unit | `npx convex dev --run tests` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 1 | EVNT-04 | — | N/A | unit | `npx convex dev --run tests` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | VNDR-01 | — | N/A | unit | `npx convex dev --run tests` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 2 | VNDR-02 | — | N/A | unit | `npx convex dev --run tests` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 2 | VNDR-03 | — | N/A | unit | `npx convex dev --run tests` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/internal/config/config_test.go` — config loading tests
- [ ] `convex/tests/` — Convex function test stubs
- [ ] Go test infrastructure (go test built-in, no extra install)
- [ ] `frontend/vitest.config.ts` — Vitest config for frontend

*Wave 0 establishes test infrastructure for both Go and Convex layers.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker Compose services start | INFR-01 | Requires Docker daemon | Run `docker compose up -d`, verify all services healthy |
| Convex dashboard shows schema | EVNT-01 | Requires Convex dev deployment | Run `npx convex dev`, check dashboard |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
