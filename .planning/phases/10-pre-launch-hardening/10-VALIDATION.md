---
phase: 10
slug: pre-launch-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test (integration + load), k6 (load testing) |
| **Config file** | `backend/tests/load/config_matrix.js` (k6), testcontainers in Go test files |
| **Quick run command** | `cd backend && go test -tags integration ./tests/hardening/... -short -timeout 120s` |
| **Full suite command** | `cd backend && go test -tags integration ./tests/hardening/... -timeout 600s && bash tests/load/run_matrix.sh` |
| **Estimated runtime** | ~300 seconds (integration), ~600 seconds (full load matrix) |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && go test -tags integration ./tests/hardening/... -short -timeout 120s`
- **After every plan wave:** Run `cd backend && go test -tags integration ./tests/hardening/... -timeout 600s`
- **Before `/gsd-verify-work`:** Full suite including load tests must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | ALL | — | Config matrix seed generates valid test data for 6 combinations | integration | `go test -tags integration ./tests/hardening/ -run TestSeedMatrix -timeout 60s` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | SCAN-01..09, FOOD-01..04 | T-10-01 | All 6 config combinations pass entry+food+counter verification | integration | `go test -tags integration ./tests/hardening/ -run TestConfigMatrix -timeout 300s` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | QRCD-06 | T-10-02 | Modified/forged QR tokens rejected with correct error codes | unit | `go test ./internal/scan/ -run TestQRSecurity -timeout 30s` | ❌ W0 | ⬜ pending |
| 10-01-04 | 01 | 1 | INVT-04, INVT-05 | ��� | 1000+ mock SMS processed with correct status tracking | unit | `go test ./internal/sms/ -run TestBulkSMS -timeout 60s` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 2 | SCAN-06, INFR-04 | T-10-03 | 10K concurrent scans: zero errors, p95 < 200ms | load | `bash backend/tests/load/run_matrix.sh --quick` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 2 | INVT-02 | — | 60K images generated within time+memory bounds, crash recovery works | integration | `go test -tags integration ./tests/hardening/ -run TestImageGeneration -timeout 600s` | ❌ W0 | ⬜ pending |
| 10-02-03 | 02 | 2 | ALL | — | Counter reconciliation: Redis == PG after load | integration | `go test -tags integration ./tests/hardening/ -run TestCounterReconciliation -timeout 120s` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/hardening/` — test directory with integration test files
- [ ] `backend/tests/hardening/config_matrix_test.go` — config matrix integration tests
- [ ] `backend/internal/scan/security_test.go` — QR security test stubs
- [ ] `backend/tests/load/run_matrix.sh` — load test matrix orchestration script
- [ ] testcontainers-go modules installed (postgres, redis)

*Phase 10 is entirely test code — Wave 0 bootstraps the test infrastructure that IS the deliverable.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SMS delivery via real provider | INVT-04 | Requires SMS.NET.BD production API, costs credits, needs real phone numbers | Send 1,000 SMS via production API to test phone list, verify >95% delivery within 5 minutes |
| Dashboard visual correctness | DASH-01..06 | Visual layout and real-time update feel require human verification | Open dashboard during load test, verify counters update within seconds, alerts appear for duplicates |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
