---
phase: 10
plan: "10-01"
title: "Integration Tests & Security Validation — Config Matrix, QR Security, SMS Batch"
status: complete
started: "2026-04-12T17:30:00Z"
completed: "2026-04-12T18:00:00Z"
---

## Summary

Created comprehensive test infrastructure for pre-launch hardening: integration tests using testcontainers-go (PostgreSQL 17 + Redis 8), QR security test suite (12 attack vectors), and SMS batch tests with mock provider.

## Changes

### Task 1: Hardening Test Infrastructure
- `backend/tests/hardening/doc.go` — Package doc with `//go:build integration` tag
- `backend/tests/hardening/helpers_test.go` — Shared test infrastructure:
  - `AllConfigs()` returns all 6 valid event configuration combinations
  - `TestInfra` manages testcontainers lifecycle (postgres:17-alpine + redis:8-alpine)
  - `SetupTestInfra()` starts containers, runs all migrations (000001-000003)
  - `SeedEvent()`, `SeedGuests()`, `SeedFoodRules()`, `SeedVendorHierarchy()` helpers
  - Food rules: fuchka (VIP=3, General=1, Staff=2), coke (VIP=unlimited, General=2, Staff=2), biryani (VIP=2, General=1, Staff=1)
- Added testcontainers-go dependencies to go.mod

### Task 2: Configuration Matrix Integration Tests
- `backend/tests/hardening/config_matrix_test.go` — 6 test functions:
  - `TestConfigMatrix_EntryScans` — 50 guests per config, exact counter assertions
  - `TestConfigMatrix_DuplicateEntryScans` — duplicate rejection, counter stability
  - `TestConfigMatrix_FoodScans` — food limit enforcement (VIP/General/Staff)
  - `TestConfigMatrix_CrossStallEnforcement` — cross-stall limit enforcement
  - `TestConfigMatrix_PostEntryFoodTiming` — post-entry QR generation flow
  - `TestConfigMatrix_CounterReconciliation` — Redis flush + PG re-seed + duplicate detection

### Task 3: QR Security Test Suite
- `backend/internal/scan/security_test.go` — 12 test functions covering:
  - Modified payload (bit flips at 3 positions)
  - Truncated payload (HMAC removed, last byte, first byte)
  - Wrong HMAC secret
  - Replay entry (3 scans, counter stays at 1)
  - Expired/non-existent event
  - Wrong event ID (cross-event attack)
  - Fabricated payload (random HMAC + mismatched HMAC)
  - Version manipulation (0x00, 0xFF, 0x02)
  - Empty/single-byte/invalid-base64 payloads
  - Oversized payload (10KB)
  - Timing safety (constant-time HMAC comparison)
  - Food QR at entry gate
- All 12 tests pass: `go test ./internal/scan/ -run TestQRSecurity -v` = PASS

### Task 4: SMS Batch Tests
- `backend/tests/hardening/sms_batch_test.go` — MockSMSProvider + 6 test functions:
  - `TestSMSBatch_1000Messages` — 1000 messages, 2% fail rate, duplicate detection
  - `TestSMSBatch_Throttling` — rate limit enforcement
  - `TestSMSBatch_RetryOnFailure` — exponential backoff (2^n seconds)
  - `TestSMSBatch_StatusTracking` — Redis counter initialization
  - `TestSMSBatch_ProviderSwap` — provider A vs provider B isolation
  - `TestSMSBatch_BatchChunking` — 2500 messages in 25 batches of 100

## Verification

- `go vet -tags integration ./tests/hardening/...` — PASS
- `go vet ./internal/scan/...` — PASS
- `go test ./internal/scan/ -run TestQRSecurity -v` — 12/12 PASS
- No production secrets in test code
- All integration tests tagged with `//go:build integration`

## Decisions

- Used testcontainers-go v0.42.0 for real PG+Redis containers (no mocks for integration tests)
- QR security tests run without containers (use miniredis or pure payload verification)
- SMS mock provider implements full sms.SMSProvider interface with configurable fail rate
- Food rules test matrix: 3 food categories x 3 guest categories = 9 rules per event
