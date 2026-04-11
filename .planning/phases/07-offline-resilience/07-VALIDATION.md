---
phase: 7
slug: offline-resilience
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (frontend unit/integration), Go test (backend — no backend changes expected) |
| **Config file** | `frontend/vitest.config.ts` (existing) |
| **Quick run command** | `cd frontend && pnpm vitest run --reporter=verbose src/lib/offline-queue.test.ts src/hooks/use-network-status.test.ts src/hooks/use-offline-sync.test.ts` |
| **Full suite command** | `cd frontend && pnpm vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command (offline-specific tests)
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | OFFL-01 | -- | Scan queued to IndexedDB with idempotency key when offline | unit | `pnpm vitest run src/lib/offline-queue.test.ts` | -- W0 | pending |
| 07-01-02 | 01 | 1 | OFFL-05 | -- | Idempotency keys are unique UUIDs via crypto.randomUUID() | unit | `pnpm vitest run src/lib/offline-queue.test.ts` | -- W0 | pending |
| 07-01-03 | 01 | 1 | OFFL-04 | -- | Scans older than 30 min auto-deleted from IndexedDB | unit | `pnpm vitest run src/lib/offline-queue.test.ts` | -- W0 | pending |
| 07-01-04 | 01 | 1 | OFFL-01 | -- | Network status detection: online/offline/syncing transitions | unit | `pnpm vitest run src/hooks/use-network-status.test.ts` | -- W0 | pending |
| 07-02-01 | 02 | 2 | OFFL-02 | -- | Sequential sync of pending scans in timestamp order | unit | `pnpm vitest run src/hooks/use-offline-sync.test.ts` | -- W0 | pending |
| 07-02-02 | 02 | 2 | OFFL-03 | -- | Retroactive rejection triggers notification for rejected synced scans | unit | `pnpm vitest run src/hooks/use-offline-sync.test.ts` | -- W0 | pending |
| 07-02-03 | 02 | 2 | OFFL-05 | -- | Duplicate sync attempts handled idempotently (no double count) | unit | `pnpm vitest run src/hooks/use-offline-sync.test.ts` | -- W0 | pending |
| 07-02-04 | 02 | 2 | OFFL-01 | -- | Pending count badge shows correct count, offline banner visible | integration | manual | -- | pending |

*Status: pending -- pre-execution*

---

## Wave 0 Requirements

- [ ] `frontend/src/lib/offline-queue.test.ts` -- stubs for OFFL-01, OFFL-04, OFFL-05 (IndexedDB operations)
- [ ] `frontend/src/hooks/use-network-status.test.ts` -- stubs for OFFL-01 (network detection)
- [ ] `frontend/src/hooks/use-offline-sync.test.ts` -- stubs for OFFL-02, OFFL-03, OFFL-05 (sync logic)
- [ ] `pnpm add -D fake-indexeddb` -- IndexedDB mock for Node.js test environment

*Note: vitest is already installed from Phase 1. fake-indexeddb provides in-memory IndexedDB for test isolation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Offline banner visibility | OFFL-01 | Visual UI state, requires browser with network toggle | Open scanner, toggle WiFi off, verify amber banner appears below top bar |
| Queued scan flash (amber) | OFFL-01 | Visual/audio feedback, requires camera + offline state | While offline, scan QR, verify amber "QUEUED" flash + 330Hz audio |
| Pending badge in bottom bar | OFFL-05 | Visual UI element requiring real scanner context | Queue 3 scans offline, verify "{3} scans pending" badge in bottom bar |
| Rejection toast persistence | OFFL-03 | Toast must NOT auto-dismiss, requires acknowledge tap | Sync rejected scan, verify toast stays until "Acknowledge" tapped |
| Network flapping resilience | OFFL-04 | Requires real network toggling, timing-dependent | Toggle WiFi 5x in 10s, verify no duplicate syncs or ghost states |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
