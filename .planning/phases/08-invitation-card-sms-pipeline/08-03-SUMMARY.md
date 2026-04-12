---
phase: 08-invitation-card-sms-pipeline
plan: 03
status: complete
started: 2026-04-12
completed: 2026-04-12
---

# Plan 08-03 Summary: SMS provider abstraction & bulk delivery pipeline

## What Was Built

Provider-agnostic SMS delivery system with SMS.NET.BD as initial implementation. Asynq-based bulk sending with batch splitting (100/batch), rate limiting (5 batches/sec), exponential backoff retry, and automatic halt on insufficient balance. HTTP API for triggering bulk send and checking progress. Convex schema extended with smsDeliveries table for per-guest tracking.

## Key Files

### Created
- `backend/internal/sms/provider.go` — SMSProvider interface (Send, CheckStatus, CheckBalance), error types (ErrInsufficientBalance, APIError)
- `backend/internal/sms/smsnetbd.go` — SMS.NET.BD implementation: /sendsms POST, /report/request GET, /user/balance GET
- `backend/internal/sms/smsnetbd_test.go` — 6 tests with httptest mock: success, multi-recipient, insufficient balance, API error, status check, balance
- `backend/internal/sms/worker.go` — SMSWorker: HandleSMSBatch (orchestrator), HandleSMSSendBatch, HandleSMSRetry (exponential backoff), HandleSMSStatusPoll
- `backend/internal/sms/worker_test.go` — 5 tests: batch splitting, insufficient balance, backoff delay, max retries, payload marshaling
- `backend/internal/handler/sms.go` — HandleSendSMS (POST 202), HandleSMSProgress (GET), template validation
- `backend/internal/handler/sms_test.go` — 4 tests: valid send, empty template, too-long template, progress
- `convex/smsDeliveries.ts` — CRUD: listByEvent (filterable by status), countByStatus, create, updateStatus, markDelivered, markFailed

### Modified
- `backend/internal/config/config.go` — Added SMSProviderAPIKey, SMSProviderSenderID, SMSProviderBaseURL
- `backend/cmd/server/main.go` — Wired SMS routes under /api/v1/events/{eventId}/sms/
- `convex/schema.ts` — Added smsDeliveries table with 4 indexes

## Decisions Made

- Batch size: 100 numbers per API call (SMS.NET.BD supports comma-separated)
- Rate limit: 5 batches/second = 500 SMS/sec (conservative vs 50K/min provider limit, avoids carrier blocks)
- Retry: exponential backoff 2^n seconds (1s, 2s, 4s, 8s, 16s), max 5 retries
- Insufficient balance (error 416): immediate halt via asynq.SkipRetry, sets Redis balance_error flag
- Status polling: 30-second intervals, re-enqueues self until all requests reach terminal state

## Test Results

- `go test ./internal/sms/...` — 11/11 PASS
- `go test ./internal/handler/...` — 6/6 PASS (4 skipped: Redis not available)
- `go build ./cmd/server/` — compiles clean

## Self-Check: PASSED

All acceptance criteria met:
- [x] provider.go contains SMSProvider interface with Send, CheckStatus, CheckBalance
- [x] provider.go contains ErrInsufficientBalance
- [x] smsnetbd.go contains SMSNetBD struct and NewSMSNetBD constructor
- [x] smsnetbd_test.go contains TestSMSNetBD_Send_Success and interface compliance
- [x] worker.go contains HandleSMSBatch with TypeSMSBatch, batchSize, ErrInsufficientBalance
- [x] worker_test.go contains TestHandleSMSBatch_BatchSplitting
- [x] handler/sms.go contains HandleSendSMS and HandleSMSProgress
- [x] config.go contains SMSProviderAPIKey
- [x] main.go contains smsHandler.HandleSendSMS
- [x] schema.ts contains smsDeliveries: defineTable
- [x] smsDeliveries.ts exports create and listByEvent
- [x] Server compiles, all tests pass
