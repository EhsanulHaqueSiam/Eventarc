# Phase 4: Scan Processing Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-11
**Phase:** 04-scan-processing-core
**Areas discussed:** Scan validation pipeline, Dual-write atomicity strategy, Scan response & feedback, Load testing & verification

---

## Scan Validation Pipeline

| Option | Description | Selected |
|--------|-------------|----------|
| Redis-only validation | All lookups from Redis, PG is write-only | |
| Redis primary, PG fallback | Redis normally, PG if Redis unreachable | |
| You decide | Claude picks based on architecture constraints | ✓ |

**User's choice:** You decide (Claude's discretion)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Reject with 'guest not found' | Strict: Redis miss = scan fail | |
| Check PG as fallback, then cache | Redis miss → PG lookup → cache and proceed | ✓ |
| You decide | Claude picks safest approach | |

**User's choice:** Check PG as fallback, then cache
**Notes:** Self-healing approach to prevent false negatives from incomplete syncs

---

| Option | Description | Selected |
|--------|-------------|----------|
| Redis + PG only, async bridge to Convex | Scan writes Redis+PG, separate async sync to Convex | |
| Redis + PG + Convex synchronously | All three in hot path | |
| You decide | Claude picks based on latency requirements | ✓ |

**User's choice:** You decide (Claude's discretion)

---

## Dual-Write Atomicity Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| PG first (source of truth), then Redis | PG INSERT first, then Redis update | |
| Redis first (fastest ack), then PG | Redis immediately, PG background | ✓ |
| You decide | Claude picks | |

**User's choice:** Redis first (fastest ack), then PG

---

| Option | Description | Selected |
|--------|-------------|----------|
| Retry via asynq background job | Queue PG write as asynq job with retries | ✓ |
| Rollback Redis on PG failure | Undo Redis on PG fail | |
| You decide | Claude picks | |

**User's choice:** Retry via asynq background job

---

## Scan Response & Feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Name + Category + Photo placeholder | Guest name, category, photo field for future | ✓ |
| Name + Category only | Minimal response | |
| You decide | Claude picks | |

**User's choice:** Name + Category + Photo placeholder

---

| Option | Description | Selected |
|--------|-------------|----------|
| Original check-in timestamp + gate info | When and where originally checked in | ✓ |
| Just 'already checked in' message | Simple rejection | |
| You decide | Claude picks | |

**User's choice:** Original check-in timestamp + gate info

---

## Load Testing & Verification

| Option | Description | Selected |
|--------|-------------|----------|
| Go benchmark tests with goroutines | Built-in Go test goroutines | |
| k6 or vegeta (external tool) | External HTTP load generation | ✓ |
| You decide | Claude picks | |

**User's choice:** k6 or vegeta (external tool)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Zero errors + p99 < 500ms | All succeed, p99 under 500ms | |
| Zero errors + p95 < 200ms | All succeed, p95 under 200ms | ✓ |
| You decide | Claude picks | |

**User's choice:** Zero errors + p95 < 200ms

---

## Claude's Discretion

- Redis validation strategy (Redis-only vs Redis-primary-with-PG-fallback)
- Convex sync-back mechanism (asynq job vs Redis pub/sub to Convex HTTP action)
- Redis data structures for guest cache and check-in tracking
- PG schema details for entry_scans table
- Redis counter key naming convention
- Idempotency key format
- Load test script details
- k6 vs vegeta choice

## Deferred Ideas

None — discussion stayed within phase scope
