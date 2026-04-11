---
phase: 2
slug: guest-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (frontend) |
| **Config file** | `frontend/vitest.config.ts` or "none — Wave 0 installs" |
| **Quick run command** | `cd frontend && pnpm vitest run --reporter=verbose` |
| **Full suite command** | `cd frontend && pnpm vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && pnpm vitest run --reporter=verbose`
- **After every plan wave:** Run `cd frontend && pnpm vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | GUST-01 | — | N/A | unit | `pnpm vitest run` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | GUST-02 | — | N/A | unit | `pnpm vitest run` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | GUST-03 | — | N/A | unit | `pnpm vitest run` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | GUST-04 | — | N/A | unit | `pnpm vitest run` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | GUST-05 | — | N/A | unit | `pnpm vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/vitest.config.ts` — vitest configuration if not already present
- [ ] `convex/__tests__/guests.test.ts` — stubs for GUST-01, GUST-02, GUST-03
- [ ] `frontend/src/__tests__/phone-validation.test.ts` — BD phone format validation tests
- [ ] `frontend/src/__tests__/import-wizard.test.ts` — import flow unit tests

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CSV/Excel file drag-and-drop upload | GUST-01 | Browser file API interaction | Upload .csv and .xlsx files via drag-drop zone, verify parsing |
| Column mapping preview with first 5 rows | GUST-01 | Visual UI verification | Check preview table shows correct mapped data |
| 60K row import with progress bar | GUST-01 | Performance/load test | Import 60K row CSV, verify progress updates and completion |
| Search typeahead responsiveness | GUST-04 | Perceived performance UX | Type in search field, verify debounced results appear within 500ms |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
