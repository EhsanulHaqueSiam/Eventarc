---
phase: "07"
status: clean
depth: standard
files_reviewed: 16
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
reviewed: "2026-04-12"
---

# Phase 07: Offline Resilience - Code Review

## Summary

16 files reviewed at standard depth. No critical issues. One warning about session token handling in the sync hook. Two informational notes about minor improvements.

## Findings

### WR-01: Session token placeholder in useOfflineSync hook

**Severity:** warning
**File:** `frontend/src/hooks/use-offline-sync.ts` (line 128)
**Issue:** The `getSessionToken` callback in `useOfflineSync` returns an empty string `() => ""`. When the sync runs in production, it will send an empty `X-Session-Token` header, which may cause the server to reject all sync requests with 401/403 rather than processing them.
**Impact:** Sync will fail on reconnection if the server enforces session validation on scan endpoints. The code comment acknowledges this ("in production, get from device session store") but there is no integration with the existing `useDeviceSession` hook.
**Recommendation:** Wire `getSessionToken` to the device session store before integration testing. This is expected to be resolved when the scanner page integrates these hooks -- not a code defect per se, but flagged to ensure it is not missed.

### IN-01: AudioContext instances not closed after use

**Severity:** info
**File:** `frontend/src/components/scanner/QueuedScanFlash.tsx` (line 19), `frontend/src/components/scanner/RetroactiveRejectionToast.tsx` (line 9)
**Issue:** Each audio cue creates a new `AudioContext()` that is never closed. On most browsers, the context is garbage collected after the oscillator stops, but browsers have a limit on concurrent AudioContext instances (typically 6-8). If many audio cues play rapidly (e.g., multiple rejection toasts appearing in quick succession), this could hit the browser limit.
**Impact:** Low -- would require 6+ rejection toasts appearing within a very short window, and the existing Phase 6 `useAudioFeedback` hook already manages a shared AudioContext ref. These components could share that same context in integration.
**Recommendation:** Consider reusing the `useAudioFeedback` hook's shared AudioContext when integrating with the scanner page.

### IN-02: Inline style tag in PendingBadge

**Severity:** info
**File:** `frontend/src/components/scanner/PendingBadge.tsx` (lines 39-44)
**Issue:** The `@keyframes pulse-scale` animation is defined via an inline `<style>` tag inside the component JSX. If multiple PendingBadge instances render (unlikely but possible during re-renders), duplicate style blocks are injected into the DOM.
**Impact:** Negligible -- the component is a singleton in the scanner bottom bar, and duplicate keyframe definitions are harmless. The Tailwind `animate-[pulse-scale_3s_ease-in-out_infinite]` class already references the keyframe name correctly.
**Recommendation:** Move the keyframe to the global CSS or a Tailwind plugin if desired, but this is purely cosmetic.

## Architecture Assessment

The offline resilience layer follows a clean separation of concerns:
- **Data layer** (`offline-queue.ts`): Pure IndexedDB operations, no React dependencies, fully testable
- **State layer** (`scanner-store.ts`): Zustand store for reactive UI, separate from Phase 6 scan flow store
- **Hook layer** (`use-network-status.ts`, `use-offline-sync.ts`): React hooks bridging data and state
- **UI layer** (8 components): Presentational components reading from store, minimal logic

The idempotency key strategy (client-generated UUID, server INSERT ON CONFLICT) is sound and aligns with the Phase 4 scan processing core design.

## Files Reviewed

| File | Lines | Issues |
|------|-------|--------|
| frontend/src/lib/offline-queue.ts | 146 | None |
| frontend/src/lib/offline-queue.test.ts | 174 | None |
| frontend/src/stores/scanner-store.ts | 52 | None |
| frontend/src/hooks/use-network-status.ts | 115 | None |
| frontend/src/hooks/use-network-status.test.ts | 132 | None |
| frontend/src/hooks/use-offline-sync.ts | 175 | WR-01 |
| frontend/src/hooks/use-offline-sync.test.ts | 263 | None |
| frontend/src/components/scanner/OfflineBanner.tsx | 27 | None |
| frontend/src/components/scanner/QueuedScanFlash.tsx | 54 | IN-01 |
| frontend/src/components/scanner/QueuedScanResultCard.tsx | 111 | None |
| frontend/src/components/scanner/PendingBadge.tsx | 48 | IN-02 |
| frontend/src/components/scanner/PendingQueuePanel.tsx | 105 | None |
| frontend/src/components/scanner/PendingQueueItem.tsx | 68 | None |
| frontend/src/components/scanner/ConnectionRestoredBanner.tsx | 33 | None |
| frontend/src/components/scanner/RetroactiveRejectionToast.tsx | 107 | IN-01 |
| frontend/package.json | 58 | None |
