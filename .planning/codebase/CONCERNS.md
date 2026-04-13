# Codebase Concerns

**Analysis Date:** 2026-04-12

## Tech Debt

**SSE Endpoint Missing Admin Auth (TODO in Code):**
- Issue: The live dashboard SSE endpoint (`GET /api/v1/events/{eventId}/live`) has no admin session validation middleware. There is an explicit TODO comment: `TODO(phase-10): Add admin session validation middleware (Better Auth cookie check)`.
- Files: `backend/cmd/server/main.go:134`
- Impact: Any unauthenticated user who knows an event ID can stream live scan metrics. This is a security and privacy gap -- attendance counts, food consumption, vendor activity, and alert data are exposed without authentication.
- Fix approach: Add Better Auth cookie validation middleware to the SSE route. The HMAC middleware pattern already exists at `backend/internal/middleware/hmac.go` -- create a similar `BetterAuthSession` middleware that verifies the admin cookie and injects user context.

**Duplicate `signPayload` Function (3 copies):**
- Issue: The HMAC signing function `signPayload` is copy-pasted identically in three Convex files.
- Files: `convex/adminGateway.ts:38`, `convex/sync.ts:188`, `convex/internalGateway.ts:16`
- Impact: Any change to the signing algorithm requires updating three files. Divergence creates subtle auth failures between admin gateway, sync, and internal gateway paths.
- Fix approach: Extract to a shared utility file `convex/lib/hmac.ts` and import from all three files.

**Duplicate Phone Validation Logic (2 copies):**
- Issue: Phone regex and normalization logic is duplicated between `convex/model/phone.ts` and `frontend/src/lib/phone.ts`. The frontend copy has a comment `MUST match convex/model/phone.ts exactly` acknowledging the fragility.
- Files: `convex/model/phone.ts`, `frontend/src/lib/phone.ts`
- Impact: If regex is updated in one place but not the other, client-side validation will diverge from server-side, causing confusing validation errors during import or guest creation.
- Fix approach: Accept this as necessary since Convex and frontend are separate runtimes. Add a shared test that validates both implementations agree on a comprehensive set of phone number inputs, or extract the regex constant to a shared types package.

**Inconsistent Go API URL Environment Variable Naming:**
- Issue: The frontend uses two different env var names inconsistently to locate the Go backend: `VITE_API_URL` and `VITE_GO_API_URL`. Different hooks check them in different orders with different fallback patterns.
- Files: `frontend/src/hooks/use-scanner.ts:171-173`, `frontend/src/hooks/use-device-session.ts:8-10`, `frontend/src/hooks/use-offline-sync.ts:35-37`, `frontend/src/hooks/use-network-status.ts:36-39`, `frontend/src/components/dashboard/live-dashboard.tsx:46`
- Impact: Configuration confusion. Some hooks check `VITE_API_URL` first, others check `VITE_GO_API_URL` first. The live dashboard component only checks `VITE_GO_API_URL`. Setting only one of them may cause some features to work and others to use `localhost:8080`.
- Fix approach: Standardize on one env var name (`VITE_GO_API_URL`). Create a shared `getApiBaseUrl()` utility function in `frontend/src/lib/api.ts` and use it everywhere. The function already exists in `use-device-session.ts` but is not shared.

**Session Creation Endpoint Has No Rate Limiting:**
- Issue: `POST /api/v1/session` is completely unauthenticated and has no rate limiting. Any client can create unlimited device sessions.
- Files: `backend/internal/handler/session.go:48`, `backend/cmd/server/main.go:74-78`
- Impact: A malicious actor could create millions of session tokens, filling Redis memory and degrading system performance. Each session is stored with no TTL (`redis.Set(... 0)`).
- Fix approach: Add IP-based rate limiting middleware (e.g., 10 sessions per IP per minute). Consider adding a TTL to session keys (e.g., 24 hours) so abandoned sessions are cleaned up automatically.

**No Session Expiry (Redis TTL = 0):**
- Issue: Device sessions in Redis are stored with zero TTL, meaning they persist indefinitely until manually revoked.
- Files: `backend/internal/handler/session.go:88` (comment: `sessions last until event ends`)
- Impact: Redis memory accumulates abandoned sessions from old events. After many events, session keys pile up. No automatic cleanup when events are completed or archived.
- Fix approach: Set a reasonable TTL (e.g., 48 hours). Add session cleanup logic when event status transitions to `completed` or `archived`. Alternatively, add a periodic cleanup job that removes sessions for non-live events.

**Event Deletion Cascade is Incomplete:**
- Issue: When an event is deleted (`events.remove`), the cascade deletes `guestCategories`, `stalls`, `vendorCategories`, and `vendorTypes`, but does NOT delete `guests`, `foodRules`, `foodScans`, `smsDeliveries`, `deviceSessions`, or `cardTemplates`.
- Files: `convex/events.ts:292-347`
- Impact: Orphaned records remain in the database after event deletion. While only draft events can be deleted (per validation at line 302), draft events can still have guests (imported), card templates, and device sessions. This wastes Convex storage and could cause confusing data in queries.
- Fix approach: Add cascade deletion for `guests`, `foodRules`, `foodScans`, `smsDeliveries`, `deviceSessions`, and `cardTemplates` in the `events.remove` mutation. Consider chunking the guest deletion since there could be up to 60K guests.

**No `vitest` Script in `package.json`:**
- Issue: The frontend `package.json` has no `test` or `test:unit` script for running vitest, despite having `vitest.config.ts` and 9 unit test files.
- Files: `frontend/package.json:6-14`
- Impact: Developers must know to run `npx vitest` manually. CI pipelines would need to be configured separately. No standard `pnpm test` command.
- Fix approach: Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `frontend/package.json`.

## Known Bugs

**`photoUrl` Field Referenced But Never Populated:**
- Symptoms: The guest sync pipeline (`convex/sync.ts:178`) maps `guest.photoUrl` to the Go backend, and the Go scan service reads `guestData["photoUrl"]` (`backend/internal/scan/service.go:106`). However, the `guests` table schema has no `photoUrl` field, and no code ever sets it.
- Files: `convex/sync.ts:98,178`, `convex/schema.ts:99-135` (no `photoUrl` field), `backend/internal/scan/service.go:106`
- Trigger: Every guest sync always sends an empty string for `photo_url`. The Go backend stores empty string in Redis and returns it in scan results.
- Workaround: Functionally harmless since the field defaults to empty string, but it's dead code that suggests an unfinished feature.

## Security Considerations

**HMAC Secret Defaults to Empty String:**
- Risk: If `HMAC_SECRET` env var is not set, the Go backend starts with an empty string HMAC secret. This means all HMAC-protected endpoints accept any request with an empty-key signature, and QR code HMAC verification is trivially bypassable.
- Files: `backend/internal/config/config.go:36` (`getEnv("HMAC_SECRET", "")`)
- Current mitigation: None -- the server starts silently with empty secret.
- Recommendations: Fail fast on startup if `HMAC_SECRET` is empty or too short. Add a minimum secret length check (e.g., 32 bytes). Log a clear fatal error message.

**Scan Endpoints Accept Unauthenticated Requests:**
- Risk: `POST /api/v1/scan/entry` and `POST /api/v1/scan/food` only validate via session token in header and QR payload HMAC. The session token is obtained from the unauthenticated `POST /api/v1/session` endpoint. The QR HMAC is the sole authentication mechanism (per design decision D-04).
- Files: `backend/cmd/server/main.go:104-107`, `backend/internal/scan/handler.go:28`
- Current mitigation: Session scope validation ensures the session's stall matches the request's stall ID. QR payload HMAC prevents forgery.
- Recommendations: This is by design per VSCN-01 ("no credentials required"). The risk is acceptable if HMAC secrets are properly managed. Add request rate limiting per session token to prevent scan-flooding attacks.

**CORS Wildcard in Development:**
- Risk: In non-production mode, CORS is set to `Access-Control-Allow-Origin: *`, allowing any website to make API requests to the backend.
- Files: `backend/internal/middleware/cors.go:32`
- Current mitigation: Only in development mode. Production checks `ALLOWED_ORIGINS` env var.
- Recommendations: Acceptable for development. Ensure `ALLOWED_ORIGINS` is always set in production deployment configs.

**HMAC Signature Comparison is Not Constant-Time in Convex:**
- Risk: In `convex/internalGateway.ts:99`, the HMAC signature comparison uses `!==` (string comparison) instead of a constant-time comparison. The Go backend correctly uses `hmac.Equal()`.
- Files: `convex/internalGateway.ts:99` (`expectedSignature !== signature.toLowerCase()`)
- Current mitigation: Convex runs server-side, reducing timing attack surface.
- Recommendations: While the risk is minimal in a server-side context, use `crypto.timingSafeEqual()` for defense in depth if the Convex runtime supports it.

## Performance Bottlenecks

**`listSmsRecipients` Collects All Guests for Event:**
- Problem: `guests.listSmsRecipients` calls `.collect()` on the entire guest list for an event (up to 60K records), then filters client-side for guests with card images.
- Files: `convex/guests.ts:414-417`
- Cause: No index on `cardImageUrl` existence. The `by_event` index returns all guests, and filtering is done in-memory after collection.
- Improvement path: Add a compound index `by_event_card` on `["eventId", "cardImageUrl"]` to the schema, or add a dedicated field `hasCard: boolean` with an index to avoid collecting all 60K guests. Alternatively, use pagination with a cursor-based approach.

**`smsDeliveries.countByStatus` Collects All Deliveries:**
- Problem: Counts SMS delivery statuses by collecting ALL deliveries for an event, then looping in-memory. For 60K guests, this reads all 60K records just to count 5 status buckets.
- Files: `convex/smsDeliveries.ts:52-75`
- Cause: No aggregation support in Convex; the code collects everything to count.
- Improvement path: Maintain a counter document per event that is atomically updated on each status transition. Alternatively, use multiple indexed queries (one per status) with `.count()` if Convex supports it.

**`smsDeliveries.listByEvent` N+1 Query Pattern:**
- Problem: For each delivery in the list, it runs a separate `ctx.db.get(delivery.guestId)` to resolve the guest name. With 60K deliveries, this is up to 60K additional database reads.
- Files: `convex/smsDeliveries.ts:33-39`
- Cause: Guest names are not denormalized into delivery records.
- Improvement path: Denormalize `guestName` into the `smsDeliveries` table at creation time. Or batch-fetch unique guest IDs before mapping.

**Event Sync Collects All Guests into Memory:**
- Problem: `sync.getEventSyncDataset` calls `.collect()` on the entire guest list (up to 60K guests) for an event, builds a large JSON payload, and sends it in a single HTTP request to the Go backend.
- Files: `convex/sync.ts:142-145`, `convex/sync.ts:267-304`
- Cause: Full event sync is designed as a single bulk operation.
- Improvement path: For events approaching 60K guests, this will hit Convex action memory limits and HTTP request size limits. Consider chunked sync (e.g., 5K guests per request) with an "event_sync_chunk" message type.

**Post-Filter Pagination Bug in `listByEvent`:**
- Problem: When filtering by both `status` and `categoryId`, the query paginates on the `by_event_status` index but then post-filters by `categoryId` in memory. This means a page of 50 items could return fewer (or zero) items after filtering, breaking pagination UX.
- Files: `convex/guests.ts:302-318`
- Cause: No compound index on `["eventId", "status", "categoryId"]`. The Convex search index only supports one equality filter field.
- Improvement path: Add a compound index `by_event_status_category` on `["eventId", "status", "categoryId"]`. Alternatively, accept the limitation and increase page size to compensate.

## Fragile Areas

**Offline Scan Queue Sync:**
- Files: `frontend/src/hooks/use-offline-sync.ts`, `frontend/src/lib/offline-queue.ts`, `frontend/src/hooks/use-network-status.ts`
- Why fragile: The sync process reads session tokens from `localStorage` by key name (`eventarc_scanner_session`), parses JSON with a try/catch fallback, and processes scans sequentially with abort signals. Network detection relies on `navigator.onLine` events (unreliable on mobile) plus a health check ping to `localhost:8080` (or env var). If the health endpoint changes or the session key format changes, sync silently fails.
- Safe modification: Always test the full offline -> online -> sync -> retroactive rejection flow end-to-end. The `use-offline-sync.test.ts` has good coverage (394 lines), but E2E offline testing requires manual device testing.
- Test coverage: Good unit test coverage. No automated E2E test for actual offline behavior.

**Convex-to-Go Data Sync Pipeline:**
- Files: `convex/sync.ts`, `convex/internalGateway.ts`, `backend/internal/scan/event_sync.go`
- Why fragile: The sync pipeline relies on matching data shapes between Convex TypeScript types and Go struct field tags. If a field is renamed in Convex (e.g., `foodQrMode`) but not in the Go `EventSyncPayload` struct, the scan engine silently receives empty config values. There is no contract validation or schema enforcement between the two systems.
- Safe modification: Any change to the sync payload shape must be made in BOTH `convex/sync.ts` AND `backend/internal/scan/event_sync.go` simultaneously. Add integration tests that validate the full sync roundtrip.
- Test coverage: Hardening tests (`backend/tests/hardening/config_matrix_test.go`) cover the Go side but mock the Convex payload. No test validates the actual Convex-to-Go contract.

**Redis Key Naming Convention:**
- Files: `backend/internal/scan/service.go`, `backend/internal/scan/food_service.go`, `backend/internal/scan/event_sync.go`
- Why fragile: Redis key patterns (`guest:{eventId}:{guestId}`, `checkedin:{eventId}`, `counters:{eventId}`, `food:{eventId}:{guestId}`, etc.) are constructed via `fmt.Sprintf` scattered across files. There is no central key registry. A typo in a key format creates silent data misses.
- Safe modification: Search for all `fmt.Sprintf` calls that construct Redis keys before modifying any key format. Consider creating a `keys.go` utility with typed key builders.
- Test coverage: Service-level tests validate key interactions through the Redis client mock, but they don't catch key format mismatches between production and sync code.

## Scaling Limits

**Convex `.collect()` on Large Tables:**
- Current capacity: Works for events with a few thousand guests.
- Limit: Convex has document-count limits on `.collect()`. For 60K guests, several queries will hit the default limit. The `sync.getEventSyncDataset` and `guests.listSmsRecipients` are the most at-risk.
- Scaling path: Replace `.collect()` with paginated iteration patterns. For the sync pipeline, break into chunks. For SMS recipients, add a dedicated index.

**Single Redis Instance:**
- Current capacity: A single Redis instance handles all scan processing, session storage, counter management, and pub/sub.
- Limit: At 10K concurrent scans, Redis is unlikely to be a bottleneck (single instance handles 100K+ ops/sec). But if Redis goes down, ALL scanning stops -- entry, food, sessions, and dashboard.
- Scaling path: Redis Sentinel or Redis Cluster for HA. The code already uses a single `redis.Client`, so switching to a Sentinel-aware client is straightforward.

## Dependencies at Risk

**`html5-qrcode` Package:**
- Risk: The `html5-qrcode` library (v2.3.8) has not been actively maintained. It is a critical dependency for the scanner interface.
- Impact: Camera-based QR scanning is a core feature. Browser API changes or new device compatibility issues would have no upstream fix.
- Migration plan: The code uses it via `frontend/src/components/scanner/camera-viewfinder.tsx`. Consider evaluating `@nicolo-ribaudo/qr-reader` or `jsQR` as alternatives if maintenance stalls further.

**`@convex-dev/better-auth` (v0.11.4):**
- Risk: Pre-1.0 Convex plugin for Better Auth integration. API may change between minor versions.
- Impact: Auth is foundational -- any breaking change blocks all authenticated operations.
- Migration plan: Pin exact version (currently `^0.11.4` allows minor updates). Monitor Convex changelog.

## Missing Critical Features

**No Admin Role Management UI:**
- Problem: The first user who signs up automatically becomes `admin`. There is no way to promote other users to admin or demote them. The `eventManager` role assignment happens implicitly.
- Files: `convex/auth.ts:76` (first user = admin), `convex/authz.ts:30-31` (no appUsers record = eventManager fallback)
- Blocks: Multi-admin workflows. If the original admin account is lost, there is no recovery path. The `appUsers.role` field exists but no mutation exposes role changes.

**No Email Verification:**
- Problem: `requireEmailVerification: false` in auth config. Any email address can be used to create an account.
- Files: `convex/auth.ts:25`
- Blocks: Email-based identity verification. Spam account creation possible.

## Test Coverage Gaps

**No Convex Backend Unit Tests:**
- What's not tested: All Convex mutations, queries, and model logic have zero automated tests. This includes critical business logic: event lifecycle transitions, guest import with deduplication, food rule validation, authorization checks, and the sync pipeline.
- Files: All files in `convex/` directory (19 source files, 0 test files)
- Risk: Regressions in authorization logic (`convex/authz.ts`), event state machine transitions (`convex/model/events.ts`), or guest import pipeline (`convex/guests.ts`) would go undetected.
- Priority: High -- the Convex layer handles all CRUD operations and authorization.

**No Frontend Component Tests (except scanner):**
- What's not tested: Admin pages (event detail, guest management, categories, vendors, food rules, card editor, SMS dashboard) have no tests. Only scanner-related hooks and components have unit tests.
- Files: `frontend/src/components/events/`, `frontend/src/components/guests/`, `frontend/src/components/cards/`, `frontend/src/components/dashboard/` -- all untested
- Risk: Regression in admin workflows (creating events, importing guests, configuring food rules) would require manual testing to detect.
- Priority: Medium -- admin pages are complex but change less frequently than scan hot path.

**E2E Tests are Scaffold-Level:**
- What's not tested: The E2E test files exist (`frontend/e2e/`) but cover only basic smoke scenarios (API health, auth login/logout, event creation). No E2E coverage for: guest import wizard, QR generation flow, card editor, SMS sending, or scanner scanning flow.
- Files: `frontend/e2e/auth.spec.ts`, `frontend/e2e/events.spec.ts`, `frontend/e2e/scanner.spec.ts`, `frontend/e2e/scanner.mobile.spec.ts`
- Risk: Full user workflows are only validated manually.
- Priority: Medium -- the unit test coverage on scanner hooks partially compensates.

**No Integration Test for Convex-to-Go Sync Contract:**
- What's not tested: The data shape contract between `convex/sync.ts` (TypeScript payload) and `backend/internal/scan/event_sync.go` (Go struct deserialization). The hardening tests mock this boundary.
- Files: `convex/sync.ts`, `backend/internal/scan/event_sync.go`
- Risk: Field renames or type changes in one system silently break the other. This is the most critical integration boundary in the entire system.
- Priority: High -- a contract mismatch means scan processing receives stale or empty event data.

## Additional Concerns

**Console Statements in Production Code:**
- Issue: 7 `console.error`/`console.warn` statements in frontend hooks and 6 `console.log`/`console.error` statements in Convex server code.
- Files (frontend): `frontend/src/hooks/use-sse.ts:86,93`, `frontend/src/hooks/use-scanner.ts:205,219`, `frontend/src/hooks/use-device-session.ts:156`, `frontend/src/hooks/use-offline-sync.ts:96,150`
- Files (convex): `convex/sync.ts:247,253,259,323,331`, `convex/events.ts:263,281,285`
- Impact: Console logs in Convex are appropriate for server-side debugging. Frontend console statements will appear in browser DevTools. The ones in error catch blocks (`console.error`) are acceptable for debugging but should use a proper logging abstraction for production.
- Fix approach: Replace frontend `console.error` calls with a structured logger that can be silenced in production. Keep Convex `console.log` for server-side observability.

**No Error Boundary in React App:**
- Issue: The React application has no `ErrorBoundary` component. An unhandled error in any component will crash the entire app with a white screen.
- Files: `frontend/src/main.tsx` (no ErrorBoundary wrapping), `frontend/src/routes/__root.tsx` (no errorElement)
- Impact: A runtime error in any component (e.g., null reference in guest table, malformed SSE data in dashboard) crashes the entire application. For the scanner interface, this means a vendor loses their scanning capability until page refresh.
- Fix approach: Add a global `ErrorBoundary` in `main.tsx` that catches errors and shows a recovery UI. Add route-level `errorElement` for critical routes (scanner, dashboard). TanStack Router supports `errorComponent` per route.

**`dist/` Directory in Git:**
- Issue: The `frontend/dist/` directory exists on disk (build artifacts from a previous `vite build`). While `dist/` is in `.gitignore`, the directory's presence suggests builds were done locally.
- Files: `frontend/dist/` (not tracked by git, confirmed via `git ls-files`)
- Impact: None for git -- files are properly ignored. Clean up locally.

---

*Concerns audit: 2026-04-12*
