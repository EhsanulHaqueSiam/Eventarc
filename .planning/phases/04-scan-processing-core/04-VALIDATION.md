---
phase: 4
slug: scan-processing-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test (stdlib) + testcontainers-go + k6 |
| **Config file** | none — existing Go test infrastructure |
| **Quick run command** | `cd backend && go test ./internal/scan/... -count=1 -timeout 30s` |
| **Full suite command** | `cd backend && go test -race ./... -count=1 -timeout 120s` |
| **Estimated runtime** | ~15 seconds (quick) / ~45 seconds (full with race detector) |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && go test ./internal/scan/... -count=1 -timeout 30s`
- **After every plan wave:** Run `cd backend && go test -race ./... -count=1 -timeout 120s`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | SCAN-01, SCAN-05 | T-04-01 | QR HMAC signature verified before any state change | unit | `go test ./internal/scan/... -run TestDecodeAndValidate` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | SCAN-04 | T-04-02 | Redis Lua script executes atomically (check+set+increment) | unit | `go test ./internal/scan/... -run TestLuaAtomicCheckIn` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | SCAN-02 | — | Duplicate scan returns original timestamp, never double-entry | unit | `go test ./internal/scan/... -run TestDuplicateScan` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | SCAN-08 | — | HINCRBY counter increments on valid scan only | unit | `go test ./internal/scan/... -run TestCounterIncrement` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | SCAN-05, INFR-03 | T-04-03 | PG INSERT ON CONFLICT prevents duplicate rows | integration | `go test ./internal/scan/... -run TestPGIdempotency` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | SCAN-04 | — | PG write failure retried via asynq, Redis state correct | integration | `go test ./internal/scan/... -run TestPGWriteRetry` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | SCAN-09 | — | Counter re-seed from PG matches expected values | integration | `go test ./internal/scan/... -run TestCounterReseed` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | SCAN-06 | — | 10K concurrent scans, zero errors, p95 < 200ms | load | `k6 run backend/tests/load/scan_load_test.js` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | SCAN-06 | — | Go race detector passes with concurrent handlers | integration | `go test -race ./internal/scan/... -run TestConcurrent` | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 2 | SCAN-07, INFR-04 | — | Redis counter == PG COUNT(*) after concurrent load | integration | `go test ./internal/scan/... -run TestCounterReconciliation` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending / ✅ green / ❌ red / ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/internal/scan/` — scan service package directory
- [ ] `backend/internal/scan/service_test.go` — unit test stubs for SCAN-01, SCAN-02, SCAN-04, SCAN-05
- [ ] `backend/internal/scan/handler_test.go` — HTTP handler test stubs
- [ ] `backend/tests/load/scan_load_test.js` — k6 load test script stub
- [ ] `testcontainers-go` dependency in go.mod — for integration tests with real PG + Redis

*Existing infrastructure: Go test runner, Redis client (go-redis v9), PG driver (pgx v5), asynq already in go.mod.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Redis restart during live event triggers re-seed | SCAN-09 | Requires Docker container restart orchestration | 1. Run scan load test 2. `docker restart redis` 3. Verify counters re-seeded from PG within 5s 4. Resume scanning, verify no duplicates |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
