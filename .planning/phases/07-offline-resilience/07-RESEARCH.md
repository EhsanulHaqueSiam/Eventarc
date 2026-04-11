# Phase 7: Offline Resilience - Research

**Researched:** 2026-04-12
**Question:** What do I need to know to PLAN this phase well?

## Validation Architecture

### Requirement Verification Matrix

| Requirement | Implementation Strategy | Verification Approach |
|-------------|------------------------|----------------------|
| OFFL-01 (IndexedDB queue) | idb library + offline_scans store with idempotency key as primary key | Write unit test: create scan offline, verify IndexedDB record exists with correct fields |
| OFFL-02 (Re-validate on reconnect) | Sequential POST to existing scan endpoints with idempotency key | Integration test: queue 3 scans offline, go online, verify server validates each against current state |
| OFFL-03 (Retroactive rejection) | Server returns rejection status, client shows persistent toast | Test: queue scan for guest at limit, go online, verify rejection toast appears and requires acknowledge |
| OFFL-04 (Brief safety net) | 30-minute retention window, auto-cleanup timer | Test: create scan > 30 min old, run cleanup, verify deletion |
| OFFL-05 (No duplicate processing) | Client-generated idempotency keys via crypto.randomUUID(), server INSERT ON CONFLICT | Test: sync same scan twice, verify server processes only once, counter increments only once |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| IndexedDB not available (private browsing) | MEDIUM | Feature detection: check `window.indexedDB` on scanner init, warn vendor if unavailable |
| Network flapping (rapid online/offline) | HIGH | Debounce network state changes (500ms), don't start sync until stable online for 2 seconds |
| Partial sync failure (some scans sync, then network drops again) | HIGH | Track per-scan sync status individually, resume from first unsent scan on next reconnect |
| IndexedDB storage quota exceeded | LOW | 30-min retention + small payload per scan (~500 bytes) means ~1000 scans in 30 min is well under quota |
| Race condition: vendor scans while sync is in progress | MEDIUM | Allow scanning during sync -- new offline scans are queued to IndexedDB, sync processes existing queue |

## Standard Stack

### IndexedDB Wrapper: idb v8

**Recommended:** `idb` by Jake Archibald (https://github.com/jakearchibald/idb)

| Property | Value |
|----------|-------|
| Package | `idb` |
| Version | 8.x (latest) |
| Size | ~1.19KB brotli'd |
| API | Promise-based, mirrors IndexedDB API |
| TypeScript | Full type definitions included |
| License | ISC |

**Why idb over Dexie.js:**
- idb is ~1.2KB vs Dexie at ~40KB -- minimal bundle impact for a scanner app
- idb mirrors the IndexedDB API directly -- lower learning curve, no abstraction leaks
- idb is sufficient for this use case (single store, simple CRUD, index queries)
- Dexie would be overkill -- its query builder, live queries, and sync engine are unused here

**Why idb over raw IndexedDB:**
- Promise-based API eliminates callback hell (onsuccess/onerror pattern)
- Transaction .done promise simplifies error handling
- Shortcut methods (get, put, getAll, delete) reduce boilerplate
- TypeScript generics for type-safe stores

### Key idb Patterns for This Phase

**Database Setup:**
```typescript
import { openDB, DBSchema } from 'idb';

interface OfflineScanDB extends DBSchema {
  offline_scans: {
    key: string; // idempotency_key
    value: {
      idempotency_key: string;
      scan_payload: string;
      scan_type: 'entry' | 'food';
      stall_id: string;
      event_id: string;
      guest_name: string;
      guest_category: string;
      timestamp: number;
      status: 'pending' | 'synced' | 'rejected';
      rejection_reason: string | null;
      synced_at: number | null;
    };
    indexes: {
      by_status: string;
      by_timestamp: number;
    };
  };
}

const db = await openDB<OfflineScanDB>('eventarc-offline', 1, {
  upgrade(db) {
    const store = db.createObjectStore('offline_scans', {
      keyPath: 'idempotency_key',
    });
    store.createIndex('by_status', 'status');
    store.createIndex('by_timestamp', 'timestamp');
  },
});
```

**Queue a Scan:**
```typescript
await db.put('offline_scans', {
  idempotency_key: crypto.randomUUID(),
  scan_payload: qrPayload,
  scan_type: 'entry',
  stall_id: currentStallId,
  event_id: currentEventId,
  guest_name: decodedGuestName,
  guest_category: decodedCategory,
  timestamp: Date.now(),
  status: 'pending',
  rejection_reason: null,
  synced_at: null,
});
```

**Get Pending Scans (for sync):**
```typescript
const pendingScans = await db.getAllFromIndex('offline_scans', 'by_status', 'pending');
// Sort by timestamp for sequential processing
pendingScans.sort((a, b) => a.timestamp - b.timestamp);
```

**Update Scan Status:**
```typescript
const scan = await db.get('offline_scans', idempotencyKey);
if (scan) {
  scan.status = 'synced';
  scan.synced_at = Date.now();
  await db.put('offline_scans', scan);
}
```

**Cleanup Old Scans:**
```typescript
const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
const tx = db.transaction('offline_scans', 'readwrite');
let cursor = await tx.store.index('by_timestamp').openCursor();
while (cursor) {
  if (cursor.value.timestamp < cutoff) {
    await cursor.delete();
  }
  cursor = await cursor.continue();
}
await tx.done;
```

## Network Detection Strategy

### navigator.onLine Limitations

`navigator.onLine` is NOT a reliable source of truth:
- Returns `true` when connected to a network (WiFi/LAN) even without internet access
- Different browsers implement it differently -- Firefox historically only flagged offline when "Work Offline" was manually selected (though this has improved)
- Cannot detect server-specific outages (internet works but Go backend is down)

### Recommended Multi-Layer Detection

**Layer 1: WebSocket Connection State (Primary)**
If Phase 6 establishes a WebSocket from the vendor device to the Go backend (for session sync), this is the most reliable network indicator:
- WebSocket `close` event = backend unreachable (treat as offline)
- WebSocket `open` event = backend reachable (treat as online)
- No additional infrastructure needed -- piggybacks on existing connection

**Layer 2: navigator.onLine + Events (Fast Fallback)**
```typescript
// Immediate state
const isOnline = navigator.onLine;

// Change events
window.addEventListener('online', () => handleOnline());
window.addEventListener('offline', () => handleOffline());
```
- Good for detecting obvious network drops (airplane mode, WiFi disconnect)
- Fast: events fire immediately, no polling delay
- Unreliable for edge cases (connected to WiFi but no internet)

**Layer 3: Health Endpoint Heartbeat (Verification)**
```typescript
// Periodic ping to confirm actual backend reachability
const checkHealth = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/v1/health', {
      method: 'HEAD', // Lightweight
      signal: AbortSignal.timeout(3000), // 3s timeout
    });
    return res.ok;
  } catch {
    return false;
  }
};
```
- Use as verification when `navigator.onLine` says true but WebSocket is not connected
- Poll every 10 seconds when in uncertain state (WebSocket closed but navigator.onLine is true)
- Do NOT poll when WebSocket is healthy (wasteful)

### Network State Machine

```
online (WebSocket connected OR health ping succeeds)
  -> offline (WebSocket close + navigator.onLine false)
  -> offline (WebSocket close + 2 consecutive health ping failures)
  -> syncing (was offline, now online, pending scans > 0)

offline (no backend connectivity)
  -> online (WebSocket reconnects OR health ping succeeds)
  -> syncing (network restored + pending scans > 0)

syncing (processing offline queue)
  -> online (all pending scans processed)
  -> offline (network drops during sync -- partial sync OK, resume later)
```

### Debounce Strategy

Network flapping (rapid connect/disconnect cycles) can cause chaos. Debounce:
- **Offline transition:** 500ms delay before committing to offline state. If network comes back within 500ms, ignore the blip.
- **Online transition:** 2 second delay + 1 successful health ping before committing to online state and starting sync. Prevents starting sync during network instability.
- **Implementation:** Zustand store with debounced state updates via setTimeout, cleared on opposite event.

## Idempotency Key Strategy

### Client-Side Generation

**Recommended:** `crypto.randomUUID()` (Web Crypto API)

| Property | Value |
|----------|-------|
| API | `crypto.randomUUID()` |
| Output | RFC 4122 v4 UUID (e.g., `550e8400-e29b-41d4-a716-446655440000`) |
| Security | Cryptographically secure random |
| Browser support | Chrome 92+, Firefox 95+, Safari 15.4+, Edge 92+ |
| Requirement | Secure context (HTTPS or localhost) |
| Bundle cost | Zero (built-in browser API) |

**Why crypto.randomUUID() over custom format:**
- Zero dependencies -- built-in browser API
- Cryptographically secure -- no collision risk
- Standard format -- server can validate format if needed
- All target browsers support it (mobile Chrome, Safari, Firefox on Android/iOS)
- EventArc scanner will run over HTTPS (secure context requirement satisfied)

**Fallback for non-secure contexts:** Not needed. EventArc will be deployed with HTTPS. If somehow accessed over HTTP in development, `crypto.randomUUID()` works on localhost.

### Server-Side Handling

The existing Phase 4 scan endpoints use INSERT ON CONFLICT with idempotency keys (D-06 from Phase 4). The offline sync sends the same idempotency key generated client-side:

1. Client generates `crypto.randomUUID()` before saving to IndexedDB
2. On sync, client sends scan request with idempotency key in the request body
3. Server runs `INSERT INTO entry_scans ... ON CONFLICT (idempotency_key) DO NOTHING`
4. If conflict (already processed from a previous sync attempt), server returns success (idempotent)
5. No double-counting regardless of how many times the sync retries

## Sync Architecture

### Sequential Processing (D-04)

Queued scans MUST be processed sequentially in timestamp order, not in parallel:

**Why sequential, not parallel:**
- Preserves temporal ordering of scan events
- Prevents race conditions if two queued scans affect the same guest (e.g., guest scanned at two stalls while offline)
- Allows the server to validate each scan against the state that includes all previously synced scans
- Simpler error handling -- if scan N fails, you know scans 1..N-1 succeeded

**Implementation:**
```typescript
const syncOfflineScans = async () => {
  const pending = await db.getAllFromIndex('offline_scans', 'by_status', 'pending');
  pending.sort((a, b) => a.timestamp - b.timestamp);

  for (const scan of pending) {
    try {
      const endpoint = scan.scan_type === 'entry'
        ? '/api/v1/scan/entry'
        : '/api/v1/scan/food';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': getSessionToken(),
        },
        body: JSON.stringify({
          payload: scan.scan_payload,
          idempotency_key: scan.idempotency_key,
          stall_id: scan.stall_id,
          queued_at: scan.timestamp,
        }),
        signal: AbortSignal.timeout(10000), // 10s per scan
      });

      if (response.ok) {
        // Valid or idempotent (already processed)
        await updateScanStatus(scan.idempotency_key, 'synced');
      } else if (response.status === 409 || response.status === 422) {
        // Rejected (limit reached, already checked in, invalid)
        const error = await response.json();
        await updateScanStatus(scan.idempotency_key, 'rejected', error.error.message);
        // Trigger retroactive rejection toast
        addRejectionNotification(scan, error.error.message);
      } else {
        // Server error -- stop sync, retry later
        break;
      }
    } catch (e) {
      // Network error during sync -- stop, will retry on next reconnect
      break;
    }
  }
};
```

### Retry Strategy

- **Automatic retry:** On reconnect, sync starts automatically (no manual trigger needed)
- **No exponential backoff needed:** Each reconnect event triggers a fresh sync attempt. If sync fails mid-way due to network loss, it simply stops and waits for the next reconnect.
- **Partial sync recovery:** Each scan's status is updated individually. On next sync attempt, only `pending` scans are fetched -- already synced/rejected scans are skipped.

## Background Sync API Consideration

### Decision: Do NOT use Background Sync API

| Factor | Assessment |
|--------|------------|
| Browser support | Chrome/Edge only. Safari and Firefox do not support it. |
| EventArc target | Mobile browsers (iOS Safari + Android Chrome). Safari lack = dealbreaker. |
| Service Worker complexity | Requires registering a service worker, managing its lifecycle, communication between SW and main thread |
| Benefit over manual sync | Background Sync works when tab is closed. EventArc scanner is always open during events. |
| Verdict | **Do NOT use.** Manual sync-on-reconnect covers the use case with full browser support. |

The scanner tab is always open during event operation. There is no "close tab and sync later" use case. Manual sync triggered by `online` event + health ping verification gives full cross-browser support without service worker complexity.

## Existing Code Integration Points

### Backend (No Changes Needed)

The existing Phase 4 scan endpoints already support everything offline sync needs:
- `POST /api/v1/scan/entry` -- accepts idempotency key, returns scan result
- `POST /api/v1/scan/food` -- accepts idempotency key, returns scan result
- INSERT ON CONFLICT handles duplicate sync attempts
- Response format includes rejection reasons

**One potential addition:** The scan endpoints may need to accept a `queued_at` timestamp in the request body so the server can log when the scan was originally performed (not when it was synced). This is informational -- it does NOT affect validation logic.

### Frontend Files to Modify

| File/Module | Change |
|-------------|--------|
| `frontend/src/lib/offline-queue.ts` (NEW) | IndexedDB service: open DB, queue scan, get pending, update status, cleanup |
| `frontend/src/hooks/use-network-status.ts` (NEW) | Network detection hook: WebSocket + navigator.onLine + health ping |
| `frontend/src/hooks/use-offline-sync.ts` (NEW) | Sync orchestrator: triggers on reconnect, processes queue, handles rejections |
| Scanner Zustand store (extend) | Add networkStatus, pendingCount, syncProgress, rejections state |
| Scanner scan flow (extend) | Branch on networkStatus: online -> POST to server, offline -> queue to IndexedDB |
| Scanner bottom bar (extend) | Add PendingBadge component |
| Scanner top bar (extend) | Add OfflineBanner / ConnectionRestoredBanner components |

### GET /api/v1/health Endpoint

Already exists at `backend/internal/handler/health.go`. Returns `{"status":"ok","redis":"connected","postgres":"connected"}` with 200 OK when healthy. Can be used as the heartbeat ping endpoint for network verification. Use HEAD method for minimal payload.

## Testing Strategy

### Unit Tests (Vitest)

| Test | What It Verifies |
|------|-----------------|
| `offline-queue.test.ts` | IndexedDB operations: queue scan, get pending, update status, cleanup by age |
| `use-network-status.test.ts` | Network state transitions: online -> offline -> syncing -> online |
| `use-offline-sync.test.ts` | Sync logic: sequential processing, partial failure handling, rejection notification |
| `idempotency.test.ts` | Key generation format, uniqueness across 1000 generations |

### Integration Tests (Vitest + fake-indexeddb)

`fake-indexeddb` npm package provides an in-memory IndexedDB implementation for Node.js testing environments where real IndexedDB is unavailable.

| Test | What It Verifies |
|------|-----------------|
| Offline scan flow | Scan -> queue to IndexedDB -> verify record |
| Sync flow | Queue 5 scans -> trigger sync -> verify all marked synced |
| Rejection flow | Queue scan for over-limit guest -> sync -> verify rejection toast data |
| Cleanup flow | Create old scans -> run cleanup -> verify deletion |
| Partial sync | Queue 3 scans -> fail on scan 2 -> verify scan 1 synced, scan 2-3 pending |

### Manual Testing Checklist

| Test | Steps |
|------|-------|
| Basic offline queue | Open scanner, disconnect WiFi, scan 3 QRs, verify amber flash + pending badge shows 3 |
| Reconnect sync | Reconnect WiFi, verify green banner + pending scans sync sequentially |
| Retroactive rejection | Queue scan for guest at limit, reconnect, verify rejection toast appears |
| Idempotency | Queue scan, reconnect (sync), disconnect, reconnect again (resync) -- verify no double count |
| 30-minute cleanup | Queue scan, wait 30+ min, verify scan is auto-deleted from IndexedDB |
| Network flapping | Rapidly toggle WiFi 5 times in 10 seconds -- verify no duplicate syncs or ghost states |

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| idb for IndexedDB | HIGH | De facto standard wrapper, 1.2KB, Promise-based, TypeScript support, maintained by Chrome DevRel |
| crypto.randomUUID() for keys | HIGH | Built-in browser API, all target browsers support it, zero dependencies |
| navigator.onLine + health ping | HIGH | Well-documented limitations, multi-layer approach compensates for each layer's weaknesses |
| Sequential sync over parallel | HIGH | Correctness requirement from D-04, simpler error handling, no concurrent state issues |
| No Background Sync API | HIGH | Safari doesn't support it, scanner tab is always open, manual sync is simpler and cross-browser |
| fake-indexeddb for testing | MEDIUM | Well-maintained package but may have subtle behavior differences from real IndexedDB |
| 30-minute retention | HIGH | User decision D-07, simple timer-based cleanup, no edge cases beyond clock skew (negligible) |

---

*Phase: 07-offline-resilience*
*Research completed: 2026-04-12*
