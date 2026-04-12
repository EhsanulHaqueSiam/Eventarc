---
phase: 8
slug: invitation-card-sms-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test (backend), vitest (frontend) |
| **Config file** | backend: go test ./..., frontend: vitest.config.ts |
| **Quick run command** | `cd backend && go test ./internal/card/... ./internal/sms/... -count=1` |
| **Full suite command** | `cd backend && go test ./... -count=1 && cd ../frontend && npx vitest run` |
| **Estimated runtime** | ~15 seconds (backend unit), ~30 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && go test ./internal/card/... ./internal/sms/... -count=1`
- **After every plan wave:** Run `cd backend && go test ./... -count=1 && cd ../frontend && npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | INVT-01 | — | N/A | unit | `go test ./internal/card/... -run TestCompositor` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | INVT-02 | — | N/A | unit | `go test ./internal/card/... -run TestBatchComposite` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | INVT-03 | — | N/A | unit | `go test ./internal/r2/... -run TestUploadComposite` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | INVT-01 | — | N/A | e2e | `npx vitest run --testPathPattern card-editor` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | INVT-01 | — | N/A | unit | `npx vitest run --testPathPattern card-template` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 2 | INVT-04 | — | API key not hardcoded | unit | `go test ./internal/sms/... -run TestSMSProvider` | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 2 | INVT-05 | — | N/A | unit | `go test ./internal/sms/... -run TestDeliveryStatus` | ❌ W0 | ⬜ pending |
| 08-03-03 | 03 | 2 | INVT-04 | — | Rate limiting enforced | unit | `go test ./internal/sms/... -run TestThrottling` | ❌ W0 | ⬜ pending |
| 08-03-04 | 03 | 2 | INVT-06 | — | N/A | integration | `go test ./internal/sms/... -run TestSMSFlow` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/internal/card/compositor_test.go` — stubs for INVT-01, INVT-02, INVT-03
- [ ] `backend/internal/sms/provider_test.go` — stubs for INVT-04, INVT-05
- [ ] `backend/internal/sms/worker_test.go` — stubs for INVT-04 throttling, INVT-06 flow
- [ ] `go get github.com/disintegration/imaging` — imaging library for compositing

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fabric.js drag-drop QR positioning | INVT-01 | Visual interaction on canvas | Open card editor, upload background, drag QR overlay, verify resize handles work |
| Composite card visual quality | INVT-02 | Visual assessment of QR readability | Open 5 random composite cards from R2, verify QR is at correct position and scannable |
| SMS received on phone | INVT-04 | Requires real phone and SMS provider account | Send test SMS to a real number, verify message content and card download link |
| Card download link works | INVT-06 | End-to-end guest experience | Click card download link from SMS, verify card image loads with visible QR code |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
