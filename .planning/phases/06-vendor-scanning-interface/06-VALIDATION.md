---
phase: 6
slug: vendor-scanning-interface
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-12
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Frontend)** | Vitest 3.x + React Testing Library |
| **Config file (Frontend)** | frontend/vitest.config.ts |
| **Quick run command (Frontend)** | `cd frontend && pnpm vitest run --reporter=verbose` |
| **Full suite command (Frontend)** | `cd frontend && pnpm vitest run` |
| **Framework (Backend)** | Go stdlib testing |
| **Config file (Backend)** | none (Go convention) |
| **Quick run command (Backend)** | `cd backend && go test ./internal/handler/ -v -count=1` |
| **Full suite command (Backend)** | `cd backend && go test ./... -race` |
| **Estimated runtime** | ~15 seconds (frontend) + ~5 seconds (backend) |

---

## Sampling Rate

- **After every task commit:** Run quick commands for affected layer (frontend or backend)
- **After every plan wave:** Run both full suite commands
- **Before `/gsd-verify-work`:** Full suite must be green on both frontend and backend
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | VSCN-02 | unit | `cd backend && go test ./internal/handler/ -run TestSession -v` | Wave 0 | pending |
| 06-01-02 | 01 | 1 | VSCN-02 | unit | `cd frontend && pnpm vitest run src/hooks/use-device-session.test.ts` | Wave 0 | pending |
| 06-01-03 | 01 | 1 | VSCN-01 | unit | `cd frontend && pnpm vitest run src/components/scanner/scanner-setup.test.tsx` | Wave 0 | pending |
| 06-02-01 | 02 | 2 | VSCN-03 | unit | `cd frontend && pnpm vitest run src/components/scanner/camera-viewfinder.test.tsx` | Wave 0 | pending |
| 06-02-02 | 02 | 2 | VSCN-04 | unit | `cd frontend && pnpm vitest run src/hooks/use-scanner.test.ts` | Wave 0 | pending |
| 06-02-03 | 02 | 2 | VSCN-04 | unit | `cd frontend && pnpm vitest run src/hooks/use-audio-feedback.test.ts` | Wave 0 | pending |
| 06-02-04 | 02 | 2 | VSCN-05 | unit | `cd frontend && pnpm vitest run src/components/sessions/active-sessions-tab.test.tsx` | Wave 0 | pending |
| 06-02-05 | 02 | 2 | VSCN-05 | integration | `cd backend && go test ./internal/handler/ -run TestSessionRevoke -v` | Wave 0 | pending |

---

## Wave 0 Requirements

- [ ] `frontend/src/hooks/use-scanner.test.ts` -- scan state machine unit tests
- [ ] `frontend/src/hooks/use-device-session.test.ts` -- session token management tests
- [ ] `frontend/src/hooks/use-audio-feedback.test.ts` -- audio cue tests (mock AudioContext)
- [ ] `frontend/src/components/scanner/scanner-setup.test.tsx` -- cascading dropdown tests
- [ ] `frontend/src/components/scanner/camera-viewfinder.test.tsx` -- viewfinder lifecycle tests (mock html5-qrcode)
- [ ] `frontend/src/components/sessions/active-sessions-tab.test.tsx` -- admin session list tests
- [ ] `backend/internal/handler/session_test.go` -- session CRUD endpoint tests (create, validate, revoke)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Camera QR scanning on real iPhone Safari | VSCN-03 | Requires physical device + camera hardware | Open /scanner on iPhone Safari, grant camera permission, scan a test QR code |
| Camera QR scanning on real Android Chrome | VSCN-03 | Requires physical device + camera hardware | Open /scanner on Android Chrome, grant camera permission, scan a test QR code |
| Audio feedback audible on mobile device | VSCN-04 | Requires physical audio hardware + speaker | Confirm beep sounds play on scan success/failure on real device |
| Full-screen flash visible at arm's length | VSCN-04 | Requires physical device + visual inspection | Verify green/red flash is unmissable from normal operating distance |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-12
