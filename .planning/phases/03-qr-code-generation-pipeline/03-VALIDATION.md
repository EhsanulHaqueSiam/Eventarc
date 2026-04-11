---
phase: 3
slug: qr-code-generation-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test (stdlib) |
| **Config file** | none — existing Go test infrastructure from Phase 1 |
| **Quick run command** | `cd backend && go test ./internal/qr/... ./internal/r2/... -v -count=1` |
| **Full suite command** | `cd backend && go test ./... -v -count=1 -race` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && go test ./internal/qr/... ./internal/r2/... -v -count=1`
- **After every plan wave:** Run `cd backend && go test ./... -v -count=1 -race`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | QRCD-06 | T-03-01 | HMAC signature prevents forgery | unit | `go test ./internal/qr/... -run TestPayload` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | QRCD-01 | — | N/A | unit | `go test ./internal/qr/... -run TestGenerate` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | QRCD-03 | — | N/A | unit | `go test ./internal/qr/... -run TestStrategy` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | QRCD-02 | — | N/A | integration | `go test ./internal/r2/... -run TestUpload` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | INFR-05 | — | N/A | unit | `go test ./internal/worker/... -run TestWorker` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | QRCD-04, QRCD-05 | — | N/A | unit | `go test ./internal/qr/... -run TestFoodQr` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/internal/qr/payload_test.go` — stubs for QRCD-06 (binary encoding, HMAC sign/verify)
- [ ] `backend/internal/qr/generator_test.go` — stubs for QRCD-01, QRCD-03 (QR image generation, strategy matrix)
- [ ] `backend/internal/r2/client_test.go` — stubs for QRCD-02 (R2 upload mock)
- [ ] `backend/internal/worker/qr_handler_test.go` — stubs for INFR-05 (asynq handler)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| QR image scannable by phone camera | QRCD-01 | Physical device scanning cannot be automated in CI | Generate a QR, scan with phone camera, verify decoded content matches payload |
| R2 CDN URL accessible publicly | QRCD-02 | Requires live R2 bucket with public domain | Upload a test image, curl the CDN URL, verify 200 response |
| Progress bar shows real-time updates | QRCD-01, D-06 | Frontend + Redis integration | Trigger generation, observe progress bar updating |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
