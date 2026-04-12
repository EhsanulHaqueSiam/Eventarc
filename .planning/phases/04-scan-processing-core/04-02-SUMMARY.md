---
phase: 4
plan: "04-02"
title: "PG Durability Layer — Async Writes, Migrations, Counter Re-Seeding, Convex Sync"
status: complete
started: "2026-04-12T05:31:00Z"
completed: "2026-04-12T05:36:00Z"
---

# Plan 04-02 Summary

## What Was Built

PostgreSQL durability layer ensuring every Redis-committed scan is persisted via asynq background jobs. Counter re-seeding from PG on Redis restart using MULTI/EXEC atomic pipeline. Convex sync-back placeholder.

## Key Files Created

- `backend/migrations/000002_scan_processing.up.sql` — guest_category column, unique compound index, reconciliation indexes
- `backend/migrations/000002_scan_processing.down.sql` — Corresponding rollback
- `backend/internal/scan/pg.go` — PGStore with idempotent InsertEntryScan (key: entry:{eventId}:{guestId}), GetExistingCheckIn, CountByEvent, CountByCategory, GetCheckedInGuestIDs
- `backend/internal/scan/worker.go` — asynq tasks: scan:pg-write (MaxRetry 5, queue pg-writes), scan:convex-sync (placeholder)
- `backend/internal/scan/reseed.go` — ReseedEventCounters (MULTI/EXEC atomic), CheckAndReseed (auto-detect), ReseedCheckedInSet
- `backend/internal/scan/pg_test.go` — 5 integration tests (//go:build integration)
- `backend/internal/scan/reseed_test.go` — 5 integration tests (//go:build integration)
- `backend/internal/db/` — sqlc-generated Go code (4 files)

## Key Files Modified

- `backend/queries/scans.sql` — 6 named queries (InsertEntryScan with 8 params, GetEntryScanByGuest, CountEntryScansByEvent, CountEntryScansByCategory, UpsertEventCounter, GetCheckedInGuestIDs)
- `backend/internal/scan/service.go` — Added PGStore + asynq client fields, PG fallback on Redis miss, async task enqueueing
- `backend/cmd/worker/main.go` — Added PG pool, scan task handler registration, pg-writes/convex-sync queues
- `backend/cmd/server/main.go` — Wired asynq client to scan service

## Test Results

All 16 unit tests passing (integration tests excluded by build tag).
Server and worker binaries compile successfully.
sqlc generate produces valid Go code.

## Deviations from Plan

- [Rule 3 - Blocking] Resolved merge conflict in config.go from concurrent worktree branch (worktree-gsd-08-01-compositor). Combined both ScanTimeout and Convex config fields.
- Added GetCheckedInGuestIDs query (not in original plan) — needed by ReseedCheckedInSet to rebuild the checked-in set from PG.

## Self-Check: PASSED
