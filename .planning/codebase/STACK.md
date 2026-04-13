# Technology Stack

**Analysis Date:** 2026-04-12

## Languages

**Primary:**
- **TypeScript** ~6.0.2 - Frontend (React), Convex backend functions, test files
- **Go** 1.25.0 - Backend server and worker (scan processing, QR generation, card compositing, SMS delivery)

**Secondary:**
- **SQL** - PostgreSQL migrations (`backend/migrations/`), queries via sqlc (`backend/queries/`)
- **Lua** - Redis atomic scripts for scan processing (`backend/internal/scan/lua.go`, `backend/internal/scan/food_lua.go`)

## Runtime

**Frontend:**
- Node.js (version not pinned; no `.nvmrc` or `.node-version` file)
- Vite dev server on port 5173

**Backend:**
- Go 1.25 (compiled binary, Docker image `golang:1.25-alpine`)
- Two separate binaries: `server` (`backend/cmd/server/main.go`) and `worker` (`backend/cmd/worker/main.go`)

**Convex:**
- Convex Pro (cloud-hosted runtime for `convex/` functions)

**Package Manager:**
- **pnpm** 10.33.0 (declared in root `package.json` `packageManager` field)
- Root lockfile: `pnpm-lock.yaml`
- Frontend lockfile: `frontend/pnpm-lock.yaml`
- No pnpm workspace file detected (root and frontend have separate `package.json`)

## Frameworks

**Core:**
- **React** ^19.2.4 - UI framework (`frontend/package.json`)
- **Convex** ^1.35.1 - Backend-as-a-service for CRUD, real-time subscriptions, auth (`convex/`)
- **chi** v5.2.1 - Go HTTP router (`github.com/go-chi/chi/v5`)

**Testing:**
- **Vitest** ^4.1.4 - Frontend unit tests, jsdom environment (`frontend/vitest.config.ts`)
- **Playwright** ^1.59.1 - E2E browser tests (`frontend/playwright.config.ts`, `frontend/e2e/`)
- **Go stdlib testing** + **testify** v1.11.1 - Backend unit/integration tests
- **testcontainers-go** v0.42.0 - Integration tests with real PostgreSQL and Redis containers

**Build/Dev:**
- **Vite** ^8.0.4 - Frontend bundler and dev server (`frontend/vite.config.ts`)
- **TailwindCSS** ^4.2.2 - CSS framework via `@tailwindcss/vite` plugin
- **TanStack Router Plugin** ^1.167.14 - Auto-generates route tree (`frontend/src/routeTree.gen.ts`)
- **Docker** - Multi-stage Dockerfile for Go server and worker (`backend/Dockerfile`, `backend/Dockerfile.worker`)

## Key Dependencies

### Frontend (`frontend/package.json`)

**Critical:**
- **convex** ^1.35.1 - Convex React client for real-time data subscriptions
- **@convex-dev/better-auth** ^0.11.4 - Convex-integrated authentication
- **better-auth** 1.5.3 - Auth framework (pinned exact version)
- **@tanstack/react-router** ^1.168.15 - Type-safe file-based routing
- **@tanstack/react-query** ^5.97.0 - Server state management and caching
- **react** ^19.2.4 / **react-dom** ^19.2.4 - UI framework

**UI/UX:**
- **fabric** ^7.2.0 - Canvas-based invitation card template editor
- **lucide-react** ^1.8.0 - Icon library
- **motion** ^12.38.0 - Animation library (Framer Motion successor)
- **sonner** ^2.0.7 - Toast notification component
- **@base-ui/react** ^1.3.0 - Headless UI primitives
- **shadcn** ^4.2.0 - Component library CLI
- **class-variance-authority** ^0.7.1 - Variant-based component styling
- **clsx** ^2.1.1 + **tailwind-merge** ^3.5.0 - Conditional class composition
- **tw-animate-css** ^1.4.0 - TailwindCSS animation utilities

**Data/Utilities:**
- **zustand** ^5.0.12 - Lightweight client state (scanner offline state: `frontend/src/stores/scanner-store.ts`)
- **xlsx** ^0.18.5 - Excel file parsing for guest bulk import
- **html5-qrcode** ^2.3.8 - Browser-based QR code scanner
- **idb** ^8.0.3 - IndexedDB wrapper for offline scan queue

**Fonts:**
- **@fontsource-variable/inter** ^5.2.8 - Inter variable font
- **cal-sans** ^1.0.1 - Cal Sans display font

### Backend (`backend/go.mod`)

**Critical:**
- **pgx/v5** v5.9.1 - PostgreSQL driver with connection pooling (`github.com/jackc/pgx/v5`)
- **go-redis/v9** v9.18.0 - Redis client (`github.com/redis/go-redis/v9`)
- **chi/v5** v5.2.1 - HTTP router (`github.com/go-chi/chi/v5`)
- **asynq** v0.26.0 - Redis-backed async task queue (`github.com/hibiken/asynq`)

**Image Processing:**
- **yeqown/go-qrcode/v2** v2.2.5 - QR code generation
- **disintegration/imaging** v1.6.2 - Image resizing for card compositing
- **fogleman/gg** v1.3.0 - 2D rendering (indirect, used by go-qrcode)

**Cloud Storage:**
- **aws-sdk-go-v2/service/s3** v1.99.0 - S3-compatible client for Cloudflare R2 (`backend/internal/r2/client.go`)

**Testing:**
- **testify** v1.11.1 - Test assertions
- **testcontainers-go** v0.42.0 - Docker-based integration test infrastructure
- **testcontainers-go/modules/postgres** v0.42.0 - PostgreSQL test containers
- **testcontainers-go/modules/redis** v0.42.0 - Redis test containers
- **alicebob/miniredis/v2** v2.37.0 - In-memory Redis for unit tests

### Root (`package.json`)

- **convex** ^1.35.1 - Convex CLI and deployment tooling
- **@convex-dev/better-auth** ^0.11.4 - Auth component for Convex
- **better-auth** 1.5.3 - Auth framework

## Dev Dependencies

**Linting:**
- **eslint** ^9.39.4 - JavaScript/TypeScript linter
- **@eslint/js** ^9.39.4 - ESLint core rules
- **typescript-eslint** ^8.58.0 - TypeScript ESLint integration
- **eslint-plugin-react-hooks** ^7.0.1 - React Hooks rules
- **eslint-plugin-react-refresh** ^0.5.2 - Vite React Refresh rules

**TypeScript:**
- **typescript** ~6.0.2 - TypeScript compiler
- **@types/react** ^19.2.14, **@types/react-dom** ^19.2.3, **@types/node** ^24.12.2

**Testing Dev:**
- **@testing-library/react** ^16.3.2 - React component testing utilities
- **@testing-library/jest-dom** ^6.9.1 - DOM assertion matchers
- **jsdom** ^29.0.2 - DOM environment for Vitest
- **fake-indexeddb** ^6.2.5 - IndexedDB mock for offline queue tests

**Build:**
- **@vitejs/plugin-react** ^6.0.1 - React SWC plugin for Vite
- **@tailwindcss/vite** ^4.2.2 - TailwindCSS Vite integration
- **@tanstack/router-devtools** ^1.166.13 - Router debugging tools
- **@tanstack/router-plugin** ^1.167.14 - Auto route generation

## Configuration

**Environment:**
- Root `.env` and `.env.example` - Infrastructure and Go backend config
- Root `.env.local` - Convex deployment overrides
- `frontend/.env.local` - Frontend Vite env vars (VITE_CONVEX_URL, VITE_CONVEX_SITE_URL)
- All env vars loaded via `os.Getenv` in Go (`backend/internal/config/config.go`)

**Required env vars (from `.env.example` and `backend/internal/config/config.go`):**
- `DATABASE_URL` - PostgreSQL connection via PgBouncer
- `REDIS_URL` - Redis connection
- `HMAC_SECRET` - Shared secret for Go<->Convex signed requests
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` - Cloudflare R2
- `CONVEX_URL` - Convex HTTP API URL
- `VITE_CONVEX_URL` - Convex client URL (frontend)
- `VITE_CONVEX_SITE_URL` - Convex site URL for auth (frontend)
- `SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_SENDER_ID`, `SMS_PROVIDER_BASE_URL` - SMS.NET.BD credentials
- `SITE_URL` - Frontend origin for auth CORS (Convex env)
- `GO_API_URL` or `GO_BACKEND_URL` - Go backend URL (Convex env)

**Build:**
- `frontend/vite.config.ts` - Vite config with TailwindCSS, TanStack Router, React plugins; path aliases (`@/` -> `src/`, `convex/_generated`); dev proxy `/api` to Go backend port 8080
- `frontend/tsconfig.json` - Project references to `tsconfig.app.json` and `tsconfig.node.json`
- `frontend/tsconfig.app.json` - ES2023 target, bundler moduleResolution, strict linting flags
- `frontend/eslint.config.js` - Flat config with TypeScript, React Hooks, and React Refresh rules
- `backend/sqlc.yaml` - sqlc code generation: pgx/v5 driver, queries from `backend/queries/`, output to `backend/internal/db/`

**Testing:**
- `frontend/vitest.config.ts` - jsdom environment, globals enabled, tests in `src/**/*.{test,spec}.{ts,tsx}`
- `frontend/playwright.config.ts` - Chromium + Pixel 7 mobile projects, E2E tests in `frontend/e2e/`, dev server auto-start

## Infrastructure (Docker)

**`docker-compose.yml`:**
- **PostgreSQL 17** - Primary database on port 5432
- **PgBouncer 1.25.1** (`edoburu/pgbouncer:1.25.1`) - Connection pooler on port 6432, transaction pooling, pool_size=150, max_client_conn=10000
- **Redis 8 Alpine** - Cache/counters/pub-sub on port 6379, 256MB maxmemory, noeviction policy
- **Worker** - Go worker service (builds from `backend/` Dockerfile `worker` target)

**`docker-compose.staging.yml`** (overlay for load testing):
- PostgreSQL tuned: shared_buffers=256MB, work_mem=4MB, max_connections=200, 1GB memory limit
- PgBouncer: pool_size=150, max_client_conn=10000, min_pool_size=25
- Redis: 512MB memory limit, persistence disabled
- Worker: GOMAXPROCS=2, GOMEMLIMIT=450MiB, 512MB/2 CPU limit

**Container builds:**
- `backend/Dockerfile` - Multi-target: `golang:1.25-alpine` builder -> `alpine:3.21` runtime for both `server` and `worker` targets
- `backend/Dockerfile.worker` - Standalone worker build

## Platform Requirements

**Development:**
- Node.js (no version pinned)
- pnpm 10.33.0
- Go 1.25+
- Docker and Docker Compose (for PostgreSQL, PgBouncer, Redis)
- Convex CLI (`npx convex`)

**Production:**
- Docker containers for Go server + worker
- Convex Pro cloud deployment
- PostgreSQL 17 + PgBouncer 1.25.1
- Redis 8
- Cloudflare R2 for image storage + CDN
- SMS.NET.BD for SMS delivery (Bangladesh market)

---

*Stack analysis: 2026-04-12*
