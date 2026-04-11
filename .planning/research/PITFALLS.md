# Pitfalls Research

**Domain:** High-concurrency event management with QR-based access control
**Researched:** 2026-04-11
**Confidence:** HIGH (core concurrency/scan pitfalls) to MEDIUM (SMS delivery specifics, offline edge cases)

## Critical Pitfalls

### Pitfall 1: Race Condition on Concurrent Scans of the Same QR Code

**What goes wrong:**
Two vendor devices scan the same guest's QR code within milliseconds (guest shows QR at one gate, spouse photographs it, tries another gate). Both scan requests hit the server simultaneously. Without proper serialization, both reads see "not yet scanned," both proceed, and the guest is marked as entered twice -- or worse, two people enter on one ticket. This is the single highest-risk failure mode for the entire system.

**Why it happens:**
Developers test with sequential requests. The race window is small enough (< 50ms) that it never shows up in manual testing or even basic load tests. The classic check-then-act pattern (`SELECT status WHERE qr_id = X; UPDATE status = 'used'`) is not atomic. Even Redis GET + SET is not atomic without Lua scripting. With 10K concurrent scans, even a tiny race window gets triggered statistically.

**How to avoid:**
- Use database-level `INSERT ... ON CONFLICT DO NOTHING` (PostgreSQL) or `INSERT IGNORE` (MySQL) into a `scans` table with a unique constraint on `(qr_code_id, scan_type)`. The first insert wins; the second gets a conflict error. This is atomic at the database level.
- For the Redis hot path, use a Lua script that atomically checks-and-sets: `if redis.call('SETNX', key, value) == 1 then ... end`. Single-threaded Redis guarantees this executes without interleaving.
- Never use a read-then-write pattern without a lock or atomic primitive.
- Generate a client-side scan UUID (idempotency key) on each scan event so retries of the same physical scan are deduplicated.

**Warning signs:**
- Any code path where a `SELECT` precedes an `UPDATE` on scan state without a transaction with `SELECT FOR UPDATE` or equivalent.
- Unit tests that pass but integration tests with concurrent goroutines fail sporadically.
- Run Go's `-race` detector in all tests and CI -- this catches shared memory races (though not distributed races across Redis/DB).

**Phase to address:**
Core scan processing (Phase 1 or 2 -- must be in the first functional phase that implements scanning). This cannot be deferred. The entire system's credibility depends on this being correct from day one.

---

### Pitfall 2: Redis Counter Drift -- Losing Real-Time Counts on Crash or Restart

**What goes wrong:**
Atomic counters live in Redis for real-time dashboard performance. Redis crashes, restarts, or undergoes failover. Counters reset to zero or to a stale RDB snapshot value. The admin dashboard suddenly shows 0 attendees after 3,000 have already entered. During a live event, this is catastrophic -- admin loses visibility, makes wrong decisions (opens more gates, calls capacity reached incorrectly).

**Why it happens:**
Redis RDB snapshots happen at intervals (default: every 60 seconds if 1000+ keys changed). AOF with `appendfsync everysec` can lose up to 1 second of writes. Even with `appendfsync always`, kernel crashes can lose buffered writes. Teams treat Redis as the source of truth for counters instead of as a fast read cache backed by a durable store.

**How to avoid:**
- Treat the database (PostgreSQL) as the source of truth. Every scan writes to the database first (or at minimum, concurrently via write-behind with very short flush intervals of 1-2 seconds).
- Use Redis INCR for real-time speed, but periodically reconcile: a background job every 30-60 seconds runs `SELECT COUNT(*) FROM scans WHERE event_id = X AND type = 'entry'` and overwrites the Redis counter if they diverge. This is your safety net.
- On Redis restart, immediately re-seed counters from the database before the dashboard connects.
- Monitor the delta between Redis counters and database counts. Alert if drift exceeds a threshold (e.g., > 5).

**Warning signs:**
- No reconciliation job exists between Redis and the database.
- Redis persistence is set to default (RDB only) without AOF enabled.
- Counter values are only in Redis with no database backing.
- No startup procedure to warm Redis from the database.

**Phase to address:**
Real-time dashboard phase. Must be designed into the counter system from the start, not bolted on after counters "work in dev."

---

### Pitfall 3: Offline Scan Queue Creates Duplicates on Sync

**What goes wrong:**
A vendor's device loses network connectivity for 30 seconds. During that time, 15 scans queue locally. Network returns. The device replays all 15 scans. But 3 of those guests had already been scanned at another gate (which was online). The sync creates duplicate scan records, corrupts attendance counts, or -- worst case -- marks a guest as having consumed a food item they didn't actually receive, burning their allocation.

Additionally: the same device might retry a queued scan multiple times if the first sync attempt times out but actually succeeded server-side. Without idempotency, each retry creates a new scan record.

**Why it happens:**
Offline sync is deceptively simple to implement ("just queue and replay") but deceptively hard to make correct. The core problem is that the world changed while the device was offline. Other devices may have processed the same QR codes. The queued scans represent stale intent.

**How to avoid:**
- Every scan event must carry a client-generated UUID (created at scan time, not sync time). The server uses this as an idempotency key with a unique constraint. Replaying the same UUID is a no-op.
- The server must return the result of the *original* processing for replayed idempotency keys, not a generic "duplicate" error. The device needs to know: was this scan accepted (first time) or was it already processed (by this or another device)?
- Store the scan timestamp from the device clock alongside the server receipt time. Use the device timestamp for ordering/analytics, the server timestamp for conflict resolution.
- Queue implementation must be durable -- use IndexedDB, not in-memory arrays. A browser refresh should not lose queued scans.

**Warning signs:**
- Scan API endpoint does not accept or enforce an idempotency key.
- Offline queue uses `localStorage` or in-memory storage (lost on refresh/crash).
- No test scenario for "scan on offline device A, same QR scanned on online device B, then device A syncs."
- Sync endpoint returns different responses for initial vs. replayed requests.

**Phase to address:**
Vendor scanning phase. Must be designed into the scan API contract from the beginning -- retrofitting idempotency keys is painful because it requires client and server changes simultaneously.

---

### Pitfall 4: QR Code Forgery Through Predictable or Unsigned Payloads

**What goes wrong:**
QR codes contain a simple guest ID or sequential number (`GUEST-00001`). An attacker scans one legitimate QR code, understands the pattern, and generates thousands of fake QR codes. They distribute these and unauthorized people enter the event. Alternatively, a legitimate guest screenshots their QR and shares it with friends via WhatsApp -- multiple people try to enter with the same code.

**Why it happens:**
Teams focus on the scanning flow and forget that QR code content is just plaintext data that anyone can read and reproduce. If the payload is predictable (sequential IDs, UUIDs without server-side validation, or any pattern that can be guessed), the security model is broken.

**How to avoid:**
- Sign QR payloads with HMAC-SHA256 using a server-side secret: `payload = guestID + eventID + timestamp`, `signature = HMAC(secret, payload)`, `qr_content = base64(payload + signature)`. The scan endpoint verifies the signature before processing. Forgery requires knowing the secret key.
- Use sufficiently random tokens (128-bit minimum) as QR identifiers instead of or alongside guest IDs. Store the token-to-guest mapping server-side. The QR contains only the random token.
- For screenshot/sharing prevention: enforce single-use scanning. Once a QR is scanned for entry, it is consumed. Second scan at any gate returns "already entered." Display the guest name on the vendor screen so the operator can challenge mismatches.
- Do NOT embed sensitive data (guest name, phone number) directly in the QR. The QR should be a lookup token, not a data carrier.

**Warning signs:**
- QR payload is human-readable with predictable patterns (sequential numbers, known formats).
- No cryptographic signature or HMAC in the QR payload.
- No server-side lookup required -- QR is self-validating (like a JWT without revocation).
- No "already scanned" enforcement for entry QR codes.

**Phase to address:**
QR generation phase. The QR content format must include signatures from the start. Changing QR format after 60K invitation cards have been sent is impossible -- you cannot recall printed/sent QR codes.

---

### Pitfall 5: Dashboard Queries DDoS Your Own Database

**What goes wrong:**
The admin dashboard polls the database every second for live counts: `SELECT COUNT(*) FROM scans WHERE event_id = X GROUP BY vendor_type`. With 60K rows growing in real-time and multiple dashboard viewers, this query runs repeatedly against a table being hammered by 10K concurrent scan writes. The database locks up, scan processing latency spikes from 50ms to 5 seconds, vendor devices start timing out, and the scanning system -- the critical path -- fails because the dashboard -- a secondary concern -- saturated the database.

**Why it happens:**
Dashboard queries feel lightweight in development with 100 test records. At scale, `COUNT(*)` on a large, write-heavy table requires a full index scan (PostgreSQL's MVCC means `COUNT(*)` is always a scan, never a cached value). Developers don't realize that reading analytics and writing scans compete for the same database connection pool and I/O bandwidth.

**How to avoid:**
- Atomic counters in Redis (INCR on scan, DECR on reversal). Dashboard reads only from Redis, never from the scan table.
- If complex aggregations are needed (food consumption by stall by time window), use a dedicated read replica or materialized views refreshed on a schedule (every 30 seconds, not on every request).
- WebSocket/SSE push model: the server pushes counter updates to connected dashboards on each scan event. Dashboard never polls. This eliminates the N+1 query problem of multiple dashboard viewers.
- Connection pool isolation: if dashboard queries must hit the database, use a separate connection pool with lower priority and a hard query timeout (500ms). Don't let analytics queries starve scan processing.

**Warning signs:**
- Dashboard code contains `SELECT COUNT(*)` or `SELECT ... GROUP BY` against the main scan table.
- No Redis counter layer exists; dashboard reads directly from the write database.
- Database connection pool is shared between scan endpoints and dashboard endpoints.
- Load test shows scan latency increasing when a dashboard is open.

**Phase to address:**
Must be addressed when the dashboard is built, but the counter architecture must be designed from the scan processing phase. If scans don't INCR counters from day one, adding counters later requires backfilling.

---

### Pitfall 6: SMS Delivery Failure at Scale -- 60K Messages Blocked by Carrier Rate Limits

**What goes wrong:**
Admin clicks "Send Invitations" and the system fires 60K SMS messages in a burst. The carrier/aggregator detects the spike as potential spam, throttles or blocks the sender ID. Delivery rate drops from 95% to 30%. Thousands of guests never receive their invitation. The admin doesn't know until guests start calling "I didn't get my SMS." No delivery tracking exists, so there is no way to identify who was missed or retry.

**Why it happens:**
SMS APIs accept messages faster than carriers deliver them. A bulk send of 60K messages in minutes triggers carrier spam detection. Different countries/carriers have different rate limits (Bangladesh carriers have specific throughput caps that are not documented in international SMS API docs). Teams test with 10 messages and assume it scales linearly.

**How to avoid:**
- Throttled sending: spread 60K messages over 30-60 minutes using a job queue with configurable throughput (e.g., 200-500 messages per minute, tuned to carrier limits).
- Implement delivery receipt tracking via webhook callbacks from the SMS provider. Store delivery status per guest (queued, sent, delivered, failed, rejected).
- Build a retry mechanism for failed deliveries with exponential backoff. Different failure codes require different strategies (invalid number = don't retry; network timeout = retry in 5 minutes; rate limited = slow down and retry).
- Dashboard showing SMS delivery status: sent/delivered/failed/pending per batch. Admin should see "4,200 of 60,000 failed" with a "Retry Failed" button.
- Test with the actual carrier/gateway at scale before event day. A test batch of 1,000 messages reveals rate limit behavior.

**Warning signs:**
- No throttling/rate-limiting on the SMS sending pipeline.
- No delivery receipt webhook integration.
- No per-guest delivery status tracking in the database.
- SMS provider documentation doesn't mention rate limits for your target country.
- "Send All" button triggers a synchronous bulk send instead of queueing.

**Phase to address:**
SMS invitation phase. Throttling and delivery tracking must be built into the first SMS implementation, not added after the first failed bulk send.

---

### Pitfall 7: Image Compositing Pipeline Blocks Event Preparation

**What goes wrong:**
Admin uploads a card design, positions the QR, and clicks "Generate All Cards." The system tries to composite 60K images synchronously or in an under-provisioned worker pool. It takes 6+ hours to complete. Midway through, a worker crashes, and there is no checkpoint -- it starts over from scratch. Or worse: the system runs out of memory because it loads all 60K base images into RAM simultaneously. The event is tomorrow and invitation cards are not ready.

**Why it happens:**
Image processing is CPU and memory intensive. A single card composite (load base image + load QR + overlay + encode output) takes 50-200ms depending on image size and format. At 60K cards, even at 100ms each, that is 100 minutes sequentially. Teams underestimate this because they test with 10 cards.

**How to avoid:**
- Process cards in a background job queue with parallel workers (8-16 concurrent compositing goroutines, tuned to CPU cores). Never in the request/response cycle.
- Checkpoint progress: track which guest cards are generated. If the process crashes, resume from the last ungengerated card, don't restart.
- Stream-process: load one base image into memory, overlay QR per-guest, write output, move to next. Don't load all images into memory.
- Use a fast compositing library (libvips via Go bindings, not ImageMagick -- libvips uses 1/10th the memory for the same operations).
- Show progress to admin: "32,400 of 60,000 generated" with estimated time remaining.
- Generate cards asynchronously and allow the admin to continue other setup tasks. Notify when complete.

**Warning signs:**
- Card generation is synchronous (blocks the HTTP request).
- No progress tracking or resume capability.
- Using ImageMagick shell commands instead of an in-process library.
- Memory usage spikes to multiple GB during generation.
- No load test with 60K cards has been performed.

**Phase to address:**
Invitation card generation phase. The pipeline architecture (job queue, progress tracking, resume) must be designed from the start.

---

### Pitfall 8: Vendor Device Session Hijacking via URL Sharing

**What goes wrong:**
Vendor scanning stations use device-based sessions with no login (by design -- temp staff won't remember credentials). The session is tied to a URL or a cookie. A vendor shares the scanning URL ("hey, use this link on your phone too"). Now an unauthorized device can process scans. Or: a malicious actor discovers the URL pattern and accesses the scanning interface from outside the venue, submitting fake scan events.

**Why it happens:**
The "no-credential" design for vendor convenience creates a tension with security. Device fingerprinting is unreliable and easily spoofed. URL-based tokens can be shared, bookmarked, or intercepted on shared WiFi.

**How to avoid:**
- Device registration flow: vendor opens a generic URL, admin approves the device from the admin dashboard (one-time pairing). The approved device receives a short-lived token stored in a secure cookie. Unregistered devices see a "waiting for approval" screen.
- Bind sessions to device fingerprint (User-Agent + screen resolution + a locally-generated device key stored in IndexedDB). Flag if the same session token appears from a different fingerprint.
- Rate-limit scan submissions per device. A legitimate scanner processes 1-3 scans per second max. Flag devices submitting 50 scans/second as potentially automated/fraudulent.
- Sessions should be scoped to a single event and automatically expire when the event ends.
- All scan traffic should require HTTPS. Consider IP allowlisting if the venue network is controlled.

**Warning signs:**
- Vendor scanning URL contains the session token in the URL path or query string (shareable).
- No device registration/approval workflow exists.
- No rate limiting on the scan endpoint per device/session.
- Sessions don't expire or are valid across events.

**Phase to address:**
Vendor scanning phase. Device session security must be designed alongside the scanning interface.

---

### Pitfall 9: Over-Engineering Configurability -- The "Make Everything Configurable" Trap

**What goes wrong:**
The system has configurable QR modes, configurable food rules, configurable vendor hierarchies, configurable card layouts, configurable timing for food QR distribution. Each configuration axis multiplies the number of code paths. A change to the scan processing logic must now handle: single QR vs separate QR, guest-linked food vs anonymous food, pre-sent food QR vs post-entry food QR, per-person food limits vs unlimited. That is 2 x 2 x 2 x 2 = 16 code paths in scan processing alone. Bugs hide in rarely-tested combinations. Event day: admin configured "anonymous food + post-entry QR + per-stall limits" -- a combination no one tested -- and the scan endpoint returns 500 errors.

**Why it happens:**
Product requirements genuinely need flexibility (different events have different needs). But developers implement flexibility as runtime configuration with conditionals scattered throughout business logic (`if config.qrMode == "unified" { ... } else { ... }`). Each new configuration axis creates a combinatorial explosion of states.

**How to avoid:**
- Strategy pattern: implement each configuration combination as a concrete strategy class/struct. `UnifiedQRGuestLinkedFoodStrategy`, `SeparateQRAnonFoodStrategy`, etc. Each strategy is tested independently. The event configuration selects a strategy at creation time, not a bag of flags evaluated at runtime.
- Limit configuration to known, tested combinations. Don't allow arbitrary mix-and-match. An event picks a "mode" (e.g., "Standard," "Festival," "VIP Dinner") that sets all flags coherently.
- Integration tests for every supported configuration combination. If a combination isn't tested, it shouldn't be available in the UI.
- Start with fewer modes (2-3) for v1. Add modes when real users request them, not speculatively.

**Warning signs:**
- Business logic contains nested `if/switch` statements checking multiple configuration flags.
- No integration tests exist for specific configuration combinations.
- New features require modifying multiple conditional branches.
- QA cannot enumerate all valid configuration states.

**Phase to address:**
Architecture/design phase (Phase 1). The strategy pattern must be the architectural decision before any business logic is written. Retrofitting strategies onto scattered conditionals is a rewrite.

---

### Pitfall 10: Event Day Total System Failure Due to Untested Infrastructure

**What goes wrong:**
Everything works in staging with 100 test users. Event day arrives with 10K concurrent users. The database connection pool (default 25 connections) is exhausted in seconds. Redis memory limit is hit and starts evicting counter keys. The reverse proxy timeout is 30 seconds but scan endpoints should respond in 200ms -- one slow query backs up the entire proxy queue. Vendor devices show spinners. The entry line backs up to 2,000 people. The event starts 45 minutes late. The admin loses trust in the system and falls back to manual paper lists.

**Why it happens:**
No load test was performed against production-equivalent infrastructure. Default configurations for databases, connection pools, proxies, and Redis are designed for development convenience, not production load. The team assumed "it works" means "it scales."

**How to avoid:**
- Mandatory load test before any event: simulate 10K concurrent scan requests against a staging environment mirroring production. Use k6, vegeta (Go), or similar tools.
- Configuration checklist for production deployment:
  - Database max connections: at least 100 (tuned to instance size)
  - Redis maxmemory-policy: `noeviction` (fail loudly rather than silently dropping counters)
  - Reverse proxy timeouts: 5-second max for scan endpoints
  - Worker pool sizes: matched to CPU cores
  - WebSocket/SSE connection limits: sized for expected dashboard viewers
- Circuit breaker pattern: if database latency exceeds 500ms, scan processing falls back to Redis-only mode (with degraded durability) rather than timing out completely.
- Health check endpoint that the admin dashboard shows prominently: "System: GREEN/YELLOW/RED" based on database latency, Redis connectivity, and queue depth.

**Warning signs:**
- No load testing scripts exist in the repository.
- Production infrastructure uses default configuration values.
- No health check endpoint or system status indicator exists.
- No documented runbook for "what to do if X fails during an event."
- First real load test is the actual event.

**Phase to address:**
Pre-launch / hardening phase (final phase before production). But load testing scripts should be developed incrementally from the scan processing phase onward.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip Redis, query DB for dashboard counts | Faster initial build, one less infrastructure component | Dashboard kills DB under load at 1K+ concurrent scans | Never for production. Acceptable only in earliest local dev prototype. |
| Use `localStorage` for offline scan queue | Quick to implement, works in browser | 5MB limit, lost on clear-browsing-data, no structured querying | Never. Use IndexedDB from the start. |
| Sequential image compositing (no job queue) | Simpler code, no queue infrastructure | 60K cards take 2+ hours, no resume on failure, blocks admin | Only acceptable if event size < 500 guests |
| Shared DB connection pool for scans + dashboard | Simpler connection management | Dashboard queries starve scan processing under load | Never for production events > 1K guests |
| Hardcoded SMS sending without throttle | Faster to implement, "just call the API" | Carrier blocks at scale, no retry, no delivery tracking | Never. Even 100-recipient sends should be queued. |
| Global mutable config instead of strategy pattern | Faster to prototype first feature | Combinatorial explosion of untested code paths | Acceptable in earliest prototype if refactored before second config axis is added |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| SMS Provider (BulkSMS/equivalent) | Sending all messages in a burst, ignoring rate limits | Queue with configurable TPS, implement delivery webhooks, handle per-message failure codes differently |
| Redis | Treating INCR as durable (no DB backing), using GET-then-SET instead of Lua for compound operations | Write-behind to DB, Lua scripts for atomic multi-step operations, AOF persistence with everysec, startup counter warm-up from DB |
| Cloud Storage (S3/R2) | Generating pre-signed URLs that expire before event day, or using public buckets | CDN with long-lived signed URLs (7+ days), bucket is private, CDN handles caching and access |
| WebSocket/SSE | Opening one connection per dashboard widget, no reconnection logic, no message buffering | Single multiplexed connection, automatic reconnect with exponential backoff, server-side message buffer for missed events |
| PostgreSQL at concurrency | Using `SELECT ... FOR UPDATE` which serializes all scan writes, or default connection pool (25) | Use `INSERT ON CONFLICT` for lock-free idempotency, size pool to 100+ connections, use PgBouncer for connection pooling |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| COUNT(*) on scans table for dashboard | Scan latency spikes when dashboard is open | Atomic Redis counters, read from counters not table | > 5K rows in scan table with concurrent writes |
| Loading all 60K QR images into memory for compositing | OOM kill, process crash, swap thrashing | Stream-process one at a time, use libvips (low-memory) not ImageMagick | > 1K images at 500KB+ each |
| Unbounded WebSocket fan-out (push every scan to every dashboard) | Server CPU spikes, dashboard UI freezes | Batch/throttle: aggregate scan events, push summary every 500ms, not per-scan | > 50 scans/second with > 3 dashboard viewers |
| No connection pooling (new DB connection per scan) | Connection exhaustion, "too many connections" errors | Use PgBouncer or built-in pool, pre-warm connections | > 100 concurrent requests |
| Synchronous QR code generation during guest import | CSV import of 60K guests hangs for hours, times out | Async job queue: import creates guest records, separate job generates QR images | > 500 guests imported at once |
| Full table scan for QR validation on scan | Scan latency > 1 second, vendor devices time out | Index on QR token column, Redis lookup cache in front of DB | > 10K guests per event |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Predictable QR content (sequential IDs, guest-name-based) | Mass forgery -- attacker generates thousands of valid QR codes | HMAC-SHA256 signed payloads with server secret, or random 128-bit tokens with server-side lookup |
| No single-use enforcement on entry QR | One QR screenshot shared to unlimited people, all enter | Atomic "mark as used" on first scan; second scan returns "already entered" with guest name for operator challenge |
| Vendor session token in URL query parameter | URL copied/shared/logged in proxy logs, session hijacked | Token in HttpOnly secure cookie, device registration with admin approval |
| No rate limit on scan endpoint | Automated brute-force: attacker submits random tokens at high speed to find valid ones | Per-device rate limit (5 scans/second max), IP-based rate limit, CAPTCHA after repeated failures |
| QR contains PII (guest name, phone number) | Privacy violation -- anyone scanning the QR reads personal data | QR contains only an opaque token. Guest details retrieved server-side after authentication. |
| No HTTPS on venue scanning network | Man-in-the-middle captures session tokens and scan data on shared WiFi | Enforce HTTPS everywhere, even on local venue network. HSTS headers. |
| Food QR reuse in anonymous mode | Same QR used multiple times at same stall for unlimited food | Even anonymous QR must have per-stall consumption tracking. Mark QR-stall pair as consumed. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Vendor scan result only shows "Success" or "Error" | Vendor cannot verify identity, cannot distinguish "already scanned" from "invalid QR" | Show guest name + photo (if available) on success, clear error reason on failure ("Already entered at Gate 2 at 14:32", "Invalid QR", "Guest not found") |
| No audio/haptic feedback on scan | In noisy event venues, vendor misses the visual result, scans again (duplicate) | Distinct sounds for success vs. rejection. Green/red full-screen flash. Vibration pattern. |
| Dashboard shows raw numbers without context | Admin sees "3,241 entered" but doesn't know if that's good or bad | Show percentages ("3,241 / 8,500 expected = 38%"), trends ("412/min current rate"), and alerts ("Fuchka Stall 3 has not scanned in 15 minutes -- check device") |
| SMS invitation contains only a link, no context | Recipient doesn't know what the SMS is about, thinks it's spam, doesn't click | Include event name, date, and a brief message before the link. Match the sender ID to the organization name. |
| Admin card editor doesn't preview at actual QR scan size | QR is placed beautifully on the card but too small to scan reliably at arm's length | Show a "scannability indicator" in the editor. Warn if QR size < 2cm at print resolution. Test scan the preview. |
| Offline queue silently drops scans on reconnection failure | Vendor thinks scans were recorded; they weren't | Show persistent "X scans pending sync" badge. Alert if sync fails. Never silently discard queued scans. |

## "Looks Done But Isn't" Checklist

- [ ] **Scan Processing:** Has been load-tested with 10K concurrent requests against production-equivalent infra -- not just "works with 10 sequential curl requests."
- [ ] **Idempotency:** Scan endpoint handles duplicate requests with the same idempotency key correctly, including concurrent duplicates (not just sequential retries).
- [ ] **Offline Queue:** Tested with: device goes offline, scans 20 QRs, comes back online, syncs -- while another device scanned 5 of the same QRs while first device was offline. All 20 scans resolve correctly (15 accepted, 5 "already scanned").
- [ ] **Redis Counters:** Verified that counters survive Redis restart. Tested: stop Redis, restart, check counters are reseeded from DB before dashboard reconnects.
- [ ] **SMS Delivery:** Tested a batch of 1,000+ messages to real numbers through the production SMS gateway. Verified delivery rate > 95%. Delivery status webhook is functional.
- [ ] **Image Pipeline:** Generated 60K test cards end-to-end. Measured time and memory usage. Verified resume after crash (kill process at 30K, restart, it continues from 30,001).
- [ ] **QR Security:** Attempted to forge a QR code by modifying one character of a valid QR payload. Verified server rejects it. Attempted to reuse a scanned entry QR. Verified rejection with correct error message.
- [ ] **Dashboard Under Load:** Opened 5 dashboard instances while running 10K concurrent scans. Verified scan latency does not degrade (< 200ms p99). Dashboard updates within 2 seconds.
- [ ] **Configuration Combinations:** Every supported event configuration mode has an end-to-end integration test covering the full scan flow (entry + food + dashboard update).
- [ ] **Device Sessions:** Verified that a vendor session token from one event cannot be used for a different event. Verified session expires after event end time.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Race condition causes double-entry | MEDIUM | Query scan table for duplicates (`GROUP BY qr_id HAVING COUNT > 1`). Delete duplicate records. Recalculate counters from DB. Fix the check-then-act code path. |
| Redis counters lost on crash | LOW | Reseed all counters from `SELECT COUNT(*) ... GROUP BY` queries. Publish reseeded values to dashboard via SSE. Add reconciliation job. |
| SMS batch blocked by carrier | HIGH | Identify undelivered guests from delivery status table. Retry with lower throughput (50/minute). If carrier blocked sender ID, switch to backup provider. Manual communication for urgent cases. |
| 60K image generation failed midway | LOW (if checkpointed) / HIGH (if not) | With checkpointing: restart job, it resumes from last generated card. Without: re-run entire job (2+ hours lost). Add checkpointing immediately. |
| QR codes forged/shared at scale | HIGH | Cannot recall sent QR codes. Emergency: rotate QR validation (invalidate all old QRs, re-issue to legitimate guests via SMS). This is a last resort and very disruptive. Better to prevent. |
| Dashboard queries killing database | MEDIUM | Immediately disable dashboard auto-refresh. Switch to manual refresh. Deploy Redis counter layer. Restore scan processing first, dashboard second. |
| Vendor session hijacked | MEDIUM | Revoke all active vendor sessions for the event. Re-register legitimate devices. Review scan logs for anomalous patterns (scans from unexpected IP ranges or after event hours). |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Race condition on concurrent scans | Scan Processing (earliest functional phase) | Load test: 10K concurrent scans of 1000 unique QRs, 10 scans per QR. Verify exactly 1000 accepted, 9000 rejected. |
| Redis counter drift | Real-time Dashboard phase | Kill Redis during active scanning. Restart. Verify counters match DB within 60 seconds. |
| Offline duplicate scans | Vendor Scanning phase | Automated test: two simulated devices, overlapping offline/online windows, shared QR targets. |
| QR code forgery | QR Generation phase | Security review of QR payload format. Penetration test: attempt forgery and replay. |
| Dashboard DDoS-ing database | Real-time Dashboard phase | Load test with dashboard open during peak scan load. Verify scan p99 < 200ms. |
| SMS delivery failure | SMS/Invitation phase | Production test batch of 1,000+ messages. Verify delivery rate and webhook functionality. |
| Image pipeline blocking | Card Generation phase | Generate 60K test images. Measure time, memory, and resume capability. |
| Vendor session hijack | Vendor Scanning phase | Security review of session model. Attempt session reuse across events. |
| Configuration complexity explosion | Architecture/Design phase (Phase 1) | Code review: no scan processing code path has > 2 conditional branches on configuration. Strategy pattern enforced. |
| Untested infrastructure at scale | Pre-launch Hardening phase | Full load test report with 10K concurrent users. All production configs documented and reviewed. |

## Sources

- [Redis INCR atomicity and single-threaded guarantees](https://redis.io/docs/latest/commands/incr/)
- [Fixing Race Conditions in Redis Counters with Lua Scripting](https://dev.to/silentwatcher_95/fixing-race-conditions-in-redis-counters-why-lua-scripting-is-the-key-to-atomicity-and-reliability-38a4)
- [Redis Persistence: RDB vs AOF](https://redis.io/tutorials/operate/redis-at-scale/persistence-and-durability/)
- [Redis Data Loss Recovery](https://oneuptime.com/blog/post/2026-03-31-redis-recover-from-redis-data-loss/view)
- [Write-Behind Caching with Redis](https://oneuptime.com/blog/post/2026-01-25-write-through-write-behind-caching-redis/view)
- [Hidden Problems of Offline-First Sync: Idempotency, Retry Storms](https://dev.to/salazarismo/the-hidden-problems-of-offline-first-sync-idempotency-retry-storms-and-dead-letters-1no8)
- [Offline-First Mobile Architecture](https://www.researchgate.net/publication/393910615_Offline-First_Mobile_Architecture_Enhancing_Usability_and_Resilience_in_Mobile_Systems)
- [Implementing Idempotency Keys in REST APIs](https://zuplo.com/learning-center/implementing-idempotency-keys-in-rest-apis-a-complete-guide)
- [Stripe Idempotent Requests](https://docs.stripe.com/api/idempotent_requests)
- [HMAC-based QR Code Authentication](https://link.springer.com/chapter/10.1007/978-3-662-45402-2_14)
- [Cryptographic QR Codes](https://iotready.com/blog/cryptographic-qr-codes-demo)
- [OASIS Secure QR Code Authentication Standard](https://docs.oasis-open.org/esat/sqrap/v1.0/csd01/sqrap-v1.0-csd01.html)
- [SSE vs WebSockets for Real-Time Dashboards](https://dev.to/polliog/server-sent-events-beat-websockets-for-95-of-real-time-apps-heres-why-a4l)
- [WebSocket Scaling Patterns for Dashboards](https://medium.com/@sparknp1/10-websocket-scaling-patterns-for-real-time-dashboards-1e9dc4681741)
- [WebSocket Architecture Best Practices (Ably)](https://ably.com/topic/websocket-architecture-best-practices)
- [SMS Deliverability Best Practices](https://textellent.com/sms-guides-and-troubleshooting/bulk-sms-deliverability/)
- [SMS Delivery Rate Improvement 2026](https://www.text-em-all.com/blog/sms-delivery-rate)
- [Go Race Detector](https://go.dev/doc/articles/race_detector)
- [Go Concurrency Patterns 2025](https://www.caplost.com/blog/advanced-go-concurrency-patterns-2025)
- [Event WiFi Infrastructure Failures](https://blog.gopassage.com/the-5-most-common-event-tech-issues-and-how-to-solve-them)
- [Event WiFi Optimization](https://www.ticketfairy.com/blog/event-wi-fi-networking-in-2026-building-a-reliable-infrastructure-for-seamless-connectivity)
- [Over-Engineering Anti-Pattern](https://yusufaytas.com/why-over-engineering-happens/)
- [Device-Based Authentication Guide](https://www.oloid.com/blog/device-based-authentication)

---
*Pitfalls research for: High-concurrency event management with QR-based access control (EventArc)*
*Researched: 2026-04-11*
