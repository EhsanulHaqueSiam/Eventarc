# Phase 1: Foundation & Domain Model - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Scaffold the hybrid Convex + Go + Redis infrastructure and implement event/vendor/category CRUD via Convex. This phase delivers the project skeleton, domain model, dual data layer, and development/deployment tooling — but no scan processing, no QR generation, no frontend UI beyond scaffolding.

Requirements: EVNT-01, EVNT-02, EVNT-03, EVNT-04, VNDR-01, VNDR-02, VNDR-03, INFR-01, INFR-02

</domain>

<decisions>
## Implementation Decisions

### Monorepo Structure
- **D-01:** Single monorepo with three top-level directories: `/frontend` (React + Vite + TailwindCSS), `/backend` (Go microservice), `/convex` (Convex functions + schema). Single Docker Compose, unified git history, shared root `.env`.
- **D-02:** Go backend uses standard project layout: `cmd/server/main.go` entrypoint, `internal/` for private packages (handler, service, repository, model, config), `migrations/` for SQL files, `queries/` for sqlc SQL files.

### Convex <-> Go Data Sync
- **D-03:** Redis cache with Convex source. When event goes "live", Convex pushes full event/guest/vendor dataset to Go endpoint, which populates Redis. Scan-time reads come from Redis only — zero Convex calls during scanning.
- **D-04:** Mid-event changes use push-on-change: every Convex mutation that modifies event/vendor/guest data triggers an HTTP action to push the change to Go, which updates Redis immediately (~100ms delay).
- **D-05:** Convex is the source of truth for all CRUD data (events, guests, vendors, categories, stalls). PostgreSQL stores scan records only (check-ins, food consumption). No replication of CRUD data to PG.
- **D-06:** **OPEN RESEARCH QUESTION** — Investigate whether PostgreSQL can be dropped entirely. If Redis handles atomic counters and fast reads, and Convex handles durable scan record storage (each scan is a unique row, no OCC contention), PG may not be needed. Researcher must investigate: Convex Pro mutation rate limits, OCC behavior with unique row writes at 10K/sec, durability guarantees for scan records.

### Event Lifecycle
- **D-07:** Event states: draft, active, live, completed, archived. Claude designs the valid state transition rules and constraints (user deferred this decision).
- **D-08:** Go-live trigger: automatic at event's scheduled date/time via Convex scheduled function. Additionally, admin has a manual "Go Live Early" button to start scanning ahead of schedule.
- **D-09:** Go-live transition triggers the full Redis data sync — pushes all event/guest/vendor data to Redis cache.

### Guest Category Model
- **D-10:** Fully custom categories per event. Admin creates arbitrary category names (e.g., "Family", "VIP", "Staff") with no fixed set. Food rules are attached per category in Phase 5.
- **D-11:** Default "General" category auto-created per event. Guests without explicit category assignment during import are placed here. Admin can rename it or change its food rules.

### Dev Environment
- **D-12:** Claude's discretion on dev environment setup. Guidance: Docker for infrastructure services (PostgreSQL, PgBouncer, Redis), with Go server, Convex dev, and Vite running natively for fastest iteration.

### Go API Conventions
- **D-13:** RESTful JSON API with `/api/v1/` prefix from day 1. Endpoints: POST /api/v1/scan/entry, POST /api/v1/scan/food, POST /api/v1/sync/event, GET /api/v1/health.
- **D-14:** Convex authenticates calls to Go via HMAC-signed requests. Convex signs request body with HMAC-SHA256 using a shared key; Go verifies the signature. Protects against replay attacks.
- **D-15:** API versioning from the start — all endpoints under /api/v1/.

### Infrastructure Sizing README
- **D-16:** Create an Infrastructure Sizing Guide document with 3 tiers: Small (1K concurrent, 8K guests), Medium (5K concurrent, 30K guests), Large (10K concurrent, 60K guests). Each tier specifies VPS specs, Convex plan, Redis sizing, PG config.
- **D-17:** Include estimated monthly costs per tier. Reference providers: Hetzner (primary recommendation), DigitalOcean (accessible alternative, debit card friendly), Vultr, AWS Lightsail. Explicitly exclude Hostinger (random suspensions without notice).
- **D-18:** Dev/staging uses VPS + Dokploy + Convex free tier. Production swaps Convex keys to Pro. Redis via Upstash or Docker on Dokploy.

### Convex Schema Design
- **D-19:** Claude's discretion on event configuration storage (nested object on event vs separate table) and vendor hierarchy modeling (flat tables vs nested). Claude decides based on Convex data modeling best practices.

### Admin Authentication
- **D-20:** Better Auth via Convex (Convex's current auth integration). Admin gets proper authentication (email/password or similar). Vendors use passwordless device-based sessions — no credentials, just open URL and select stall.

### Deployment
- **D-21:** Go backend deployed via multi-stage Dockerfile (build Go binary, copy to minimal Alpine image). Dokploy handles container builds and deployment.
- **D-22:** Dokploy auto-deploy from GitHub on push, with preview deployments for PRs. No separate CI/CD pipeline needed.

### Convex HTTP Actions
- **D-23:** Convex HTTP actions retry with exponential backoff (1s, 2s, 4s) on sync failures. After 3 retries, log to sync_failures table. Admin sees "sync pending" indicator. Manual or scheduled retry later.

### Go Error Handling
- **D-24:** Domain error types in Go service layer (ErrNotFound, ErrDuplicate, ErrAlreadyCheckedIn, ErrLimitReached). Handler maps domain errors to HTTP status codes. Consistent JSON error response: `{"error": {"code": "...", "message": "...", "details": {...}}}`.

### Logging & Observability
- **D-25:** slog with JSON output in production, text output in dev. Standard fields per request: request_id, method, path, duration_ms, status. No external monitoring services in Phase 1 — add with production traffic.

### Database Naming Conventions
- **D-26:** PostgreSQL: snake_case for tables and columns (entry_scans, guest_id, checked_in_at). Convex: camelCase (Convex convention, e.g., eventDate, qrStrategy, foodQrMode).

### Convex Project
- **D-27:** Convex project named "eventarc". Deployments: eventarc-dev, eventarc-prod.

### CORS & Device Compatibility
- **D-28:** Claude's discretion on CORS configuration. Constraint: full cross-device compatibility is non-negotiable — iPhone, iPad, Android phones and tablets must work properly for QR scanning, image downloading, vendor scanner UI, and admin dashboard.

### Convex Function Organization
- **D-29:** Claude's discretion on Convex function file organization.

### Redis Key Naming
- **D-30:** Claude's discretion on Redis key naming convention.

### PostgreSQL Scope
- **D-31:** Claude's discretion on how much PG schema to set up in Phase 1 vs defer to later phases. Note: if D-06 research concludes PG isn't needed, this becomes moot.

### Testing Scope
- **D-32:** Claude's discretion on testing infrastructure and coverage for Phase 1.

### Claude's Discretion
Claude has flexibility on: event lifecycle state transitions (D-07), dev environment layout (D-12), Convex schema modeling (D-19), CORS config (D-28), Convex function organization (D-29), Redis key naming (D-30), PG schema scope (D-31), testing scope (D-32).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Architecture
- `.planning/PROJECT.md` — Core value, constraints, key decisions (hybrid Convex + Go architecture)
- `.planning/REQUIREMENTS.md` — Full v1 requirements with traceability to phases
- `.planning/ROADMAP.md` — Phase details, success criteria, and dependency graph

### Technology Research
- `.planning/research/STACK.md` — Technology stack decisions and rationale
- `.planning/research/ARCHITECTURE.md` — Architecture patterns and design decisions
- `.planning/research/PITFALLS.md` — Known pitfalls and mitigation strategies
- `.planning/research/FEATURES.md` — Feature analysis and implementation notes
- `.planning/research/SUMMARY.md` — Research synthesis

### External Documentation (researcher should fetch latest)
- Convex Auth / Better Auth integration docs — verify current Convex auth approach
- Convex HTTP actions documentation — retry patterns, scheduled functions
- Convex Pro tier limits — mutation rate limits, concurrent connections, storage
- Dokploy GitHub integration docs — auto-deploy, preview deployments

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project with only CLAUDE.md present

### Established Patterns
- None — this phase establishes all initial patterns

### Integration Points
- Convex schema.ts defines the domain model that all Convex functions use
- Go cmd/server/main.go is the service entrypoint
- Docker Compose ties infrastructure services together
- Root .env provides configuration across all services

</code_context>

<specifics>
## Specific Ideas

- User strongly prefers Hetzner for VPS hosting (good experience, best price/performance). DigitalOcean as fallback (more payment options). Hostinger explicitly excluded.
- User wants the sizing guide to help with budgeting — include actual cost estimates per tier
- Convex should be investigated as potential replacement for PostgreSQL entirely (user preference for simpler architecture)
- Better Auth is the current Convex auth integration (not the older "Convex Auth")
- Everything must work on iPhone, iPad, and Android — cross-device compatibility is a hard requirement

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-domain-model*
*Context gathered: 2026-04-11*
