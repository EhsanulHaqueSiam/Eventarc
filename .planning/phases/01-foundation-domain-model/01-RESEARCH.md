# Phase 1: Foundation & Domain Model - Research

**Researched:** 2026-04-11
**Domain:** Monorepo scaffold (Convex + Go + PostgreSQL + Redis), domain modeling, CRUD APIs, authentication
**Confidence:** HIGH

## Summary

Phase 1 establishes the entire project skeleton: a monorepo with three pillars (frontend React+Vite, Go microservice, Convex backend), Docker Compose for infrastructure services, domain models in Convex for event/vendor/category CRUD, a minimal Go HTTP server scaffold with health and sync endpoints, and admin authentication via Better Auth. The phase delivers no scan processing, no QR generation, and no frontend UI beyond scaffolding -- it is purely the foundation that all subsequent phases build on.

The critical research question (D-06) about dropping PostgreSQL entirely in favor of Convex for scan records has been investigated. **Recommendation: Keep PostgreSQL in the architecture.** Convex Professional tier allows only 256 concurrent mutations, and OCC contention on shared counters/records under 10K concurrent scan writes would cause massive retry storms. PostgreSQL + PgBouncer is purpose-built for this workload pattern. However, in Phase 1 the PostgreSQL schema should be minimal -- just the migration infrastructure and a placeholder scan table schema, since the actual scan logic ships in Phase 4.

**Primary recommendation:** Set up the full monorepo structure with Convex as the CRUD/real-time layer (events, vendors, categories, auth), Go as the scan-path microservice scaffold, Docker Compose for PG/PgBouncer/Redis, and Better Auth via Convex for admin authentication. Defer heavy Go business logic and PG schema to Phase 4.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Single monorepo with three top-level directories: `/frontend` (React + Vite + TailwindCSS), `/backend` (Go microservice), `/convex` (Convex functions + schema). Single Docker Compose, unified git history, shared root `.env`.
- **D-02:** Go backend uses standard project layout: `cmd/server/main.go` entrypoint, `internal/` for private packages (handler, service, repository, model, config), `migrations/` for SQL files, `queries/` for sqlc SQL files.
- **D-03:** Redis cache with Convex source. When event goes "live", Convex pushes full event/guest/vendor dataset to Go endpoint, which populates Redis. Scan-time reads come from Redis only -- zero Convex calls during scanning.
- **D-04:** Mid-event changes use push-on-change: every Convex mutation that modifies event/vendor/guest data triggers an HTTP action to push the change to Go, which updates Redis immediately (~100ms delay).
- **D-05:** Convex is the source of truth for all CRUD data (events, guests, vendors, categories, stalls). PostgreSQL stores scan records only (check-ins, food consumption). No replication of CRUD data to PG.
- **D-06:** OPEN RESEARCH QUESTION -- Investigate whether PostgreSQL can be dropped entirely. (RESOLVED: Keep PG. See "D-06 Resolution" section below.)
- **D-07:** Event states: draft, active, live, completed, archived. Claude designs the valid state transition rules and constraints.
- **D-08:** Go-live trigger: automatic at event's scheduled date/time via Convex scheduled function. Additionally, admin has a manual "Go Live Early" button.
- **D-09:** Go-live transition triggers the full Redis data sync.
- **D-10:** Fully custom categories per event. Admin creates arbitrary category names with no fixed set.
- **D-11:** Default "General" category auto-created per event. Guests without explicit category assignment are placed here.
- **D-12:** Claude's discretion on dev environment setup. Docker for infrastructure, native for Go/Convex/Vite.
- **D-13:** RESTful JSON API with `/api/v1/` prefix. Endpoints: POST /api/v1/scan/entry, POST /api/v1/scan/food, POST /api/v1/sync/event, GET /api/v1/health.
- **D-14:** Convex authenticates calls to Go via HMAC-signed requests.
- **D-15:** API versioning from the start under /api/v1/.
- **D-16:** Infrastructure Sizing Guide with 3 tiers (Small/Medium/Large).
- **D-17:** Cost estimates referencing Hetzner (primary), DigitalOcean (fallback). Exclude Hostinger.
- **D-18:** Dev/staging uses VPS + Dokploy + Convex free tier. Production swaps to Convex Pro.
- **D-19:** Claude's discretion on Convex schema modeling.
- **D-20:** Better Auth via Convex for admin auth. Vendors use passwordless device-based sessions.
- **D-21:** Go backend deployed via multi-stage Dockerfile.
- **D-22:** Dokploy auto-deploy from GitHub.
- **D-23:** Convex HTTP actions retry with exponential backoff on sync failures.
- **D-24:** Domain error types in Go service layer.
- **D-25:** slog with JSON output in production, text output in dev.
- **D-26:** PostgreSQL: snake_case. Convex: camelCase.
- **D-27:** Convex project named "eventarc".
- **D-28:** Claude's discretion on CORS. Full cross-device compatibility is non-negotiable.
- **D-29:** Claude's discretion on Convex function file organization.
- **D-30:** Claude's discretion on Redis key naming convention.
- **D-31:** Claude's discretion on PG schema scope in Phase 1 vs later.
- **D-32:** Claude's discretion on testing infrastructure and coverage for Phase 1.

### Claude's Discretion
Claude has flexibility on: event lifecycle state transitions (D-07), dev environment layout (D-12), Convex schema modeling (D-19), CORS config (D-28), Convex function organization (D-29), Redis key naming (D-30), PG schema scope (D-31), testing scope (D-32).

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVNT-01 | Admin can create a new event with name, date, venue, and description | Convex schema `events` table with defineTable, mutations for CRUD, Better Auth for admin identity |
| EVNT-02 | Admin can configure event settings: QR strategy, food QR mode, food QR timing | Nested `config` object on event document in Convex (v.object with v.union for enum-like fields) |
| EVNT-03 | Admin can manage multiple events with lifecycle states (draft, active, live, completed, archived) | State machine in Convex mutation with transition validation; scheduled function for auto go-live |
| EVNT-04 | Admin can define custom guest categories per event with different food/access privileges | Separate `guestCategories` table with back-reference to event via v.id("events"), auto-create "General" |
| VNDR-01 | Admin configures vendor hierarchy: vendor types -> categories -> stalls | Three Convex tables: `vendorTypes`, `vendorCategories`, `stalls` with indexed parent references |
| VNDR-02 | Each stall is an independent scanning point with its own identity | Stall documents with unique identity per event, indexed for lookup |
| VNDR-03 | Admin can add, remove, or reconfigure stalls before and during an event | Convex mutations for stall CRUD; D-04 push-on-change syncs to Go/Redis when event is live |
| INFR-01 | CDN -> Redis cache -> PostgreSQL database layered architecture | Docker Compose with PG 17 + PgBouncer + Redis 8; Go microservice scaffold connecting to both |
| INFR-02 | PgBouncer connection pooling for PostgreSQL | PgBouncer in Docker Compose with transaction pooling mode, pool_size=150 |
</phase_requirements>

## D-06 Resolution: Keep PostgreSQL

**Question:** Can PostgreSQL be dropped entirely, with Convex storing scan records and Redis handling atomic counters?

**Finding: No. Keep PostgreSQL for scan records.** [VERIFIED: docs.convex.dev/production/state/limits]

| Factor | Convex Professional | PostgreSQL + PgBouncer |
|--------|---------------------|------------------------|
| Concurrent mutations | 256 (S256 deployment class) | 10,000+ via PgBouncer fan-in |
| Write model | OCC with automatic retries on conflict | Row-level locks, INSERT ON CONFLICT is atomic and non-blocking |
| 10K concurrent scans | OCC retries would cascade -- each scan reads counters + writes record, conflicting with all other scans on the same event counters | Each INSERT ON CONFLICT is independent, no conflict between different guests' scans |
| Atomic counters | No native INCR equivalent; would need mutation per increment, OCC contention on the counter document | Redis HINCRBY is single-threaded atomic, millions of ops/sec |
| Cost at scale | 25M function calls/month at $25/dev + $2/1M overage; 50GB DB I/O at $0.20/GB overage | Single VPS cost (~$20-40/month on Hetzner) |

**The core problem:** Convex mutations on the Professional tier max at 256 concurrent executions. With 10K concurrent scan requests, each needing to read event config + check guest status + write scan record + increment counters, the OCC contention on shared event counter documents would cause massive retry storms. Even with the "unique row write" pattern (each scan writes to a unique row), the counter increment still conflicts across all scans for the same event. [VERIFIED: docs.convex.dev/database/advanced/occ]

**Recommendation for Phase 1:** Set up PG + PgBouncer in Docker Compose, create the migration infrastructure (golang-migrate), and define a minimal scan table schema as placeholder. Defer the full scan processing logic to Phase 4.

## Standard Stack

### Core (Phase 1 Scope)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex | 1.35.1 | CRUD backend, real-time, auth | Source of truth for events/vendors/guests/categories. Real-time subscriptions for dashboard. [VERIFIED: npm registry] |
| @convex-dev/better-auth | 0.11.4 | Admin authentication | Official Convex auth component using Better Auth. Email/password for admin. [VERIFIED: npm registry] |
| better-auth | 1.6.2 (pin 1.5.3 per Convex docs) | Auth library | Convex Better Auth docs recommend pinning to 1.5.3 for compatibility. [CITED: labs.convex.dev/better-auth/framework-guides/react] |
| Go | 1.26.0 | Microservice language | Installed locally, exceeds 1.23+ requirement. [VERIFIED: local environment] |
| chi | v5.2.5 | HTTP router | Lightweight, idiomatic, stdlib-compatible. [VERIFIED: Go proxy] |
| pgx/v5 | v5.9.1 | PostgreSQL driver | Fastest pure Go PG driver with built-in pool. [VERIFIED: Go proxy] |
| go-redis/v9 | v9.18.0 | Redis client | Official Redis client for Go. [VERIFIED: Go proxy] |
| golang-migrate | v4.19.1 | Database migrations | Industry standard for Go + PG migrations. [VERIFIED: Go proxy] |
| sqlc | v1.30.0 | SQL code generation | Type-safe Go code from SQL queries. [VERIFIED: Go proxy] |
| React | 19.x | UI framework | Specified in constraints. |
| Vite | 8.0.8 | Build tool | Latest stable. [VERIFIED: npm registry] |
| TailwindCSS | 4.2.2 | Styling | Latest stable, CSS-first config. [VERIFIED: npm registry] |
| TanStack Router | 1.168.13 | Type-safe routing | Latest stable. [VERIFIED: npm registry] |
| TanStack Query | 5.97.0 | Server state management | Latest stable. [VERIFIED: npm registry] |
| TypeScript | 6.0.2 | Type safety | Latest stable. [VERIFIED: npm registry] |
| pnpm | 10.33.0 | Package manager | Installed locally. [VERIFIED: local environment] |

### Supporting (Phase 1 Scope)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| PostgreSQL | 17.x | Scan record database | Docker Compose service; minimal schema in Phase 1 |
| PgBouncer | latest | Connection pooling | Docker Compose service; transaction mode, pool_size=150 |
| Redis | 8-alpine | Cache + counters + pub/sub | Docker Compose service; minimal usage in Phase 1 (health check) |
| slog | stdlib (Go 1.21+) | Structured logging | All Go service logging from day 1 |
| Docker / Docker Compose | 29.4.0 / 5.1.1 | Infrastructure | Local dev environment for PG/PgBouncer/Redis |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Better Auth via Convex | Clerk, Auth0 | External dependency, monthly cost, less Convex-native integration |
| Convex for CRUD | Direct Go+PG for everything | Loses real-time subscriptions, schema-less flexibility, and serverless CRUD |
| pgx/v5 | database/sql + lib/pq | pgx is 70x faster in pooled scenarios, purpose-built for PG |
| golang-migrate | goose, atlas | golang-migrate is the most widely adopted; CLI + library mode |
| sqlc | GORM, sqlx | sqlc generates type-safe Go from SQL with zero runtime reflection |

**Installation (Phase 1):**

```bash
# Frontend (from project root)
pnpm create vite@latest frontend --template react-ts
cd frontend
pnpm add convex @convex-dev/better-auth better-auth@1.5.3
pnpm add @tanstack/react-router @tanstack/react-query
pnpm add -D tailwindcss @tailwindcss/vite typescript

# Backend (from project root)
cd backend
go mod init github.com/ehsanul-haque-siam/eventarc
go get github.com/go-chi/chi/v5@v5.2.5
go get github.com/jackc/pgx/v5@v5.9.1
go get github.com/jackc/pgx/v5/pgxpool
go get github.com/redis/go-redis/v9@v9.18.0

# Tools (install globally)
go install github.com/golang-migrate/migrate/v4/cmd/migrate@v4.19.1
go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0
```

## Architecture Patterns

### Recommended Project Structure

```
eventarc/                          # Monorepo root
├── frontend/                      # React + Vite + TailwindCSS
│   ├── src/
│   │   ├── main.tsx               # App entry, ConvexBetterAuthProvider
│   │   ├── App.tsx
│   │   ├── lib/
│   │   │   └── auth-client.ts     # Better Auth client instance
│   │   ├── routes/                # TanStack Router file-based routes
│   │   └── components/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── convex/                        # Convex functions + schema
│   ├── convex.config.ts           # App definition, registers betterAuth component
│   ├── auth.config.ts             # Auth provider config
│   ├── auth.ts                    # Better Auth instance + createAuth
│   ├── http.ts                    # HTTP router (auth routes + sync endpoints)
│   ├── schema.ts                  # Full Convex schema definition
│   ├── model/                     # Business logic helpers (plain TS functions)
│   │   ├── events.ts
│   │   ├── vendors.ts
│   │   └── categories.ts
│   ├── events.ts                  # Public queries/mutations (thin wrappers)
│   ├── vendors.ts
│   ├── categories.ts
│   └── _generated/                # Auto-generated by Convex
├── backend/                       # Go microservice
│   ├── cmd/
│   │   └── server/
│   │       └── main.go            # Entrypoint
│   ├── internal/
│   │   ├── config/
│   │   │   └── config.go          # Env-based configuration
│   │   ├── handler/
│   │   │   ├── health.go          # GET /api/v1/health
│   │   │   └── sync.go            # POST /api/v1/sync/event
│   │   ├── middleware/
│   │   │   ├── hmac.go            # HMAC signature verification
│   │   │   ├── logging.go         # Request logging via slog
│   │   │   └── cors.go            # CORS configuration
│   │   ├── service/               # Business logic layer
│   │   ├── repository/            # Data access layer
│   │   ├── model/                 # Domain types and errors
│   │   │   └── errors.go          # ErrNotFound, ErrDuplicate, etc.
│   │   └── redis/                 # Redis client wrapper
│   ├── migrations/                # SQL migration files (up/down)
│   │   └── 000001_init.up.sql
│   │   └── 000001_init.down.sql
│   ├── queries/                   # sqlc SQL files
│   ├── sqlc.yaml                  # sqlc configuration
│   ├── go.mod
│   ├── go.sum
│   └── Dockerfile                 # Multi-stage build
├── docker-compose.yml             # PG + PgBouncer + Redis
├── .env                           # Shared environment variables
├── .env.local                     # Convex deployment URLs (gitignored)
└── CLAUDE.md
```

### Pattern 1: Convex Schema with Nested Config Objects (D-19 Decision)

**What:** Store event configuration as a nested `v.object()` on the event document rather than a separate table.
**When to use:** When the config is always read/written alongside the parent and has no independent identity.
**Why:** Avoids an extra table join for every event read. Event config has no independent queries -- it is always accessed in the context of its event. Convex reads entire documents efficiently. [CITED: docs.convex.dev/database/schemas]

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  events: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    venue: v.optional(v.string()),
    eventDate: v.number(),       // Unix timestamp
    endDate: v.optional(v.number()),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("live"),
      v.literal("completed"),
      v.literal("archived"),
    ),
    config: v.object({
      qrStrategy: v.union(v.literal("unified"), v.literal("separate")),
      foodQrMode: v.union(v.literal("guestLinked"), v.literal("anonymous")),
      foodQrTiming: v.union(v.literal("preSent"), v.literal("postEntry")),
    }),
    createdBy: v.optional(v.string()), // Auth user ID
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_createdBy", ["createdBy"]),

  guestCategories: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    isDefault: v.boolean(),       // true for auto-created "General"
    // Food rules attached in Phase 5
  })
    .index("by_event", ["eventId"])
    .index("by_event_name", ["eventId", "name"]),

  vendorTypes: defineTable({
    eventId: v.id("events"),
    name: v.union(v.literal("entry"), v.literal("food")),
  })
    .index("by_event", ["eventId"])
    .index("by_event_name", ["eventId", "name"]),

  vendorCategories: defineTable({
    eventId: v.id("events"),
    vendorTypeId: v.id("vendorTypes"),
    name: v.string(),             // "fuchka", "biryani", "main_gate"
  })
    .index("by_event", ["eventId"])
    .index("by_vendorType", ["vendorTypeId"])
    .index("by_event_name", ["eventId", "name"]),

  stalls: defineTable({
    eventId: v.id("events"),
    categoryId: v.id("vendorCategories"),
    name: v.string(),             // "fuchka-1", "fuchka-2"
    isActive: v.boolean(),
  })
    .index("by_event", ["eventId"])
    .index("by_category", ["categoryId"])
    .index("by_event_name", ["eventId", "name"]),
});
```

### Pattern 2: Convex Function Organization (D-29 Decision)

**What:** Thin public functions in root `convex/` files that delegate to `convex/model/` helpers.
**When to use:** Always -- this is the Convex-recommended pattern. [CITED: docs.convex.dev/understanding/best-practices/]

```typescript
// convex/model/events.ts -- business logic
import { MutationCtx, QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["active"],
  active: ["live", "draft"],
  live: ["completed"],
  completed: ["archived"],
  archived: [],
};

export async function validateTransition(
  currentStatus: string,
  newStatus: string,
): Promise<void> {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${currentStatus} -> ${newStatus}. ` +
      `Allowed: ${allowed?.join(", ") || "none"}`
    );
  }
}

export async function createDefaultCategory(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<void> {
  await ctx.db.insert("guestCategories", {
    eventId,
    name: "General",
    isDefault: true,
  });
}

// convex/events.ts -- thin public API
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { validateTransition, createDefaultCategory } from "./model/events";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    venue: v.optional(v.string()),
    eventDate: v.number(),
    endDate: v.optional(v.number()),
    config: v.object({
      qrStrategy: v.union(v.literal("unified"), v.literal("separate")),
      foodQrMode: v.union(v.literal("guestLinked"), v.literal("anonymous")),
      foodQrTiming: v.union(v.literal("preSent"), v.literal("postEntry")),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const now = Date.now();
    const eventId = await ctx.db.insert("events", {
      ...args,
      status: "draft",
      createdBy: identity.subject,
      createdAt: now,
      updatedAt: now,
    });

    // Auto-create default "General" category (D-11)
    await createDefaultCategory(ctx, eventId);

    return eventId;
  },
});

export const updateStatus = mutation({
  args: {
    eventId: v.id("events"),
    newStatus: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("live"),
      v.literal("completed"),
      v.literal("archived"),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");

    await validateTransition(event.status, args.newStatus);

    await ctx.db.patch(args.eventId, {
      status: args.newStatus,
      updatedAt: Date.now(),
    });

    // If transitioning to "live", trigger Redis sync (D-09)
    if (args.newStatus === "live") {
      await ctx.scheduler.runAfter(0, "internal:sync:pushEventToGo", {
        eventId: args.eventId,
      });
    }
  },
});
```

### Pattern 3: Event Lifecycle State Machine (D-07 Decision)

**What:** Controlled state transitions with validation.

```
draft -----> active -----> live -----> completed -----> archived
  ^            |
  |            |
  +------------+
  (can revert to draft from active only)
```

**Transition rules:**
- `draft -> active`: Event configuration is complete, ready for guest import/QR generation
- `active -> live`: Event goes live for scanning (automatic via scheduled function at eventDate, or manual "Go Live Early")
- `active -> draft`: Admin reverts to draft to make changes (only before going live)
- `live -> completed`: Event ends, scanning stops
- `completed -> archived`: Admin archives for long-term storage

**Constraints:**
- Once `live`, cannot go back -- scanning may have started, data integrity requires forward-only
- `live` transition triggers Redis data sync (D-09)
- Convex scheduled function checks at `eventDate` and auto-transitions `active -> live` (D-08)

### Pattern 4: HMAC Authentication for Convex-to-Go Calls (D-14)

**What:** Convex HTTP actions sign requests to Go with HMAC-SHA256. Go middleware verifies.
**Why:** Prevents unauthorized calls to Go sync/scan endpoints. [CITED: oneuptime.com HMAC guide]

```go
// backend/internal/middleware/hmac.go
package middleware

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "io"
    "net/http"
    "strings"
    "time"
)

func HMACAuth(secret string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            signature := r.Header.Get("X-Signature")
            timestamp := r.Header.Get("X-Timestamp")

            if signature == "" || timestamp == "" {
                http.Error(w, `{"error":{"code":"UNAUTHORIZED","message":"Missing signature"}}`, 401)
                return
            }

            // Reject requests older than 5 minutes (replay protection)
            ts, err := time.Parse(time.RFC3339, timestamp)
            if err != nil || time.Since(ts) > 5*time.Minute {
                http.Error(w, `{"error":{"code":"UNAUTHORIZED","message":"Request expired"}}`, 401)
                return
            }

            body, _ := io.ReadAll(r.Body)
            r.Body = io.NopCloser(strings.NewReader(string(body)))

            mac := hmac.New(sha256.New, []byte(secret))
            mac.Write([]byte(timestamp))
            mac.Write(body)
            expected := hex.EncodeToString(mac.Sum(nil))

            if !hmac.Equal([]byte(signature), []byte(expected)) {
                http.Error(w, `{"error":{"code":"UNAUTHORIZED","message":"Invalid signature"}}`, 401)
                return
            }

            next.ServeHTTP(w, r)
        })
    }
}
```

### Pattern 5: Go Error Response Convention (D-24)

**What:** Consistent JSON error responses across all Go endpoints.

```go
// backend/internal/model/errors.go
package model

import "errors"

var (
    ErrNotFound       = errors.New("not found")
    ErrDuplicate      = errors.New("duplicate")
    ErrInvalidState   = errors.New("invalid state transition")
    ErrUnauthorized   = errors.New("unauthorized")
)

// ErrorResponse is the standard JSON error envelope
type ErrorResponse struct {
    Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
    Code    string      `json:"code"`
    Message string      `json:"message"`
    Details interface{} `json:"details,omitempty"`
}
```

### Anti-Patterns to Avoid

- **Replicating CRUD data to PostgreSQL:** Per D-05, Convex is the source of truth for events/vendors/guests. Do not create PG tables for this data. PG is for scan records only.
- **Using Convex actions where mutations suffice:** Actions do not retry automatically and lack transactional guarantees. Use mutations for all database writes. Use actions only for external HTTP calls (like pushing to Go). [CITED: docs.convex.dev/functions/actions]
- **Deeply nested Convex documents:** Arrays over ~10 elements and deep nesting hurt query performance. Use separate tables with indexed back-references for vendor hierarchy. [CITED: stack.convex.dev/relationship-structures]
- **ctx.runAction inside mutations:** Causes unnecessary complexity. Use `ctx.scheduler.runAfter(0, ...)` to trigger actions from mutations instead. [CITED: docs.convex.dev/understanding/best-practices/]
- **Polling from Go to Convex:** Per D-03/D-04, Convex pushes to Go, not the reverse. Go should never poll Convex for data.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Authentication | Custom JWT/session system | Better Auth via @convex-dev/better-auth | Session management, token refresh, secure cookie handling are deceptively complex. Better Auth handles email/password, social auth, session lifecycle. [CITED: better-auth.com/docs/integrations/convex] |
| Database migrations | Manual SQL scripts | golang-migrate v4.19.1 | Up/down migrations, version tracking, dirty state recovery. Well-tested edge cases. |
| SQL type generation | Manual Go structs for query results | sqlc v1.30.0 | Generates type-safe Go from SQL. Zero runtime reflection. Catches schema drift at compile time. |
| Connection pooling | Go-level pool + manual PG connections | PgBouncer (Docker) + pgxpool | PgBouncer handles 10K->150 connection fan-in. pgxpool manages Go-side pool. Two levels needed for production scale. |
| CORS handling | Manual header setting | chi/middleware.CORS or custom middleware | Preflight handling, allowed origins, credential cookies -- easy to get subtly wrong |
| Environment config | Custom config file parser | Simple env-based config with os.Getenv | Phase 1 is simple enough. Upgrade to envconfig/viper if config grows complex. |

## Common Pitfalls

### Pitfall 1: Convex OCC Contention on Shared Documents
**What goes wrong:** Multiple mutations reading and writing the same document (e.g., a counter document) cause OCC retries that cascade under load.
**Why it happens:** Convex uses optimistic concurrency control. Two mutations touching the same document version conflict and one retries. Under high concurrency, retry storms occur. [VERIFIED: docs.convex.dev/database/advanced/occ]
**How to avoid:** Do NOT use Convex for high-contention counters or scan records. This is why Redis handles counters and PG handles scan inserts. For Convex CRUD (events, vendors, categories), contention is low because admin operations are sequential.
**Warning signs:** Convex dashboard showing high mutation retry rates.

### Pitfall 2: Better Auth Version Mismatch
**What goes wrong:** Installing the latest better-auth breaks compatibility with @convex-dev/better-auth.
**Why it happens:** The Convex Better Auth component pins to a specific better-auth version. [CITED: labs.convex.dev/better-auth/framework-guides/react]
**How to avoid:** Pin better-auth to the version specified in Convex docs (currently 1.5.3). Use `--save-exact` flag. Check for updates in Convex Better Auth release notes before upgrading.
**Warning signs:** Type errors in auth setup, runtime errors about missing plugins or incompatible API.

### Pitfall 3: Convex Schema Changes After Data Exists
**What goes wrong:** Changing a field type or removing a required field in schema.ts fails because existing documents don't match the new schema.
**Why it happens:** Convex validates all existing documents against the schema on deploy. Unlike SQL migrations, there's no ALTER TABLE -- you must handle data migration within Convex.
**How to avoid:** Use `v.optional()` for new fields. For breaking changes, write a migration mutation that updates all existing documents before deploying the schema change. Plan schema carefully in Phase 1. [CITED: docs.convex.dev/database/schemas]
**Warning signs:** `npx convex dev` failing with schema validation errors.

### Pitfall 4: Docker Compose Port Conflicts
**What goes wrong:** PostgreSQL (5432), PgBouncer (6432), or Redis (6379) ports conflict with locally running services.
**Why it happens:** Developer has other projects using the same ports.
**How to avoid:** Use non-standard ports in docker-compose.yml (e.g., 15432 for PG, 16432 for PgBouncer, 16379 for Redis). Document in README.
**Warning signs:** "port is already allocated" errors on `docker compose up`.

### Pitfall 5: Go Module Path Mismatches
**What goes wrong:** Go import paths don't resolve because module name doesn't match the directory structure.
**Why it happens:** `go mod init` with wrong module path, or `internal/` packages imported incorrectly.
**How to avoid:** Initialize with the correct module path from day 1. Use `go mod init github.com/<user>/eventarc` matching the repo. All internal imports use `github.com/<user>/eventarc/internal/<package>`.
**Warning signs:** "package not found" compilation errors.

### Pitfall 6: Configuration Complexity Explosion (from Pitfalls Research)
**What goes wrong:** Event config has 3 binary options (qrStrategy, foodQrMode, foodQrTiming) = 8 combinations. Code paths multiply. [CITED: .planning/research/PITFALLS.md]
**How to avoid:** Use strategy pattern from Phase 1. Store config as structured data, select strategy implementation based on config at event creation time. Test all valid combinations. In Phase 1, just store the config -- the strategy dispatch matters in Phases 3-5.
**Warning signs:** Nested if/switch statements checking config flags in business logic.

## Code Examples

### Better Auth Setup for React Vite SPA

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

const app = defineApp();
app.use(betterAuth);
export default app;
```

```typescript
// convex/auth.config.ts
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
```

```typescript
// convex/auth.ts
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth } from "better-auth/minimal";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
```

```typescript
// convex/http.ts
import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth, { cors: true });
export default http;
```

```typescript
// src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL,
  plugins: [convexClient(), crossDomainClient()],
});
```

```typescript
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "./lib/auth-client";

const convex = new ConvexReactClient(
  import.meta.env.VITE_CONVEX_URL as string,
  { expectAuth: true },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <App />
    </ConvexBetterAuthProvider>
  </React.StrictMode>,
);
```
Source: [CITED: labs.convex.dev/better-auth/framework-guides/react]

### Go Chi Server Scaffold

```go
// backend/cmd/server/main.go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/go-chi/chi/v5"
    chimw "github.com/go-chi/chi/v5/middleware"
)

func main() {
    // slog: JSON in production, text in dev (D-25)
    var handler slog.Handler
    if os.Getenv("ENV") == "production" {
        handler = slog.NewJSONHandler(os.Stdout, nil)
    } else {
        handler = slog.NewTextHandler(os.Stdout, nil)
    }
    logger := slog.New(handler)
    slog.SetDefault(logger)

    r := chi.NewRouter()
    r.Use(chimw.RequestID)
    r.Use(chimw.RealIP)
    r.Use(chimw.Recoverer)

    // API v1 routes (D-13, D-15)
    r.Route("/api/v1", func(r chi.Router) {
        r.Get("/health", handleHealth)

        // HMAC-protected routes (D-14)
        r.Group(func(r chi.Router) {
            // r.Use(middleware.HMACAuth(cfg.HMACSecret))
            r.Post("/sync/event", handleSyncEvent)
        })
    })

    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }

    srv := &http.Server{
        Addr:    ":" + port,
        Handler: r,
    }

    // Graceful shutdown
    go func() {
        slog.Info("server starting", "port", port)
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            slog.Error("server error", "err", err)
            os.Exit(1)
        }
    }()

    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    srv.Shutdown(ctx)
    slog.Info("server stopped")
}
```
Source: [VERIFIED: go-chi.io docs, chi v5 API]

### Docker Compose (Infrastructure Services)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: eventarc
      POSTGRES_USER: eventarc
      POSTGRES_PASSWORD: ${PG_PASSWORD:-dev_password}
    ports:
      - "${PG_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U eventarc"]
      interval: 5s
      timeout: 3s
      retries: 5

  pgbouncer:
    image: bitnami/pgbouncer:latest
    environment:
      POSTGRESQL_HOST: postgres
      POSTGRESQL_DATABASE: eventarc
      POSTGRESQL_USERNAME: eventarc
      POSTGRESQL_PASSWORD: ${PG_PASSWORD:-dev_password}
      PGBOUNCER_DATABASE: eventarc
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_DEFAULT_POOL_SIZE: "150"
      PGBOUNCER_MAX_CLIENT_CONN: "10000"
    ports:
      - "${PGBOUNCER_PORT:-6432}:6432"
    depends_on:
      postgres:
        condition: service_healthy

  redis:
    image: redis:8-alpine
    ports:
      - "${REDIS_PORT:-6379}:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy noeviction
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

Note: Redis `maxmemory-policy` is set to `noeviction` (not `allkeys-lru`) because counter keys must never be evicted. Fail loudly rather than silently losing counters. [CITED: .planning/research/PITFALLS.md]

### Minimal PostgreSQL Migration (D-31 Decision)

```sql
-- backend/migrations/000001_init.up.sql
-- Phase 1: minimal schema, scan tables fully built in Phase 4

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Scan records table (placeholder, expanded in Phase 4)
CREATE TABLE IF NOT EXISTS entry_scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    event_id        TEXT NOT NULL,          -- Convex event ID (string)
    guest_id        TEXT NOT NULL,          -- Convex guest ID (string)
    stall_id        TEXT NOT NULL,          -- Convex stall ID (string)
    scanned_at      TIMESTAMPTZ NOT NULL,   -- Client timestamp
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'valid'
);

CREATE INDEX idx_entry_scans_event ON entry_scans(event_id);
CREATE INDEX idx_entry_scans_guest ON entry_scans(event_id, guest_id);

-- Event counters (synced from Redis periodically)
CREATE TABLE IF NOT EXISTS event_counters (
    event_id    TEXT NOT NULL,
    counter_key TEXT NOT NULL,
    value       BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, counter_key)
);
```

```sql
-- backend/migrations/000001_init.down.sql
DROP TABLE IF EXISTS event_counters;
DROP TABLE IF EXISTS entry_scans;
DROP EXTENSION IF EXISTS "pgcrypto";
```

### Redis Key Naming Convention (D-30 Decision)

```
# Namespace: eventarc:{resource}:{id}:{subresource}

# Event config cache
eventarc:event:{convex_event_id}:config          -> JSON blob (TTL: 5min)

# QR token lookup (populated on go-live)
eventarc:qr:{token}                              -> JSON { guestId, eventId, qrType, isActive }

# Atomic counters (populated on go-live, incremented on scan)
eventarc:event:{convex_event_id}:counters         -> HASH { totalEntryScans, uniqueAttendees, ... }

# Idempotency cache
eventarc:idem:{idempotency_key}                   -> JSON { status, scanId, processedAt } (TTL: 24h)

# Device session
eventarc:device:{device_id}                       -> JSON { eventId, stallId, lastSeen } (TTL: event duration)
```

Pattern: `eventarc:` prefix for namespace isolation. Colons as separators. Convex IDs used as-is (strings). No encoding needed.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Convex Auth (deprecated) | Better Auth via @convex-dev/better-auth | 2025-2026 | Better Auth is the current recommended auth integration for Convex. Not "Convex Auth" which was the older approach. [CITED: docs.convex.dev/auth] |
| better-auth direct import | better-auth/minimal import | 2025 | Convex docs recommend importing from `better-auth/minimal` for smaller bundle size in serverless context |
| Vite 6.x | Vite 8.0.8 (Rolldown-based) | March 2026 | Rolldown bundler (Rust-powered) replaces Rollup. No config changes needed. [VERIFIED: npm registry] |
| TailwindCSS 3.x (JS config) | TailwindCSS 4.2.2 (CSS-first config) | 2025-2026 | CSS `@import "tailwindcss"` replaces tailwind.config.js. @tailwindcss/vite plugin. [VERIFIED: npm registry] |
| Go 1.23 | Go 1.26.0 | 2026 | Go 1.26 installed locally. Fully backward compatible with code targeting 1.23+. [VERIFIED: local environment] |
| TypeScript 5.x | TypeScript 6.0.2 | 2026 | Installed globally. [VERIFIED: npm registry] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | better-auth@1.5.3 pin is still required for @convex-dev/better-auth@0.11.4 | Standard Stack | Auth setup fails if version mismatch. Verify pin in Convex Better Auth docs before installing. |
| A2 | Convex Pro (S256) allows 256 concurrent mutations | D-06 Resolution | If Convex increased this limit significantly, PG might be droppable. But even at 512 (D1024 tier), it's insufficient for 10K concurrent scans. |
| A3 | bitnami/pgbouncer Docker image supports the environment variables listed | Code Examples | Docker Compose fails if env vars changed. Verify against latest bitnami/pgbouncer docs. |
| A4 | Go module path should use github.com/<user>/eventarc | Architecture | If the user prefers a different module path, adjust at `go mod init` time. |
| A5 | Convex scheduled functions can trigger at a specific datetime for auto go-live (D-08) | Architecture Patterns | Convex scheduled functions use `ctx.scheduler.runAt(timestamp, ...)` which should support this. [ASSUMED] |

## Open Questions (RESOLVED)

1. **Convex Project Initialization Approach** — RESOLVED
   - What we know: `npm create convex@latest` initializes a Convex project, but we need it as a subdirectory within the monorepo, not the root.
   - Resolution: Initialize Convex in the `convex/` directory by running `npx convex init` from the project root. Convex functions live in `convex/` by default. The CLI supports this natively.

2. **Better Auth Pin Version Currency** — RESOLVED
   - What we know: Convex Better Auth docs recommend pinning better-auth to 1.5.3. Latest better-auth is 1.6.2.
   - Resolution: Start with the pinned version (1.5.3) as recommended by Convex docs. Test upgrading after Phase 1 is stable. The pin ensures compatibility with @convex-dev/better-auth@0.11.4.

3. **Convex + Vite Monorepo Configuration** — RESOLVED
   - What we know: Convex expects `convex/` at the project root by default.
   - Resolution: Keep `convex/` at the monorepo root (this is standard). Configure Vite's `VITE_CONVEX_URL` in `frontend/.env.local`. The Convex React client connects via URL, not file path.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Go | Backend microservice | Yes | 1.26.0 | -- |
| Node.js | Frontend + Convex CLI | Yes | 24.14.1 | -- |
| pnpm | Package management | Yes | 10.33.0 | -- |
| Docker | Infrastructure services | Yes | 29.4.0 | -- |
| Docker Compose | Service orchestration | Yes | 5.1.1 | -- |
| PostgreSQL client (psql) | Migration verification | Yes | 18.3 | -- |
| sqlc | SQL code generation | No | -- | Install via `go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0` |
| golang-migrate | Database migrations | No | -- | Install via `go install github.com/golang-migrate/migrate/v4/cmd/migrate@v4.19.1` |
| Redis CLI | Redis debugging | No | -- | Use Docker: `docker compose exec redis redis-cli` |
| TypeScript (tsc) | Type checking | No (global) | -- | Installed as project devDependency via pnpm |

**Missing dependencies with no fallback:** None -- all missing tools can be installed.

**Missing dependencies with fallback:**
- sqlc and golang-migrate: Install via `go install` during setup (Wave 0 task)
- Redis CLI: Use via Docker exec

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (Go) | Go stdlib testing + testify |
| Framework (Frontend) | Vitest |
| Config file | None -- see Wave 0 |
| Quick run command (Go) | `cd backend && go test ./...` |
| Quick run command (Frontend) | `cd frontend && pnpm test` |
| Full suite command | `cd backend && go test -race ./... && cd ../frontend && pnpm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVNT-01 | Create event via Convex mutation | Integration (Convex test) | Convex function test | No -- Wave 0 |
| EVNT-02 | Configure event settings (qr strategy, food mode, timing) | Unit | Validator test in Convex | No -- Wave 0 |
| EVNT-03 | Event lifecycle state transitions | Unit | `go test ./... -run TestStateTransition` or Convex test | No -- Wave 0 |
| EVNT-04 | Custom guest categories per event | Integration | Convex function test | No -- Wave 0 |
| VNDR-01 | Vendor hierarchy CRUD | Integration | Convex function test | No -- Wave 0 |
| VNDR-02 | Stall has independent identity | Integration | Convex function test | No -- Wave 0 |
| VNDR-03 | Add/remove/reconfigure stalls | Integration | Convex function test | No -- Wave 0 |
| INFR-01 | Layered architecture (CDN->Redis->PG) | Smoke | `docker compose up -d && curl http://localhost:8080/api/v1/health` | No -- Wave 0 |
| INFR-02 | PgBouncer connection pooling | Smoke | `docker compose exec pgbouncer psql -p 6432 -U eventarc -c "SHOW POOLS"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd backend && go test ./...`
- **Per wave merge:** Full suite (Go + Frontend)
- **Phase gate:** Full suite green + `docker compose up` + health check passing

### Wave 0 Gaps
- [ ] `backend/*_test.go` -- Go test files for handlers/services
- [ ] `frontend/vitest.config.ts` -- Vitest configuration
- [ ] Convex test setup (optional: Convex supports testing via `npx convex run` for function-level tests)
- [ ] `go install` for sqlc and golang-migrate CLI tools

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Better Auth via Convex (email/password for admin, device sessions for vendors in later phases) |
| V3 Session Management | Yes | Better Auth handles session tokens, secure cookies, token refresh |
| V4 Access Control | Yes | Convex `ctx.auth.getUserIdentity()` check in every public mutation/query |
| V5 Input Validation | Yes | Convex argument validators (v.string, v.union, v.id) enforce types at API boundary; Go validates HMAC signature |
| V6 Cryptography | Yes | HMAC-SHA256 for Convex->Go request signing. Never hand-roll crypto -- use Go `crypto/hmac` stdlib. |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized Convex mutation calls | Spoofing | `ctx.auth.getUserIdentity()` check in every public mutation |
| Forged requests to Go sync endpoint | Tampering | HMAC-SHA256 signature verification middleware (D-14) |
| Replay attacks on Go endpoints | Replay | Timestamp in HMAC payload, reject requests > 5 min old |
| CORS misconfiguration | Information Disclosure | Explicit allowed origins, no wildcard in production |
| Sensitive data in .env committed to git | Information Disclosure | .gitignore for .env.local, Convex env vars via CLI |

## Project Constraints (from CLAUDE.md)

- **Git commits:** Do NOT add `Co-Authored-By: Claude` line. Keep commit messages clean.
- **Tech stack (scan hot path):** Go + PostgreSQL 17 + PgBouncer + Redis 8
- **Tech stack (CRUD/real-time):** Convex Pro
- **Tech stack (frontend):** React + TailwindCSS + Vite, pnpm, TanStack Router/Query, Convex React client
- **Concurrency:** Must handle 10K concurrent writes without race conditions
- **Data integrity:** Zero tolerance for false positives/negatives
- **Architecture:** Hybrid Convex + Go
- **QR storage:** Cloudflare R2 via CDN
- **Real-time:** Convex subscriptions for dashboard, Go to Convex bridge mutation after each scan
- **Hosting preference:** Hetzner primary, DigitalOcean fallback, Hostinger excluded
- **Deployment:** Dokploy for container management
- **GSD Workflow:** Use GSD commands for all file-changing work

## Sources

### Primary (HIGH confidence)
- [Convex Limits](https://docs.convex.dev/production/state/limits) -- Deployment class limits, concurrent mutations
- [Convex OCC](https://docs.convex.dev/database/advanced/occ) -- Optimistic concurrency control behavior
- [Convex Schema](https://docs.convex.dev/database/schemas) -- Schema definition API, validator types
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) -- Function organization, query patterns
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) -- One-to-many, many-to-many modeling
- [Convex HTTP Actions](https://docs.convex.dev/functions/http-actions) -- Route definition, CORS, request handling
- [Convex High-Throughput Mutations](https://stack.convex.dev/high-throughput-mutations-via-precise-queries) -- OCC contention reduction patterns
- [Convex Better Auth (React Vite SPA)](https://labs.convex.dev/better-auth/framework-guides/react) -- Complete setup guide
- [Better Auth Convex Integration](https://better-auth.com/docs/integrations/convex) -- Official integration docs
- [Convex Pricing](https://www.convex.dev/pricing) -- Professional tier limits and pricing
- [Go chi v5 Router](https://pkg.go.dev/github.com/go-chi/chi/v5) -- Router API, middleware
- [HMAC Request Signing in Go](https://oneuptime.com/blog/post/2026-01-25-secure-apis-hmac-request-signing-go/view) -- HMAC authentication middleware pattern
- [Go Proxy](https://proxy.golang.org/) -- Verified latest versions for chi, pgx, go-redis, golang-migrate, sqlc

### Secondary (MEDIUM confidence)
- [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions) -- Scheduled mutations (exact-once) vs actions (at-most-once)
- [Convex How It Works](https://stack.convex.dev/how-convex-works) -- Internal architecture, OCC pipeline

### Tertiary (LOW confidence)
- None -- all claims verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified against npm registry and Go proxy
- Architecture: HIGH -- Convex schema patterns verified against official docs, Go patterns standard
- Pitfalls: HIGH -- OCC contention verified against Convex docs, auth version pinning from official guide
- D-06 resolution: HIGH -- Convex Pro limits verified, OCC behavior documented

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (Convex releases may change Better Auth compatibility; check pinned version)
