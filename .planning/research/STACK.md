# Technology Stack

**Project:** EventArc - High-Concurrency Event Management Platform
**Researched:** 2026-04-11
**Overall Confidence:** HIGH

---

## Go vs Rust: The Backend Language Decision

**Recommendation: Go**
**Confidence: HIGH**

This is the most consequential decision in the stack. Both languages can handle 10K concurrent writes. The question is which one gets you there faster without sacrificing correctness.

### Why Go Over Rust for EventArc

| Factor | Go | Rust | Winner |
|--------|-----|------|--------|
| Raw throughput (10K concurrent) | ~40K req/s | ~60K req/s | Rust |
| Memory usage | 100-320 MB | 50-80 MB | Rust |
| Development velocity | Days to productive | Weeks to productive | **Go** |
| Compile times | ~2-8 seconds | 30s-3min+ | **Go** |
| Ecosystem maturity for web APIs | Excellent (chi, pgx, go-redis) | Good (axum, sqlx, redis-rs) | **Go** |
| Concurrency model simplicity | goroutines + channels (native) | async/await + tokio (library) | **Go** |
| Hiring/team scaling | Large pool | Small pool | **Go** |
| Error handling predictability | Explicit, simple | Complex (Result types, lifetimes) | **Go** |

**The deciding factor:** EventArc is I/O-bound, not CPU-bound. QR scans hit Redis INCR (sub-ms), then write to Postgres. The bottleneck is database/network, not language performance. Rust's 1.5x throughput advantage is irrelevant when your database is the ceiling. Go's goroutine model handles 10K concurrent connections natively without external runtime libraries.

**What Rust would buy:** ~50% less memory, ~50% more raw throughput. Not worth 2-3x development time for an I/O-bound workload where PostgreSQL + PgBouncer is the actual bottleneck.

**What Go buys:** Ship in weeks instead of months. Simpler codebase. Larger talent pool. The concurrency model (goroutines) maps perfectly to "handle 10K independent QR scan requests simultaneously."

---

## Recommended Stack

### Core Backend

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Go** | 1.23+ | Backend language | Native concurrency via goroutines, fast compilation, excellent I/O-bound performance. Goroutines handle 10K concurrent connections with minimal memory overhead. |
| **chi** | v5.x | HTTP router | Lightweight, idiomatic, zero external dependencies, built on net/http stdlib. Supports middleware composition. No framework lock-in -- just a router. |
| **pgx/v5** | v5.x | PostgreSQL driver | Pure Go, fastest PG driver. pgxpool provides built-in connection pooling. Supports COPY, LISTEN/NOTIFY, binary protocol. Outperforms sqlx by significant margins in pooled scenarios. |
| **sqlc** | v1.x | SQL code generation | Generates type-safe Go code from SQL queries. No runtime reflection overhead (unlike GORM). 2x faster than GORM for reads. Write raw SQL, get type-safe Go. |
| **golang-migrate** | v4.x | Database migrations | Industry standard. CLI + library mode. Up/down migrations. Supports PostgreSQL natively. |
| **go-redis/v9** | v9.x | Redis client | Official Redis client for Go. RESP3 support, OpenTelemetry integration, connection pooling. 32KB read/write buffers by default for optimal throughput. |
| **coder/websocket** | latest | WebSocket (vendor scanning) | Successor to nhooyr/websocket. Context-aware, concurrent-write-safe (no panics), actively maintained by Coder. Better than gorilla/websocket which is archived. |
| **slog** | stdlib (Go 1.21+) | Structured logging | Standard library, zero dependencies. 650ns/op is sufficient for this workload. Avoids external dependency for something the stdlib handles well. Use zap only if logging becomes a proven bottleneck (it won't). |
| **asynq** | v0.x | Background job queue | Redis-backed task queue for Go. Handles QR image generation, SMS sending, card compositing as async jobs. Built-in retries, scheduling, priority queues, web UI monitoring. |

### Database Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **PostgreSQL** | 17.x (latest 17.9) | Primary database | Single-node PG with proper tooling handles 10K concurrent writes. No need for distributed SQL complexity. Advisory locks, LISTEN/NOTIFY, JSONB, excellent ACID guarantees. |
| **PgBouncer** | latest | Connection pooler | Multiplexes 10K app connections to ~100-200 actual PG connections. Transaction pooling mode. Without it, PG would need 10K processes (100GB RAM). With it, 50K+ req/s is achievable. |
| **Redis** | 8.0+ | Cache + counters + pub/sub | Atomic INCR for real-time counters (attendance, food consumption). Pub/Sub for broadcasting scan events to dashboard. Cache layer for QR validation lookups. Single-threaded = lock-free atomic operations. |

#### Why NOT CockroachDB or TiDB

| Database | Why Not |
|----------|---------|
| **CockroachDB** | Higher write latency due to distributed consensus (Raft). EventArc runs single-region events. Distributed SQL adds complexity without benefit for single-venue events. Write throughput is worse than well-tuned single-node PG for this access pattern. |
| **TiDB** | MySQL-compatible, not PostgreSQL. Adds operational complexity (TiKV + PD + TiDB server). Overkill for single-region event data. EventArc's data model (events + guests + scans) fits perfectly in a single PG instance with proper indexing. |

**The pattern:** PostgreSQL handles 10K concurrent writes when you pair it with PgBouncer (transaction pooling, pool_size=100-200) and use UPSERT with advisory locks for scan deduplication. Redis INCR handles the real-time counters atomically. No distributed database needed.

### Real-Time Layer

| Technology | Purpose | Why |
|------------|---------|-----|
| **SSE (Server-Sent Events)** | Admin dashboard updates | Dashboard is server-to-client only. SSE is simpler than WebSocket, works with HTTP/2 multiplexing, auto-reconnects, works through all proxies/load balancers. No bidirectional communication needed for dashboard. |
| **WebSocket** (via coder/websocket) | Vendor scanner sync | Scanners need bidirectional: send scan results AND receive acknowledgments/offline queue sync. WebSocket is correct here. |
| **Redis Pub/Sub** | Event broadcasting | Scan events published to Redis channels, SSE/WS handlers subscribe and push to connected clients. Fire-and-forget semantics are fine -- missed dashboard updates self-heal on next event. Sub-millisecond latency. |

#### Why NOT Redis Streams for Broadcasting

Redis Streams provides durability and consumer groups, but adds complexity EventArc doesn't need. Dashboard updates are ephemeral -- if a client misses one counter update, the next one overwrites it. Pub/Sub's fire-and-forget model is correct here. Use Streams only if you later need audit logs of all scan events (and even then, write directly to PostgreSQL).

### QR Generation and Image Processing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **yeqown/go-qrcode** | v2.x | QR code generation | Actively maintained, customizable (colors, shapes, logos), flexible encoder API. Better than skip2/go-qrcode which hasn't been updated in 5+ years. |
| **Go stdlib image/draw** | stdlib | Image compositing | Overlay QR onto invitation card template. No external library needed -- Go's image package handles PNG/JPEG decode, draw.Draw for compositing, and encoding. |
| **nfnt/resize** or **disintegration/imaging** | latest | Image resizing | Resize QR overlay to admin-specified dimensions before compositing onto card. imaging is more actively maintained. |

**QR generation pipeline (async via asynq):**
1. Generate QR data (guest UUID encoded)
2. Render QR image using yeqown/go-qrcode
3. Load card template image
4. Composite QR onto card at admin-specified coordinates
5. Encode final PNG
6. Upload to R2/S3
7. Store CDN URL in database

### Cloud Storage and CDN

| Technology | Purpose | Why |
|------------|---------|-----|
| **Cloudflare R2** | QR/card image storage | S3-compatible API. Zero egress fees (critical for 60K images served via CDN). $0.015/GB storage. Free tier: 10GB storage, 10M reads, 1M writes/month. |
| **Cloudflare CDN** | Image delivery | Automatic CDN when using R2 with custom domain. No separate CDN configuration needed. Images cached at edge globally. |

#### Why NOT AWS S3

S3 charges $0.09/GB egress. For 60K invitation card images (each ~200KB = 12GB total), every time guests download their cards, you pay egress. With R2, egress is $0. The S3-compatible API means zero code changes if you need to switch later.

### SMS Delivery

| Technology | Purpose | Why |
|------------|---------|-----|
| **SMS.NET.BD** or **BulkSMS.net** | Bulk SMS delivery | For Bangladesh market: SMS.NET.BD delivers 50K SMS/minute, has REST API, supports Bangla. For international: BulkSMS.net has global coverage. Abstract behind an interface -- SMS provider is swappable. |

**Implementation:** Define an `SMSProvider` interface in Go. Implement for your chosen provider. Queue SMS sends via asynq background jobs (never send synchronously in request handlers).

### Frontend

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **React** | 19.x | UI framework | Specified in constraints. Mature ecosystem, component model fits dashboard + scanner + admin views. |
| **Vite** | 8.x | Build tool | Latest: 8.0.x (March 2026). Rolldown-based bundler (Rust-powered). Instant HMR. Built-in TypeScript path resolution. |
| **TailwindCSS** | 4.2.x | Styling | Latest: 4.2.2. CSS-first configuration. 3.8x faster recompilation in v4.2. No runtime JS overhead. |
| **TanStack Router** | latest | Routing | Type-safe routing with automatic route type generation. 25% better throughput than React Router. State-first routing (URL -> State -> Data -> UI) fits dashboard data model. |
| **TanStack Query** | v5.x | Server state / data fetching | Caching, background refetching, optimistic updates. Handles SSE event-driven cache invalidation for real-time dashboard. Stable Suspense support in v5. |
| **Zustand** | latest | Client state | 1KB bundle. No boilerplate. Handles scanner UI state (selected stall, offline queue, connection status). TanStack Query handles server state; Zustand handles UI state. |
| **Fabric.js** | latest | Invitation card editor | Canvas-based drag-drop editor. Built-in object transform tool (resize, rotate, position). Better than Konva for this use case -- Konva requires manual transform implementation. Fabric.js has it built-in. |
| **pnpm** | latest | Package manager | Specified in constraints. Disk-efficient, fast, strict dependency resolution. |
| **TypeScript** | 5.x | Type safety | Non-negotiable for a project this complex. Catches routing errors, API contract mismatches, state shape bugs at compile time. |

### Infrastructure and DevOps

| Technology | Purpose | Why |
|------------|---------|-----|
| **Docker** | Containerization | Consistent dev/prod environments. Go binary + PgBouncer + Redis as services. |
| **Docker Compose** | Local development | Run PG + PgBouncer + Redis + Go server + Vite dev server locally. |
| **Nginx** or **Caddy** | Reverse proxy | TLS termination, static file serving, SSE/WS proxying. Caddy is simpler (automatic HTTPS). |

### Testing

| Technology | Purpose | Why |
|------------|---------|-----|
| **Go stdlib testing** | Unit/integration tests | Go's built-in test runner + testify for assertions. No external test framework needed. |
| **testcontainers-go** | Integration tests | Spin up real PostgreSQL + Redis in Docker for integration tests. No mocks for data layer. |
| **Vitest** | Frontend tests | Vite-native test runner. Fast, compatible with Jest API. |
| **Playwright** | E2E tests | Cross-browser testing for scanner UI, dashboard, admin flows. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Language | Go | Rust (Axum) | 2-3x slower development for negligible perf gain on I/O-bound workload |
| Router | chi v5 | Fiber | Fiber uses fasthttp (not net/http compatible). chi is idiomatic, stdlib-compatible |
| Router | chi v5 | Gin | Gin is fine but heavier than chi. chi's middleware composition is cleaner |
| DB Driver | pgx/v5 | GORM | GORM is 2x slower due to reflection. sqlc + pgx gives type safety without ORM overhead |
| DB Driver | pgx/v5 | sqlx | sqlx is ~70x slower than pgx in pooled benchmarks. pgxpool is purpose-built for PG |
| Database | PostgreSQL | CockroachDB | Distributed consensus adds latency. Single-node PG + PgBouncer handles 10K writes fine |
| Database | PostgreSQL | TiDB | MySQL-compatible (not PG). Operational complexity of 3-component cluster not justified |
| Real-time (dashboard) | SSE | WebSocket | Dashboard is unidirectional. SSE auto-reconnects, HTTP/2 native, simpler infrastructure |
| Message broker | Redis Pub/Sub | Redis Streams | Dashboard updates are ephemeral. Streams' durability adds complexity without value here |
| Message broker | Redis Pub/Sub | Kafka/NATS | Massive overkill. Redis is already in the stack. One fewer service to operate |
| QR library | yeqown/go-qrcode v2 | skip2/go-qrcode | skip2 hasn't been updated in 5+ years. yeqown v2 is actively maintained with customization |
| Object storage | Cloudflare R2 | AWS S3 | R2 has zero egress fees. S3 charges $0.09/GB egress. Same S3-compatible API |
| State management | Zustand | Redux Toolkit | 1KB vs large bundle. No boilerplate. TanStack Query handles server state; Zustand is only for UI |
| Canvas editor | Fabric.js | Konva.js | Fabric.js has built-in transform controls (resize/rotate). Konva requires manual implementation |
| WebSocket lib | coder/websocket | gorilla/websocket | gorilla is archived (2022). coder/websocket is context-aware, concurrent-write-safe |
| Logging | slog (stdlib) | zap | slog is fast enough (650ns/op). Zero dependencies. Zap only if >100K logs/sec (unlikely) |
| Task queue | asynq | Go worker pools | asynq gives retries, scheduling, priority queues, web UI. Worker pools require building all of this |

---

## Architecture-Specific Stack Decisions

### Atomic Counter System (Redis)

```
Scan request -> Redis INCR "event:{id}:attendance" -> return new count
Scan request -> Redis INCR "event:{id}:stall:{stall_id}:served" -> return new count
```

Redis INCR is atomic, lock-free, single-threaded. Handles millions of ops/sec. Dashboard reads these counters via SSE push (triggered by Redis Pub/Sub on scan events).

**Periodic sync to PostgreSQL:** Background job (asynq) every 30s writes Redis counters to PG for durability. Redis is the real-time source of truth; PG is the durable source of truth.

### Idempotent Scan Processing

```sql
-- PostgreSQL upsert for scan deduplication
INSERT INTO scans (guest_id, event_id, stall_id, scanned_at, idempotency_key)
VALUES ($1, $2, $3, NOW(), $4)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

Scanner generates idempotency key: `SHA256(guest_qr + stall_id + date)`. Offline queue replays use same key. Duplicate scans are silently ignored.

### Connection Pooling Strategy

```
App (10K connections) -> PgBouncer (transaction mode, pool_size=150) -> PostgreSQL (max_connections=200)
```

PgBouncer handles the connection fan-in. Each QR scan is a short transaction (~5-10ms). With 150 pool connections at 10ms each, theoretical throughput is 15K transactions/sec -- well above the 10K concurrent target.

---

## Installation

### Backend

```bash
# Initialize Go module
go mod init github.com/your-org/eventarc

# Core dependencies
go get github.com/go-chi/chi/v5
go get github.com/jackc/pgx/v5
go get github.com/jackc/pgx/v5/pgxpool
go get github.com/redis/go-redis/v9
go get github.com/coder/websocket
go get github.com/hibiken/asynq
go get github.com/yeqown/go-qrcode/v2
go get github.com/disintegration/imaging

# Database migrations
go install github.com/golang-migrate/migrate/v4/cmd/migrate@latest

# SQL code generation
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

### Frontend

```bash
# Create Vite React project
pnpm create vite@latest eventarc-ui --template react-ts

cd eventarc-ui

# Core dependencies
pnpm add @tanstack/react-router @tanstack/react-query zustand fabric

# Dev dependencies
pnpm add -D tailwindcss @tailwindcss/vite @tanstack/router-devtools @tanstack/react-query-devtools vitest @playwright/test
```

### Infrastructure (Docker Compose)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: eventarc
      POSTGRES_USER: eventarc
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  pgbouncer:
    image: bitnami/pgbouncer:latest
    environment:
      POSTGRESQL_HOST: postgres
      POSTGRESQL_DATABASE: eventarc
      PGBOUNCER_DATABASE: eventarc
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_DEFAULT_POOL_SIZE: "150"
      PGBOUNCER_MAX_CLIENT_CONN: "10000"
    ports:
      - "6432:6432"
    depends_on:
      - postgres

  redis:
    image: redis:8-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

volumes:
  pgdata:
```

---

## Version Summary

| Technology | Recommended Version | Latest Verified |
|------------|-------------------|-----------------|
| Go | 1.23+ | 1.23.x (stable) |
| chi | v5.x | v5 (Feb 2026) |
| pgx | v5.x | v5.x (active) |
| sqlc | v1.x | v1.x (active) |
| go-redis | v9.x | v9.12+ (active) |
| PostgreSQL | 17.x | 17.9 (Feb 2026) |
| Redis | 8.0+ | 8.0 (Oct 2025) |
| PgBouncer | latest | Active |
| Vite | 8.x | 8.0.8 (Apr 2026) |
| React | 19.x | 19.x (stable) |
| TailwindCSS | 4.2.x | 4.2.2 (Mar 2026) |
| TanStack Router | latest | Active |
| TanStack Query | v5.x | v5.x (stable) |
| Zustand | latest | Active |
| Fabric.js | latest | Active |
| TypeScript | 5.x | 5.x (stable) |
| asynq | v0.x | v0.x (active) |
| coder/websocket | latest | Active |
| yeqown/go-qrcode | v2.x | v2.x (active) |

---

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| Go over Rust | HIGH | Multiple 2025-2026 benchmarks confirm. I/O-bound workload analysis is well-established. Development velocity difference is widely documented. |
| PostgreSQL + PgBouncer | HIGH | PgBouncer handling 10K connections is specifically documented in multiple 2025-2026 guides. Transaction pooling at pool_size=150-200 is standard practice. |
| Redis for atomic counters | HIGH | Redis INCR atomicity is fundamental to Redis architecture. Millions of ops/sec documented. Official Redis documentation confirms. |
| SSE for dashboard | HIGH | Multiple 2025 sources agree: SSE beats WebSocket for unidirectional server-to-client streaming. Auto-reconnect, HTTP/2, simpler infra. |
| Cloudflare R2 | HIGH | Zero egress pricing verified from Cloudflare official docs. S3-compatible API confirmed. |
| TanStack Router over React Router | MEDIUM | Strong recommendation from 2025-2026 community, but React Router v7 is closing the gap. TanStack Router's type safety advantage is real. |
| Fabric.js for card editor | MEDIUM | Built-in transform tools verified, but building a production-quality editor is still significant work. May need to scope carefully. |
| yeqown/go-qrcode v2 | MEDIUM | Actively maintained and feature-rich, but specific performance benchmarks for 60K batch generation were not found. Likely fine given async processing via asynq. |
| asynq for task queue | MEDIUM | Well-documented, Redis-backed, feature-rich. Still v0.x (pre-1.0). API is stable in practice but technically not guaranteed. |

---

## Sources

- [Rust vs Go 2026 Benchmarks](https://byteiota.com/rust-vs-go-2026-backend-performance-benchmarks/)
- [Go Fiber vs Rust Axum Performance](https://medium.com/deno-the-complete-reference/go-fiber-vs-rust-axum-hello-world-performance-c59afab4e87e)
- [JetBrains Rust vs Go 2025](https://blog.jetbrains.com/rust/2025/06/12/rust-vs-go/)
- [PgBouncer for 10K Connections](https://oneuptime.com/blog/post/2026-01-26-pgbouncer-connection-pooling/view)
- [PostgreSQL Performance with PgBouncer](https://opstree.com/blog/2025/10/07/postgresql-performance-with-pgbouncer/)
- [Redis INCR Atomic Operations](https://redis.io/docs/latest/commands/incr/)
- [Redis Distributed Counters](https://oneuptime.com/blog/post/2026-01-27-redis-distributed-counters/view)
- [SSE vs WebSocket 2025](https://dev.to/polliog/server-sent-events-beat-websockets-for-95-of-real-time-apps-heres-why-a4l)
- [Cloudflare R2 vs AWS S3](https://www.cloudflare.com/pg-cloudflare-r2-vs-aws-s3/)
- [Go WebSocket Libraries 2025](https://websocket.org/guides/languages/go/)
- [coder/websocket GitHub](https://github.com/coder/websocket)
- [sqlc vs GORM vs sqlx](https://reintech.io/blog/sqlc-vs-gorm-vs-sqlx-go-database-libraries-compared-2026)
- [Go Database Patterns: pgx](https://dasroot.net/posts/2025/12/go-database-patterns-gorm-sqlx-pgx-compared/)
- [Redis Pub/Sub vs Streams](https://dev.to/lovestaco/redis-pubsub-vs-redis-streams-a-dev-friendly-comparison-39hm)
- [TanStack Router vs React Router](https://betterstack.com/community/comparisons/tanstack-router-vs-react-router/)
- [Zustand vs Redux 2025](https://www.meerako.com/blogs/react-state-management-zustand-vs-redux-vs-context-2025)
- [Asynq Task Queue](https://github.com/hibiken/asynq)
- [Go chi Router](https://github.com/go-chi/chi)
- [yeqown/go-qrcode v2](https://github.com/yeqown/go-qrcode)
- [Vite 8.0 Release](https://medium.com/@onix_react/vite-8-0-released-fbf23ade5f79)
- [TailwindCSS 4.2](https://www.infoq.com/news/2026/04/tailwind-css-4-2-webpack/)
- [Fabric.js vs Konva.js](https://dev.to/lico/react-comparison-of-js-canvas-libraries-konvajs-vs-fabricjs-1dan)
- [Distributed SQL Comparison 2025](https://sanj.dev/post/distributed-sql-databases-comparison)
- [Go chi vs Fiber vs Echo 2026](https://medium.com/@samayun_pathan/choosing-a-go-web-framework-in-2026-a-minimalists-guide-to-gin-fiber-chi-echo-and-beego-c79b31b8474d)
