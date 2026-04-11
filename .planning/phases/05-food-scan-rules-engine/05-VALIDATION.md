---
phase: 5
slug: food-scan-rules-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test (stdlib) |
| **Config file** | none — uses go test conventions |
| **Quick run command** | `cd backend && go test ./internal/scan/... -count=1 -timeout 30s` |
| **Full suite command** | `cd backend && go test ./... -count=1 -timeout 120s -race` |
| **Estimated runtime** | ~15 seconds (quick), ~45 seconds (full with race detector) |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && go test ./internal/scan/... -count=1 -timeout 30s`
- **After every plan wave:** Run `cd backend && go test ./... -count=1 -timeout 120s -race`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | FOOD-01, FOOD-02 | — | N/A | unit | `go test ./internal/scan/ -run TestFoodScanLua -count=1` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | SCAN-03 | — | N/A | unit | `go test ./internal/scan/ -run TestFoodScanService -count=1` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | FOOD-03 | — | N/A | unit | `go test ./internal/scan/ -run TestFoodScanPerCategory -count=1` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | FOOD-04 | — | N/A | unit | `go test ./internal/scan/ -run TestAnonymousFoodScan -count=1` | ❌ W0 | ⬜ pending |
| 05-01-05 | 01 | 1 | SCAN-03 | — | Fail-closed on missing rules | unit | `go test ./internal/scan/ -run TestFoodScanHandler -count=1` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | FOOD-01 | — | N/A | unit | `go test ./internal/scan/ -run TestFoodRulesSync -count=1` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | FOOD-01 | — | N/A | schema | `cd backend && go test ./... -run TestMigration -count=1` | ❌ W0 | ⬜ pending |
| 05-02-03 | 02 | 2 | SCAN-03 | — | N/A | unit | `go test ./internal/scan/ -run TestFoodCounterReconciliation -count=1` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/internal/scan/food_service_test.go` — stubs for FOOD-01 through FOOD-04, SCAN-03
- [ ] `backend/internal/scan/food_handler_test.go` — stubs for food scan HTTP handler tests
- [ ] Test fixtures for miniredis with pre-loaded food rules and consumption data

*Existing go test infrastructure covers all framework requirements. New test files needed for food-specific logic.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Convex foodRules table CRUD | FOOD-01 | Requires running Convex dev server | Create event, add guest/food categories, set limits in matrix, verify foodRules docs created |
| Food rules sync to Redis | FOOD-01 | Requires Convex → Go HTTP action chain | Trigger go-live sync, verify Redis `foodrules:{eventId}` hash has correct entries |

*All scan-time behaviors have automated verification via unit tests with miniredis.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
