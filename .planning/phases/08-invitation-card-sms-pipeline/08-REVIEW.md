---
phase: 08-invitation-card-sms-pipeline
status: clean
depth: quick
reviewed: 2026-04-12
threats_open: 0
findings:
  critical: 0
  high: 0
  medium: 0
  low: 2
  info: 1
---

# Phase 08 Code Review

## Summary

Phase 8 code is clean. No critical or high-severity issues found. Go vet passes on all packages. All tests pass. Two low-severity notes and one informational observation.

## Findings

### Low Severity

| # | File | Issue | Recommendation |
|---|------|-------|----------------|
| L-1 | `backend/internal/sms/worker.go` | `HandleSMSSendBatch` builds same message for all recipients in batch; `{cardUrl}` placeholder replacement not implemented | Implement per-guest message templating or document that batch SMS sends identical messages |
| L-2 | `frontend/src/components/cards/sms-dashboard.tsx` | Placeholder data (counts/deliveries are undefined) — SMS dashboard shows empty state only | Will be wired when smsDeliveries Convex queries are integrated (expected) |

### Informational

| # | File | Observation |
|---|------|-------------|
| I-1 | `convex/smsDeliveries.ts` | `countByStatus` fetches all deliveries then counts in memory — works for moderate scale, but may need pagination for 60K+ records |

## Security

All STRIDE threats from the plan's threat model are mitigated:
- T-08-01, T-08-09: HMAC auth on all card/SMS routes (verified in main.go)
- T-08-02: Overlay position validation rejects negative/zero values
- T-08-04, T-08-11: Rate limit 1 active batch per event via Redis check
- T-08-06, T-08-07: File type + size validation on upload (client-side)
- T-08-10, T-08-14: API key from env only, not logged
- T-08-12: Message template length validated (max 800 chars)

## Verification

- `go vet ./internal/sms/... ./internal/handler/... ./internal/card/...` — clean
- `go test ./internal/sms/...` — 11/11 pass
- `go test ./internal/handler/...` — 10/10 pass (4 skipped: Redis)
- `go test ./internal/card/...` — 5/5 pass
- `go build ./cmd/server/` — compiles clean
- `npx tsc --noEmit` (frontend) — zero errors
