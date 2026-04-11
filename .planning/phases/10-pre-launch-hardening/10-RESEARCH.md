# Phase 10: Pre-Launch Hardening - Research

**Researched:** 2026-04-12
**Status:** Complete

## Research Questions

1. How should 10K concurrent load tests be structured to cover entry + food scans simultaneously across all 6 configuration combinations?
2. What integration testing approach validates every event configuration combination end-to-end?
3. How should QR security tests be structured to cover token modification, replay attacks, and HMAC forgery?
4. What is the best approach for SMS batch testing at 1,000+ scale with SMS.NET.BD?
5. How should the 60K image generation stress test validate memory bounds and crash recovery?

## Research Findings

### 1. Load Testing at 10K Concurrent (Extending Phase 4 k6 Infrastructure)

**k6 Capacity:** A single k6 instance handles 30K-40K simultaneous virtual users. 10K concurrent is well within single-machine capacity -- no distributed k6 setup needed.

**Phase 4 Foundation:** Phase 4 already defines `backend/tests/load/scan_load_test.js` with:
- Ramping VU pattern (0 -> 1K -> 5K -> 10K -> sustain 30s -> ramp down)
- Custom metrics (scan_success, scan_duplicate, scan_error)
- Thresholds: `http_req_failed: rate==0`, `http_req_duration: p(95)<200`
- Seed program (`backend/tests/load/seed.go`) generating payloads + Redis data

**Phase 10 Extension Strategy:**
- Add food scan scenarios alongside entry scans (dual-endpoint load)
- Test all 6 configuration combinations sequentially in a single test suite
- Add SSE connection load (dashboard clients receiving events during scan load)
- Add counter reconciliation verification after each configuration run

**Configuration Combinations to Test (6 total):**

| # | QR Strategy | Food Mode | Food Timing |
|---|-------------|-----------|-------------|
| 1 | unified | guest-linked | pre-sent |
| 2 | unified | anonymous | pre-sent |
| 3 | separate | guest-linked | pre-sent |
| 4 | separate | guest-linked | post-entry |
| 5 | separate | anonymous | pre-sent |
| 6 | separate | anonymous | post-entry |

Each combination requires different seed data (payload types, Redis cache structures, food rules) and different validation checks.

**k6 Script Architecture for Phase 10:**
```
tests/load/
  config_matrix.js       -- Exports 6 configuration objects
  scenarios/
    entry_scan.js        -- Entry scan scenario (reuse Phase 4 pattern)
    food_scan.js         -- Food scan scenario (new)
    mixed_load.js        -- Entry + food simultaneous
    dashboard_sse.js     -- SSE client simulation
  seed_matrix.go         -- Seeds all 6 configs with test data
  run_matrix.sh          -- Orchestrates sequential config runs
```

**Linux Kernel Tuning for 10K VUs:**
- `net.ipv4.ip_local_port_range = 1024 65535` (expand port range)
- `net.ipv4.tcp_tw_reuse = 1` (reuse TIME_WAIT connections)
- `ulimit -n 65536` (file descriptor limit)
- Keep k6 CPU usage under 80% (leave 20% headroom for accurate metrics)

**Passing Criteria:**
- Zero HTTP errors across all scenarios
- p95 latency < 200ms for entry scans
- p95 latency < 300ms for food scans (Lua script adds overhead)
- Zero race conditions (verified by Go race detector in separate test)
- Counter reconciliation: Redis counters == PG counts after each run

### 2. Integration Testing with Testcontainers (Configuration Matrix)

**Approach:** Use `testcontainers-go` to spin up real PostgreSQL + Redis containers for each test. This catches bugs that mocked tests miss -- real SQL execution, real Redis Lua scripts, real connection pooling.

**Test Architecture:**
```go
// TestConfigMatrix runs all 6 event configurations through the full
// entry -> food -> dashboard flow
func TestConfigMatrix(t *testing.T) {
    configs := []EventConfig{
        {QRStrategy: "unified", FoodMode: "guest-linked", FoodTiming: "pre-sent"},
        {QRStrategy: "unified", FoodMode: "anonymous", FoodTiming: "pre-sent"},
        {QRStrategy: "separate", FoodMode: "guest-linked", FoodTiming: "pre-sent"},
        {QRStrategy: "separate", FoodMode: "guest-linked", FoodTiming: "post-entry"},
        {QRStrategy: "separate", FoodMode: "anonymous", FoodTiming: "pre-sent"},
        {QRStrategy: "separate", FoodMode: "anonymous", FoodTiming: "post-entry"},
    }
    for _, cfg := range configs {
        t.Run(cfg.Name(), func(t *testing.T) {
            // 1. Seed event with this config
            // 2. Generate QR codes (entry + food based on strategy)
            // 3. Process entry scans
            // 4. Process food scans (check limits, cross-stall enforcement)
            // 5. Verify counter state matches expected
            // 6. Verify dashboard SSE would receive correct events
        })
    }
}
```

**Container Setup Pattern:**
```go
func setupTestInfra(t *testing.T) (*pgxpool.Pool, *redis.Client) {
    ctx := context.Background()
    
    pgContainer, _ := postgres.Run(ctx,
        "postgres:17-alpine",
        postgres.WithDatabase("eventarc_test"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        testcontainers.WithWaitStrategy(
            wait.ForLog("database system is ready to accept connections").
                WithOccurrence(2).WithStartupTimeout(30*time.Second),
        ),
    )
    
    redisContainer, _ := redis_tc.Run(ctx,
        "redis:8-alpine",
    )
    
    // Run migrations against PG
    // Return connected clients
}
```

**What Each Config Combination Tests:**

1. **Unified + Guest-linked + Pre-sent:** Single QR for entry + food. Entry scan checks in AND enables food. Food scan checks guest-linked limits. Dashboard shows both entry + food counters.

2. **Unified + Anonymous + Pre-sent:** Single QR for entry + food. Entry scan checks in. Food scan uses anonymous token tracking. Per-token limits enforced.

3. **Separate + Guest-linked + Pre-sent:** Two QRs. Entry QR for check-in. Food QR for food. Guest-linked food limits. Both QRs sent via SMS.

4. **Separate + Guest-linked + Post-entry:** Two QRs. Entry QR via SMS. Food QR distributed at gate after entry scan is validated. Food scan uses guest-linked limits.

5. **Separate + Anonymous + Pre-sent:** Two QRs. Entry QR + anonymous food QR. Per-token food limits.

6. **Separate + Anonymous + Post-entry:** Two QRs. Entry QR via SMS. Anonymous food QR at gate. Per-token food limits.

**Key Assertions Per Config:**
- Entry scan returns correct status and guest info
- Duplicate entry scan returns "already checked in" with original timestamp
- Food scan enforces correct limits (guest-linked: per-person; anonymous: per-token)
- Cross-stall food enforcement works (scan at stall-1, limit enforced at stall-2)
- Counter values match expected (attendance, per-category food consumption)
- Post-entry food QR generation triggers correctly after entry scan

### 3. QR Security Testing

**Attack Vectors to Test:**

| Attack | Test | Expected Result |
|--------|------|-----------------|
| Modified payload (1 byte changed) | Flip bit in guest ID | HMAC verification fails, scan rejected |
| Truncated payload | Remove last N bytes | Parse error, scan rejected |
| Wrong HMAC secret | Sign with different key | HMAC mismatch, scan rejected |
| Replay (same QR, second use) | Scan valid QR twice | First: valid. Second: "already checked in" |
| Expired event | Scan QR for completed event | Event not live, scan rejected |
| Wrong event | Scan QR from event A at event B | Event ID mismatch, scan rejected |
| Fabricated payload | Construct valid-looking bytes without HMAC | Invalid signature, rejected |
| Version byte manipulation | Change version prefix | Version unsupported or parse fails |
| Empty payload | Send empty string | Parse error, rejected |
| Oversized payload | Send 10KB payload | Size limit exceeded, rejected |

**Implementation:** Go unit tests in `backend/internal/scan/security_test.go`:
```go
func TestQRSecurity_ModifiedPayload(t *testing.T)
func TestQRSecurity_TruncatedPayload(t *testing.T)
func TestQRSecurity_WrongHMACSecret(t *testing.T)
func TestQRSecurity_ReplayEntry(t *testing.T)
func TestQRSecurity_ExpiredEvent(t *testing.T)
func TestQRSecurity_WrongEvent(t *testing.T)
func TestQRSecurity_FabricatedPayload(t *testing.T)
func TestQRSecurity_VersionManipulation(t *testing.T)
func TestQRSecurity_EmptyPayload(t *testing.T)
func TestQRSecurity_OversizedPayload(t *testing.T)
```

**HMAC Security Properties Verified:**
- Any single-byte modification invalidates the signature (crypto/hmac.Equal returns false)
- Timing-safe comparison prevents timing attacks (Go's hmac.Equal is constant-time)
- Replay protection via idempotent check-in (INSERT ON CONFLICT)
- No information leakage on failure (error messages don't reveal HMAC details)

### 4. SMS Batch Testing Strategy

**SMS.NET.BD Capabilities:**
- REST API (GET and POST methods, JSON format)
- Capacity: up to 50,000 SMS per minute
- Free tier: 10 credits for testing
- No documented sandbox environment -- uses real SMS delivery

**Testing Approach:**

1. **Mock Provider Test (automated, CI):** Test the SMS provider interface with a mock adapter. Verify:
   - 1,000+ messages queued and processed correctly
   - Throttling logic respects configured rate limits
   - Retry logic handles transient failures with exponential backoff
   - Per-guest status tracking updates (queued -> sent -> delivered/failed)
   - Batch chunking works (500-message batches per Phase 2 pattern)

2. **Real Provider Test (manual, pre-launch):** Send 1,000+ messages through SMS.NET.BD production API:
   - Use a dedicated test phone number list (team members + test numbers)
   - Verify delivery rate (target: >95% delivered within 5 minutes)
   - Monitor webhook callbacks for delivery status updates
   - Verify throttling doesn't trigger carrier spam detection
   - Track and report: total sent, delivered, failed, average delivery time

3. **Provider Abstraction Validation:** Test that swapping SMS provider adapter (SMS.NET.BD -> mock -> BulkSMS.net) works without code changes beyond the adapter.

**SMS Throttling Strategy:**
- SMS.NET.BD supports 50K/minute, but carrier-side throttling may differ
- Start at 100 SMS/second, monitor delivery rates
- If delivery rate drops, reduce to 50 SMS/second
- Exponential backoff on HTTP 429 (rate limited) responses

### 5. 60K Image Generation Stress Test

**Test Design:**

1. **Throughput Test:** Generate 60,000 composite images (invitation card + QR overlay):
   - Seed 60K guest records with QR images in R2 (or mock R2)
   - Upload a test card template image (standard 1080x1920 invitation card)
   - Trigger batch compositing via asynq job
   - Measure: total time, images/second throughput, peak memory usage
   - Target: Complete within acceptable time (benchmark baseline TBD -- likely 30-60 minutes)

2. **Memory Bounds Test:**
   - Set `GOMEMLIMIT` to a reasonable value (e.g., 512MB for worker)
   - Monitor RSS memory during 60K generation
   - Verify peak memory stays under limit (no OOM kills)
   - Test with concurrent QR generation + compositing workers

3. **Crash Recovery Test:**
   - Start 60K batch generation
   - Kill the worker process at ~30K images (50% progress)
   - Restart the worker
   - Verify: generation resumes from last checkpoint, not from zero
   - Verify: no duplicate images generated
   - Verify: final count == 60K unique images
   - asynq job state provides the checkpoint mechanism

**Implementation:**
```go
//go:build integration

func TestImageGeneration_60K_Throughput(t *testing.T)
func TestImageGeneration_MemoryBounds(t *testing.T)
func TestImageGeneration_CrashRecovery(t *testing.T)
```

**Memory Management:**
- Process images in batches (100-500 at a time)
- Explicitly release image buffers after each batch
- Use `runtime.GC()` hints between batches if memory pressure is high
- Monitor with `runtime.MemStats` during test
- Go's image/draw stdlib handles PNG decode + composite + encode per image
- Each image ~2-5MB in memory during processing, batch of 100 = ~200-500MB peak

### 6. Staging Environment Configuration

**Docker Compose for Staging:**
```yaml
# docker-compose.staging.yml
# Extends base docker-compose.yml with production-like settings
services:
  postgres:
    # Same as production: PG 17, tuned for load
    command: >
      -c shared_buffers=256MB
      -c work_mem=4MB
      -c max_connections=200
      -c effective_cache_size=512MB
  pgbouncer:
    # Transaction pooling, pool_size=150
    environment:
      POOL_SIZE: 150
      POOL_MODE: transaction
  redis:
    # Redis 8 with maxmemory
    command: redis-server --maxmemory 256mb --maxmemory-policy noeviction
  server:
    # Go server with production-like config
    environment:
      GOMAXPROCS: 4
  worker:
    # asynq worker for background jobs
    deploy:
      resources:
        limits:
          memory: 512M
```

**Test Data Generation:**
- 60K guest records across 3 categories (VIP: 5K, General: 50K, Staff: 5K)
- 6 food categories with varying limits
- Vendor hierarchy: 3 vendor types, 5 categories, 15 stalls
- QR codes pre-generated for all 60K guests
- Food rules matrix fully populated

### 7. Test Execution Strategy

**Plan Split Recommendation:**

**Plan 10-01 (Wave 1): Integration Tests & Security Validation**
- Configuration matrix integration tests (testcontainers)
- QR security test suite
- SMS batch test (mock provider)
- Test data seeder for all 6 config combinations

**Plan 10-02 (Wave 2): Load Testing & Image Generation Stress Test**
- Extended k6 load test suite (entry + food + SSE, all configs)
- 60K image generation stress test with crash recovery
- Staging Docker Compose configuration
- Full system load test runner script
- Counter reconciliation after load

Wave ordering: Wave 1 first because integration tests validate correctness (the system works). Wave 2 second because load tests validate performance (the system works fast enough). Correctness must be proven before measuring performance.

## Validation Architecture

### Correctness Validation
- **Config matrix tests**: All 6 combinations produce correct scan results, counter values, and status responses
- **QR security tests**: 10 attack vectors all rejected with appropriate error codes
- **SMS mock test**: 1,000+ messages processed with correct status tracking
- **Cross-stall enforcement**: Food limits enforced regardless of stall

### Performance Validation
- **k6 10K concurrent**: Zero errors, p95 < 200ms entry, p95 < 300ms food
- **Counter reconciliation**: Redis == PG after every load run
- **60K images**: Completes within time budget, stays within memory bounds
- **Crash recovery**: Resumes from checkpoint, no duplicates

### Security Validation
- **HMAC forgery**: Modified payloads rejected
- **Replay attacks**: Duplicate scans return correct duplicate status
- **Timing safety**: hmac.Equal constant-time comparison used
- **Error opacity**: Failure messages don't leak HMAC details

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| k6 cannot generate 10K VUs on CI machine | MEDIUM | Document hardware requirements, provide docker-compose with resource limits |
| testcontainers Docker socket unavailable in CI | MEDIUM | Tag integration tests, separate CI step with Docker access |
| SMS.NET.BD has no sandbox; real SMS costs money | LOW | Mock provider for automated tests, manual real-provider test pre-launch |
| 60K image test requires significant disk/memory | MEDIUM | Use tmp directory, cleanup after test, set GOMEMLIMIT |
| Phase 4 k6 scripts may have changed during execution | LOW | Research references Phase 4 plan, not implementation; planner reads actual files |

## RESEARCH COMPLETE
