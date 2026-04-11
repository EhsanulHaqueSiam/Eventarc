# Phase 9: Real-Time Admin Dashboard - Research

**Researched:** 2026-04-11
**Phase goal:** Admin sees live event metrics updated within seconds of each scan -- attendance, food consumption, vendor activity, and system health -- without any manual refresh

## Executive Summary

Phase 9 builds a live admin dashboard that displays event metrics in real-time via Server-Sent Events (SSE). The Go microservice reads Redis atomic counters and subscribes to Redis Pub/Sub channels, then pushes updates to connected admin browsers via SSE. The frontend uses EventSource API with auto-reconnect to receive updates and patches TanStack Query cache for instant UI updates. No scan tables are queried for aggregation -- all metrics come from atomic Redis counters established in Phase 4/5.

## Domain Research

### 1. Server-Sent Events (SSE) in Go

**Architecture:** SSE is a one-way server-to-client streaming protocol over HTTP. The server holds the connection open and pushes `data:` frames. The browser's `EventSource` API handles reconnection automatically with `Last-Event-ID` header.

**Go Implementation Pattern (chi + net/http):**
```go
func SSEHandler(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming not supported", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    w.Header().Set("X-Accel-Buffering", "no") // Nginx proxy support

    ctx := r.Context()
    for {
        select {
        case <-ctx.Done():
            return
        case msg := <-eventCh:
            fmt.Fprintf(w, "id: %s\nevent: %s\ndata: %s\n\n", msg.ID, msg.Type, msg.Data)
            flusher.Flush()
        }
    }
}
```

**Key decisions:**
- Use `http.Flusher` for streaming -- standard net/http supports SSE natively
- Each connected admin gets a goroutine that reads from a channel
- `X-Accel-Buffering: no` header prevents Nginx/Caddy from buffering SSE responses
- Event IDs enable resume after reconnection via `Last-Event-ID` header

**Connection management:**
- Track connected clients per event in a sync.Map or mutex-protected map
- On scan event (via Redis Pub/Sub), broadcast to all connected admins for that event
- Heartbeat every 15-30 seconds to detect stale connections (SSE spec supports `:` comment lines as keepalive)

### 2. Redis Pub/Sub for Scan Event Broadcasting

**Channel structure:**
- `event:{eventId}:scans` -- all scan events for a specific event
- Each scan publishes a JSON payload with scan type, result, counter deltas

**Publisher (scan handler, Phase 4/5):**
```go
// After successful scan, publish to Redis Pub/Sub
redisClient.Publish(ctx, fmt.Sprintf("event:%s:scans", eventID), scanEventJSON)
```

**Subscriber (SSE handler):**
```go
sub := redisClient.Subscribe(ctx, fmt.Sprintf("event:%s:scans", eventID))
ch := sub.Channel()
for msg := range ch {
    // Parse and forward to connected SSE clients
}
```

**Important:** Redis Pub/Sub is fire-and-forget. If the SSE handler is not subscribed when a scan happens, that event is lost. This is acceptable for dashboard updates because:
1. The next scan event will carry current counter values
2. On reconnect, the client fetches a full snapshot from Redis counters
3. Dashboard updates are ephemeral -- missing one update is self-healing

### 3. Redis Counter Key Structure (Phase 4/5 Established)

Based on Phase 4 context, the following Redis counter patterns exist:

**Entry counters (Phase 4):**
- `event:{eventId}:counters` hash with keys like:
  - `attendance` -- total checked-in guests
  - `total_invited` -- total guest count for the event
  - `scans_total` -- total scan attempts (including duplicates)
  - `scans_duplicate` -- duplicate scan count

**Food counters (Phase 5):**
- `event:{eventId}:counters` hash with keys like:
  - `food:{categoryName}:total` -- total servings for a food category
  - `food:{categoryName}:stall:{stallId}` -- per-stall serving count
  - `food_scans_total` -- total food scan attempts

**Vendor activity:**
- Per-stall scan tracking needs additional Redis keys:
  - `event:{eventId}:stall:{stallId}:last_scan` -- timestamp of last scan
  - `event:{eventId}:stall:{stallId}:scan_count` -- scan count per stall (for rate calculation)
  - `event:{eventId}:active_stalls` -- set of stall IDs with recent scan activity

### 4. Dashboard Data Model

**Metrics to display:**

| Metric | Source | Update Trigger |
|--------|--------|----------------|
| Attendance (checked-in / total) | Redis HGET `event:{id}:counters` attendance + total_invited | Entry scan |
| Food per-stall servings | Redis HGET `event:{id}:counters` food:{cat}:stall:{stallId} | Food scan |
| Food per-category totals | Redis HGET `event:{id}:counters` food:{cat}:total | Food scan |
| Consumption rates | Derived: delta over time window (30s/1m) | Computed client-side |
| Active scanning stations | Redis SMEMBERS `event:{id}:active_stalls` | Any scan |
| Scan rates per stall | Redis HGET per stall scan count, compute delta | Any scan |
| Last scan timestamp per stall | Redis GET `event:{id}:stall:{stallId}:last_scan` | Any scan |
| Duplicate scan attempts | Redis HGET `event:{id}:counters` scans_duplicate | Entry scan (duplicate) |
| System health | Redis PING + PG pool stats + active SSE connections | Periodic (15s heartbeat) |

### 5. Frontend SSE Integration with TanStack Query

**EventSource pattern:**
```typescript
const eventSource = new EventSource(`/api/v1/events/${eventId}/live`);

eventSource.addEventListener('counters', (e) => {
  const data = JSON.parse(e.data);
  queryClient.setQueryData(['event', eventId, 'dashboard'], data);
});

eventSource.addEventListener('alert', (e) => {
  const alert = JSON.parse(e.data);
  // Add to alerts list in query cache
});

eventSource.onerror = () => {
  // EventSource auto-reconnects; optionally show reconnecting indicator
};
```

**Cache update strategy:**
- SSE events directly patch TanStack Query cache via `queryClient.setQueryData`
- No polling -- all updates are push-based
- On reconnect, initial `snapshot` event carries full state
- Component re-renders automatically via TanStack Query subscriptions

### 6. SSE Event Types

| Event Type | Payload | When Sent |
|-----------|---------|-----------|
| `snapshot` | Full dashboard state (all counters, all stall statuses) | On initial connection |
| `counters` | Updated counter values (delta or full) | After each scan |
| `stall_activity` | Stall ID, scan count, last scan time, status | After each scan |
| `alert` | Alert type, severity, message, timestamp | On duplicate scan, offline device, rejected scan |
| `heartbeat` | Timestamp, active connections, system health | Every 15 seconds |

### 7. Alert System Design

**Alert types (DASH-04):**

| Alert | Trigger | Severity | Data |
|-------|---------|----------|------|
| Duplicate scan attempt | Entry scan returns "already checked in" | warning | guest name, original check-in time, stall |
| Offline device detected | Vendor WebSocket disconnect (Phase 6) | info | stall name, last seen time |
| Retroactive rejection | Offline sync rejects a queued scan (Phase 7) | warning | guest name, stall, reason |
| High scan rate | Stall exceeds threshold scans/min | info | stall name, rate |
| Counter mismatch | Redis counter != PG reconciliation | critical | counter key, redis value, pg value |

**Alert lifecycle:**
- Alerts appear in a scrollable feed with newest at top
- Each alert has: timestamp, type icon, severity color, message
- Alerts auto-age out (no persistence needed -- they're operational, not audit)
- Critical alerts are pinned at top until dismissed

### 8. Connection Management & Scaling

**Client tracking:**
```go
type SSEBroker struct {
    mu      sync.RWMutex
    clients map[string]map[chan SSEEvent]struct{} // eventID -> set of channels
}
```

- Each admin connection registers a channel in the broker
- On disconnect (context cancellation), channel is removed
- Redis Pub/Sub message triggers broadcast to all channels for that event
- Single Redis subscription per event (not per client) -- multiplexed

**Heartbeat:**
- Server sends `: heartbeat\n\n` (SSE comment) every 15 seconds
- Includes system health data every 3rd heartbeat (45s)
- Client uses `onerror` + retry to detect dropped connections

**Scaling consideration:**
- Single Go instance handles thousands of SSE connections (goroutines are cheap)
- For multi-instance: each instance subscribes to Redis Pub/Sub independently
- No coordination needed between instances -- Redis Pub/Sub handles fan-out

### 9. Authentication for SSE Endpoint

**Challenge:** SSE (EventSource API) doesn't support custom headers.

**Solutions:**
1. **Query parameter token:** `GET /api/v1/events/:id/live?token=<jwt>` -- simple but token in URL logs
2. **Cookie-based auth:** If admin session uses cookies, SSE inherits them automatically
3. **Initial handshake:** POST to get a short-lived SSE token, then use it in GET

**Recommended:** Cookie-based auth (Better Auth in Phase 1 uses cookies). The SSE endpoint validates the session cookie. If the admin is not authenticated, return 401 before streaming.

### 10. Snapshot on Connect

When a new SSE client connects, the server must send a full snapshot before streaming deltas:

1. Read all counters from Redis hash: `HGETALL event:{eventId}:counters`
2. Read active stalls: `SMEMBERS event:{eventId}:active_stalls`
3. Read per-stall metrics: pipeline HGET for each active stall
4. Package as `snapshot` event and send immediately
5. Then subscribe to Redis Pub/Sub and stream deltas

This ensures the dashboard shows correct state even if the admin connects mid-event.

## Validation Architecture

### Testable Claims

| # | Claim | Validation Method |
|---|-------|-------------------|
| V-1 | SSE endpoint streams events to connected clients | Integration test: connect EventSource, publish Redis event, verify receipt |
| V-2 | Dashboard counters match Redis counter values | Snapshot event contains same values as HGETALL on Redis |
| V-3 | Auto-reconnect restores full state | Disconnect, reconnect with Last-Event-ID, verify snapshot received |
| V-4 | Heartbeat maintains connection liveness | Connect, wait 20s, verify heartbeat received |
| V-5 | Alerts appear for duplicate scans | Trigger duplicate entry scan, verify alert SSE event |
| V-6 | No scan table queries for aggregation | Code review: grep for COUNT/SELECT on entry_scans/food_scans in dashboard code |
| V-7 | Multiple admin clients receive same updates | Connect 2 clients, publish event, both receive it |

### Sampling Points

- SSE event format conformance (id, event, data fields)
- Redis Pub/Sub channel naming matches scan publishers
- Counter key names match Phase 4/5 established patterns
- Frontend EventSource reconnection behavior
- Alert type completeness (all 5 types from DASH-04)

## Key Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SSE connections accumulate and exhaust memory | Low | Medium | Broker tracks clients, cleanup on disconnect, set max connections per event |
| Redis Pub/Sub message lost during SSE handler restart | Medium | Low | Snapshot on reconnect self-heals; missed events are cosmetic, not data integrity |
| Nginx/proxy buffers SSE responses | Medium | Medium | X-Accel-Buffering header, documented proxy config |
| EventSource doesn't support auth headers | N/A | Low | Use cookie-based auth (already in place via Better Auth) |
| Counter key naming mismatch with Phase 4/5 | Medium | High | Plan must specify exact key names and read Phase 4/5 code before implementation |

## Dependencies

| Dependency | Phase | Status | Required For |
|-----------|-------|--------|-------------|
| Redis atomic counters (HINCRBY) | Phase 4 | Planned | Reading counter values |
| Redis Pub/Sub scan broadcasting | Phase 4 | Planned | SSE event trigger |
| Food consumption counters | Phase 5 | Planned | Food metrics display |
| Vendor session monitoring | Phase 6 | Planned | Active stall tracking |
| Better Auth admin session | Phase 1 | Implemented | SSE endpoint authentication |

## Recommendations

1. **Two plans:** Plan 09-01 for Go SSE backend (broker, handler, Redis integration), Plan 09-02 for frontend dashboard UI (EventSource client, metric cards, alerts feed, TanStack Query integration)
2. **SSE event format:** Use named events (`event: counters`, `event: alert`, etc.) with JSON data payloads and sequential numeric IDs for resume support
3. **Snapshot-then-delta pattern:** Always send full state on connect, then stream incremental updates
4. **Heartbeat interval:** 15 seconds (keeps connections alive through proxies, low overhead)
5. **Alert feed:** In-memory on frontend, no persistence needed -- alerts are operational, not audit trail

## RESEARCH COMPLETE
