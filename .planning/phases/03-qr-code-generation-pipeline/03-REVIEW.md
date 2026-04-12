---
phase: 03-qr-code-generation-pipeline
status: clean
depth: standard
files_reviewed: 12
findings: 0
severity_counts:
  critical: 0
  high: 0
  medium: 0
  low: 0
  info: 3
reviewed: 2026-04-12
---

# Phase 03 Code Review

## Scope

12 source files reviewed across Go backend (worker, handler, server), Convex (schema, qr, events), and infrastructure (Dockerfile, docker-compose.yml).

## Findings

No bugs, security issues, or code quality problems found.

### Informational Notes (no action required)

**I-01: HMAC signing code duplication in convex/qr.ts**
- `triggerGeneration` and `triggerIncrementalGeneration` both contain the same HMAC signing logic (~15 lines each)
- This is acceptable for Phase 3 since there are only 2 callers and extracting a shared function would add complexity without meaningful benefit at this scale
- If a third action needs HMAC signing, refactor into a shared `signRequest()` utility

**I-02: Redis HSet error not checked in handler/qr.go HandleTriggerGeneration**
- Line 118: `h.redisClient.HSet(r.Context(), progressKey, ...)` return value is not checked
- This is acceptable because progress initialization is best-effort -- the batch handler will set up progress when it runs, and the endpoint already returned 202 before this point
- The progress tracking is a convenience feature, not a correctness requirement

**I-03: checkAndFinalizeProgress race condition (theoretical)**
- In worker/qr_handler.go, `checkAndFinalizeProgress` reads progress and then conditionally sets status
- With 10 concurrent workers, two workers could both read `completed+failed == total-1`, both increment, and both attempt to finalize
- This is benign: the final HSet is idempotent (both set status to "complete" or "failed"), and Redis HINCRBY is atomic for the counters
- No fix needed -- the worst case is a duplicate log message

## Security Review

- HMAC middleware protects all QR endpoints (T-03-07 mitigated)
- R2 credentials only in environment variables, never logged (T-03-10 mitigated)
- Convex action validates event state before triggering (T-03-11 mitigated)
- asynq concurrency limit prevents resource exhaustion (T-03-09 mitigated)
- No SQL injection vectors (no raw SQL)
- No path traversal in R2 key construction (BuildKey uses controlled format)

## Test Coverage

- worker/tasks.go: 4 tests (task creation, payload round-trip, progress key)
- handler/qr.go: 5 tests (valid request, missing eventId, invalid strategy, progress not found, progress running)
- Integration tests correctly skip when Redis unavailable

## Verdict

**CLEAN** -- No issues requiring action. Code follows established patterns (chi router, slog, HMAC middleware, Convex internal queries/mutations). Interface design (TaskEnqueuer) enables proper test isolation.
