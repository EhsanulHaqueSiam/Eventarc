---
phase: 10
plan: "10-02"
title: "Load Testing & Image Generation Stress Test — k6 Matrix, 60K Images, Staging Config"
status: complete
started: "2026-04-12T18:00:00Z"
completed: "2026-04-12T18:30:00Z"
---

## Summary

Created k6 load test matrix covering all 6 event configurations at 10K concurrent VUs, 60K image generation stress test with memory bounds and crash recovery, test data seeder for all configurations, orchestration script, and staging Docker Compose.

## Changes

### Task 1: k6 Configuration Matrix and Scenarios
- `backend/tests/load/config_matrix.js` — 6 configuration objects with payload keys, thresholds
- `backend/tests/load/scenarios/entry_scan.js` — Entry scan scenario with ramping to 10K VUs, custom metrics
- `backend/tests/load/scenarios/food_scan.js` — Food scan scenario with food stall rotation
- `backend/tests/load/scenarios/mixed_load.js` — 70% entry / 30% food split, 10K VUs sustained 30s
- `backend/tests/load/scenarios/dashboard_sse.js` — 50 SSE client connections for 60s
- All scripts use `SharedArray` for payload loading, `__ENV.CONFIG_NAME` for config selection

### Task 2: Test Data Seeder
- `backend/tests/load/seed_matrix.go` — Generates payloads + seeds Redis + PG for all 6 configs
  - Supports `-guests-per-config`, `-hmac-secret`, `-redis-url`, `-pg-url`, `-configs` flags
  - Seeds guest hashes, food rules, stall names, event config, counters
  - Outputs `payloads_{config_name}.json` for k6 consumption
  - Redis pipeline for bulk operations (1000 per batch)
  - `go build` and `go vet` clean

### Task 3: Load Test Orchestration Script
- `backend/tests/load/run_matrix.sh` — Automated test runner:
  - `--quick` flag: 1K VUs, 1K guests (for CI/dev)
  - `--config NAME`: single configuration run
  - `--skip-seed`, `--skip-sse` for partial runs
  - Per-config flow: seed -> mixed load test -> counter reconciliation
  - Summary with PASS/FAIL per config, exits non-zero on any failure

### Task 4: 60K Image Generation Stress Test
- `backend/tests/hardening/image_generation_test.go`:
  - `TestImageGeneration_60K_Throughput` — 60K PNGs, <60min, <1GB memory, spot-check validation
  - `TestImageGeneration_MemoryBounds` — 5K images, <512MB Alloc per batch, GC between batches
  - `TestImageGeneration_CrashRecovery` — crash at 500, resume from checkpoint, verify 1000 unique files
  - Helper functions: `createTestCardTemplate`, `createTestQROverlay`, `compositeImages`
  - Uses Go stdlib `image/draw` matching Phase 8 design decision D-04

### Task 5: Staging Docker Compose
- `docker-compose.staging.yml`:
  - PostgreSQL: shared_buffers=256MB, max_connections=200, tuned WAL settings
  - PgBouncer: pool_size=150, transaction mode, max_client_conn=10000
  - Redis: 256MB maxmemory, noeviction, no persistence
  - Worker: GOMEMLIMIT=450MiB, GOMAXPROCS=2, 512M memory limit
  - No production secrets (uses `${HMAC_SECRET:-staging_...}` pattern)
  - Validated: `docker compose -f docker-compose.yml -f docker-compose.staging.yml config` passes

## Verification

- `go vet -tags integration ./tests/hardening/...` — PASS
- `go vet ./tests/load/seed_matrix.go` — PASS
- `go build ./tests/load/seed_matrix.go` — PASS
- `docker compose -f docker-compose.yml -f docker-compose.staging.yml config` — PASS
- `run_matrix.sh` is executable and supports --quick flag
- All k6 scripts reference `__ENV.CONFIG_NAME`
- Mixed load targets 10K VUs with zero-error threshold

## Decisions

- k6 mixed_load.js uses 70/30 entry/food split reflecting realistic event traffic patterns
- Seed matrix generates 5K VIP / 8K General / 2K Staff per 15K guests (scalable)
- Staging config uses Docker Compose overrides (not a standalone file) for DRY configuration
- Image generation test uses `t.TempDir()` for automatic cleanup
