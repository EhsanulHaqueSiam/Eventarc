---
phase: 4
plan: "04-01"
title: "Scan Service Core — Redis Lua Atomicity, Handler, Guest Cache"
status: complete
started: "2026-04-12T05:28:00Z"
completed: "2026-04-12T05:31:00Z"
---

# Plan 04-01 Summary

## What Was Built

Entry scan processing service with atomic Redis Lua operations. The core scan hot-path that validates QR payloads (HMAC), checks guest existence in Redis, and atomically performs check-in using a single Lua script that combines SISMEMBER + SADD + HSET + HINCRBY — eliminating any TOCTOU race window.

## Key Files Created

- `backend/internal/scan/lua.go` — Redis Lua script for atomic check-in with duplicate detection + counter increment
- `backend/internal/scan/service.go` — ProcessEntryScan pipeline: HMAC verify, QR type validate, guest lookup, Lua check-in
- `backend/internal/scan/handler.go` — HTTP handler mapping errors to status codes (200/400/401/404/409/422/500)
- `backend/internal/scan/types.go` — ScanRequest, ScanResult, GuestInfo, ScanInfo, CheckInDetails types
- `backend/internal/scan/service_test.go` — 8 unit tests
- `backend/internal/scan/handler_test.go` — 8 handler tests

## Key Files Modified

- `backend/cmd/server/main.go` — Registered POST /api/v1/scan/entry route (unauthenticated)
- `backend/internal/config/config.go` — Added ScanTimeout field

## Test Results

16 tests passing:
- Service: valid scan, duplicate scan, invalid HMAC, guest not found, wrong QR type, unified QR, Lua atomicity, counter increment
- Handler: 200 valid, 409 duplicate, 400 empty payload, 400 missing fields, 401 invalid signature, 404 not found, 422 wrong type, 400 invalid body

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
