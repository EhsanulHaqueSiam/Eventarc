# Codebase Structure

**Analysis Date:** 2026-04-12

## Directory Layout

```
event-management-system/
├── backend/                    # Go microservice (scan hot path + background worker)
│   ├── cmd/
│   │   ├── server/             # API server entry point
│   │   │   └── main.go
│   │   └── worker/             # Background worker entry point
│   │       └── main.go
│   ├── internal/
│   │   ├── card/               # Invitation card image compositing
│   │   ├── config/             # Environment config loader
│   │   ├── convexsync/         # HMAC-signed Convex HTTP client
│   │   ├── db/                 # sqlc-generated database code
│   │   ├── handler/            # HTTP handlers (health, QR, cards, SMS, session, sync)
│   │   ├── middleware/         # HTTP middleware (CORS, HMAC auth, logging)
│   │   ├── model/              # Shared domain types and errors
│   │   ├── qr/                 # QR code generation and payload encoding/decoding
│   │   ├── r2/                 # Cloudflare R2 storage client
│   │   ├── scan/               # Core scan processing (entry + food + durability)
│   │   ├── sms/                # SMS provider integration (SMS.NET.BD)
│   │   ├── sse/                # SSE broker and live dashboard handler
│   │   └── worker/             # asynq task definitions (QR generation)
│   ├── migrations/             # PostgreSQL schema migrations (golang-migrate)
│   ├── queries/                # Raw SQL queries (sqlc source)
│   ├── tests/
│   │   ├── hardening/          # Integration/hardening tests
│   │   └── load/               # k6 load test scripts and seed tools
│   ├── Dockerfile              # API server Docker build
│   ├── Dockerfile.worker       # Worker Docker build
│   ├── go.mod                  # Go module definition
│   └── sqlc.yaml               # sqlc code generation config
│
├── convex/                     # Convex backend (CRUD, auth, real-time, sync)
│   ├── model/                  # Domain model helpers (validation, business rules)
│   │   ├── categories.ts
│   │   ├── events.ts
│   │   ├── guests.ts
│   │   ├── phone.ts
│   │   └── vendors.ts
│   ├── _generated/             # Convex auto-generated types and API (DO NOT EDIT)
│   ├── schema.ts               # Database schema definition
│   ├── auth.ts                 # Better Auth setup + user queries/mutations
│   ├── auth.config.ts          # Auth configuration
│   ├── authz.ts                # Authorization helpers (role checks, permission guards)
│   ├── http.ts                 # HTTP router (auth routes + internal sync endpoints)
│   ├── events.ts               # Event CRUD queries/mutations
│   ├── guests.ts               # Guest CRUD, bulk import, search
│   ├── categories.ts           # Guest category management
│   ├── vendors.ts              # Vendor management
│   ├── vendorTypes.ts          # Vendor type (entry/food) management
│   ├── vendorCategories.ts     # Vendor category management
│   ├── stalls.ts               # Stall management
│   ├── foodRules.ts            # Food rules matrix (guest category x food category limits)
│   ├── cardTemplates.ts        # Card template CRUD
│   ├── deviceSessions.ts       # Device session mirroring for admin view
│   ├── smsDeliveries.ts        # SMS delivery tracking
│   ├── eventPermissions.ts     # Per-event user permissions
│   ├── qr.ts                   # QR generation trigger and progress
│   ├── sync.ts                 # Convex -> Go data sync (pushEventToGo, syncFoodRules)
│   ├── adminGateway.ts         # Admin actions that proxy to Go API (cards, SMS)
│   ├── internalGateway.ts      # HTTP actions receiving Go -> Convex sync callbacks
│   ├── seed.ts                 # Database seeding utilities
│   └── convex.config.ts        # Convex project config (components)
│
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── routes/             # TanStack Router file-based routes
│   │   ├── components/         # UI components organized by domain
│   │   ├── hooks/              # Custom React hooks
│   │   ├── lib/                # Utility libraries
│   │   ├── stores/             # Zustand stores
│   │   ├── assets/             # Static assets
│   │   ├── main.tsx            # App entry point
│   │   ├── app.css             # Global styles
│   │   └── routeTree.gen.ts    # Auto-generated route tree (DO NOT EDIT)
│   ├── e2e/                    # Playwright E2E tests
│   │   ├── fixtures/           # Test fixtures and helpers
│   │   └── .auth/              # Auth state for tests
│   ├── public/                 # Static public assets
│   ├── convex/                 # Symlinked _generated for frontend imports
│   ├── package.json
│   ├── vite.config.ts          # Vite build config
│   └── tsconfig.json           # TypeScript config
│
├── .planning/                  # GSD workflow artifacts
│   ├── codebase/               # Codebase analysis documents
│   ├── phases/                 # Phase planning (00 through 10)
│   └── research/               # Research documents
│
├── docker-compose.yml          # Local dev: PostgreSQL + PgBouncer + Redis + Worker
├── docker-compose.staging.yml  # Staging environment compose
├── package.json                # Root package (Convex + Better Auth deps)
└── CLAUDE.md                   # Project instructions and tech stack docs
```

## Directory Purposes

**`backend/cmd/server/`:**
- Purpose: Go API server entry point
- Contains: Single `main.go` that wires up chi router, middleware, Redis/PG connections, and all HTTP handlers
- Key files: `backend/cmd/server/main.go`

**`backend/cmd/worker/`:**
- Purpose: asynq background worker entry point
- Contains: Single `main.go` that registers all task handlers and starts the worker server
- Key files: `backend/cmd/worker/main.go`

**`backend/internal/scan/`:**
- Purpose: Core scan processing engine -- the most critical package in the backend
- Contains: Entry scan service, food scan service, Lua scripts, PG store, durability logic, session enforcement, startup recovery, real-time publishing
- Key files:
  - `service.go` - Entry scan processing pipeline
  - `food_service.go` - Food scan processing pipeline
  - `lua.go` - Redis Lua script for atomic entry check-in
  - `food_lua.go` - Redis Lua script for atomic food consumption tracking
  - `handler.go` - HTTP handler for entry scans
  - `food_handler.go` - HTTP handler for food scans
  - `durability.go` - Dual-write (asynq enqueue with fallback to direct)
  - `realtime.go` - Redis Pub/Sub counter updates
  - `recovery.go` - Startup drift recovery
  - `reseed.go` - Redis counter reseeding from PG
  - `event_sync.go` - Event dataset sync handler (Convex -> Redis)
  - `session_enforcement.go` - Session token validation logic
  - `types.go` - Request/response types
  - `food_types.go` - Food scan types
  - `pg.go` - PostgreSQL persistence layer
  - `worker.go` - asynq task constructors for PG write and Convex sync

**`backend/internal/handler/`:**
- Purpose: HTTP handlers for non-scan endpoints
- Contains: Health check, QR generation trigger, card compositing trigger, SMS trigger, session management, sync handlers
- Key files:
  - `health.go` - Health check endpoint
  - `qr.go` - QR generation trigger and progress
  - `cards.go` - Card compositing trigger and progress
  - `cards_worker.go` - Card compositing asynq task handler
  - `sms.go` - SMS send trigger and progress
  - `session.go` - Device session create/validate/revoke
  - `sync.go` - Event dataset and food rules sync handlers

**`backend/internal/sse/`:**
- Purpose: Server-Sent Events for live dashboard streaming
- Contains: SSE broker (client management), handler (snapshot + streaming), event types
- Key files: `broker.go`, `handler.go`, `types.go`

**`backend/internal/qr/`:**
- Purpose: QR code generation and HMAC-signed payload encoding/decoding
- Key files: `generator.go` (image generation), `payload.go` (encode/decode with HMAC verification)

**`backend/internal/card/`:**
- Purpose: Image compositing -- overlay QR code onto invitation card background
- Key files: `compositor.go`

**`backend/internal/sms/`:**
- Purpose: SMS delivery via SMS.NET.BD provider
- Key files: `provider.go` (interface), `smsnetbd.go` (implementation), `worker.go` (asynq task handler)

**`backend/internal/r2/`:**
- Purpose: Cloudflare R2 object storage client (S3-compatible)
- Key files: `client.go`

**`backend/internal/convexsync/`:**
- Purpose: HMAC-signed HTTP client for Go -> Convex sync
- Key files: `client.go`

**`backend/internal/middleware/`:**
- Purpose: HTTP middleware for chi router
- Key files: `cors.go`, `hmac.go` (HMAC signature verification), `logging.go`

**`backend/internal/config/`:**
- Purpose: Environment variable loader
- Key files: `config.go`

**`backend/internal/model/`:**
- Purpose: Shared domain types and sentinel errors
- Key files: `errors.go`, `session.go`

**`backend/migrations/`:**
- Purpose: PostgreSQL schema migrations (golang-migrate format)
- Contains: `000001_init.up.sql` (entry_scans + event_counters), `000002_scan_processing.up.sql`, `000003_food_scans.up.sql`

**`backend/queries/`:**
- Purpose: Raw SQL queries consumed by sqlc to generate Go code
- Key files: `scans.sql`, `food_scans.sql`

**`convex/model/`:**
- Purpose: Domain model helpers and business rules (pure functions, no Convex API calls)
- Contains: Event lifecycle validation, category defaults, guest validation, phone normalization, vendor rules
- Key files: `events.ts` (status transitions, config locking), `phone.ts` (BD phone normalization), `guests.ts`, `categories.ts`, `vendors.ts`

**`frontend/src/routes/`:**
- Purpose: TanStack Router file-based routes (auto-generates `routeTree.gen.ts`)
- Contains: All page-level route components

**`frontend/src/components/`:**
- Purpose: UI components organized by domain
- Contains: 8 domain directories + shared UI primitives

**`frontend/src/hooks/`:**
- Purpose: Custom React hooks for cross-cutting concerns
- Contains: Scanner flow, device sessions, SSE, offline sync, audio feedback, network status, card editor, UI utilities

**`frontend/src/lib/`:**
- Purpose: Non-React utility modules
- Contains: Auth client, Convex client, offline queue (IndexedDB), phone parsing, file parsing, animation, utilities

**`frontend/src/stores/`:**
- Purpose: Zustand state stores
- Contains: `scanner-store.ts` (offline scanner network/sync state)

**`frontend/e2e/`:**
- Purpose: Playwright end-to-end tests
- Contains: Test files and fixtures for E2E flows

## Route Map

All routes use TanStack Router file-based routing.

| Route Path | File | Component | Auth Required | Layout |
|---|---|---|---|---|
| `/` | `frontend/src/routes/index.tsx` | Redirects to `/events` | Yes | - |
| `/login` | `frontend/src/routes/login.tsx` | Login page (email/password) | No | Bare |
| `/sizing-guide` | `frontend/src/routes/sizing-guide.tsx` | Card sizing reference | Yes | AppShell |
| `/events` | `frontend/src/routes/events/index.tsx` | Event list with status filter tabs | Yes | AppShell |
| `/events/$eventId` | `frontend/src/routes/events/$eventId.tsx` | Event detail with tabs (Overview, Config, Categories, Vendors, Access, Guests, Sessions, Live) | Yes | AppShell |
| `/events/$eventId/guests` | `frontend/src/routes/events/$eventId/guests/index.tsx` | Guest list with search, filters, pagination | Yes | AppShell |
| `/events/$eventId/guests/import` | `frontend/src/routes/events/$eventId/guests/import.tsx` | Guest bulk import wizard (5-step) | Yes | AppShell |
| `/events/$eventId/cards` | `frontend/src/routes/events/$eventId/cards.tsx` | Card template editor + compositing + SMS dashboard | Yes | AppShell |
| `/$eventId/scanner` | `frontend/src/routes/$eventId/scanner.tsx` | Event-scoped scanner (camera + scan flow) | No (session token) | Bare |
| `/scanner` | `frontend/src/routes/scanner/index.tsx` | Scanner landing (directs to event-specific link) | No | Bare |
| `/scanner/$eventId` | `frontend/src/routes/scanner/$eventId.tsx` | Legacy route, redirects to `/$eventId/scanner` | No | Bare |

**Layout notes:**
- AppShell (`frontend/src/components/layout/app-shell.tsx`): Sidebar navigation + content area, requires authentication
- Bare: No sidebar, no auth requirement -- used for login page and scanner pages
- Root layout (`frontend/src/routes/__root.tsx`) handles auth guard and layout switching

## Component Directories

**`frontend/src/components/events/`:**
- `create-event-dialog.tsx` - Modal for creating new events
- `event-card.tsx` - Event card in list view
- `event-config-form.tsx` - QR strategy, food mode, timing config
- `overview-tab.tsx` - Event detail overview (lifecycle stepper, metadata)
- `lifecycle-stepper.tsx` - Visual status progression
- `categories-tab.tsx` - Guest category management
- `vendors-tab.tsx` - Vendor types, categories, stalls
- `event-access-tab.tsx` - User permission management
- `food-rules-matrix.tsx` - Guest category x food category limit matrix
- `export-event-button.tsx` - Event data export

**`frontend/src/components/guests/`:**
- `guest-table.tsx` - Paginated guest list with actions
- `guest-filters.tsx` - Category, status, search filters
- `add-guest-dialog.tsx` - Manual guest addition
- `import-wizard/` - 5-step bulk import wizard:
  - `wizard-shell.tsx` - Wizard stepper container
  - `step-upload.tsx` - File upload (CSV/XLSX)
  - `step-map-columns.tsx` - Column mapping
  - `step-validate.tsx` - Data validation
  - `step-duplicates.tsx` - Duplicate detection
  - `step-confirm.tsx` - Import confirmation
  - `use-import-store.ts` - Zustand store for wizard state

**`frontend/src/components/scanner/`:**
- `scanner-app.tsx` - Main scanner container (setup -> active scanning flow)
- `scanner-setup.tsx` - Station selection (event, vendor type, category, stall)
- `cascading-select.tsx` - Cascading dropdown for setup
- `camera-viewfinder.tsx` - QR camera scanning view
- `scan-result-card.tsx` - Scan result display (allowed/denied/duplicate)
- `scan-flash-overlay.tsx` - Visual flash feedback after scan
- `scan-next-card.tsx` - "Scan Next" prompt
- `queued-scan-result-card.tsx` - Result card for offline-queued scans
- `queued-scan-flash.tsx` - Flash overlay for queued scans
- `offline-banner.tsx` - "You are offline" banner
- `connection-restored-banner.tsx` - Reconnection notification
- `pending-badge.tsx` - Pending sync count badge
- `pending-queue-panel.tsx` - Pending scan queue list
- `pending-queue-item.tsx` - Individual pending scan item
- `session-status.tsx` - Session info display
- `session-revoked.tsx` - Session revoked state
- `retroactive-rejection-toast.tsx` - Toast for post-sync rejections

**`frontend/src/components/dashboard/`:**
- `live-dashboard.tsx` - Main dashboard container with SSE connection
- `metric-card.tsx` - Individual metric display card
- `connection-status.tsx` - SSE connection status indicator
- `food-category-row.tsx` - Food consumption per category
- `stall-activity-row.tsx` - Stall scan activity
- `alert-feed-item.tsx` - Alert feed item

**`frontend/src/components/cards/`:**
- `card-editor.tsx` - Fabric.js card template designer
- `template-sidebar.tsx` - Template list and management
- `compositing-status.tsx` - Card compositing progress
- `sms-dashboard.tsx` - SMS send trigger and delivery status
- `sms-status-badge.tsx` - Per-SMS status badge

**`frontend/src/components/sessions/`:**
- `active-sessions-tab.tsx` - Active device session list with revoke

**`frontend/src/components/layout/`:**
- `app-shell.tsx` - SidebarProvider + main content layout
- `sidebar.tsx` - Navigation sidebar

**`frontend/src/components/ui/`:**
- Shadcn/ui primitives (alert-dialog, badge, button, card, dialog, dropdown-menu, input, pagination, progress, scroll-area, select, separator, sheet, sidebar, skeleton, table, tabs, toggle, toggle-group, tooltip)

## Hook Inventory

| Hook | File | Purpose |
|---|---|---|
| `useScannerStore` | `frontend/src/hooks/use-scanner.ts` | Scanner state machine (idle -> scanned -> reviewing -> confirming -> flash -> ready) |
| `useDeviceSession` | `frontend/src/hooks/use-device-session.ts` | Session token lifecycle (localStorage + Go API validation) |
| `useSSE` | `frontend/src/hooks/use-sse.ts` | SSE connection management with typed event handlers |
| `useOfflineSync` | `frontend/src/hooks/use-offline-sync.ts` | Automatic offline scan sync on network restore |
| `useNetworkStatus` | `frontend/src/hooks/use-network-status.ts` | Online/offline detection |
| `useAudioFeedback` | `frontend/src/hooks/use-audio-feedback.ts` | Scan result audio cues |
| `useCardEditor` | `frontend/src/hooks/use-card-editor.ts` | Fabric.js canvas state management |
| `useAnimatedCounter` | `frontend/src/hooks/use-animated-counter.ts` | Animated number transitions for dashboard |
| `useMobile` | `frontend/src/hooks/use-mobile.ts` | Mobile viewport detection |

## Naming Conventions

**Files:**
- React components: `kebab-case.tsx` (e.g., `scan-result-card.tsx`, `live-dashboard.tsx`)
- Hooks: `use-kebab-case.ts` (e.g., `use-scanner.ts`, `use-sse.ts`)
- Zustand stores: `kebab-case.ts` in `/stores/` or `use-store-name.ts` co-located with related code
- Convex functions: `camelCase.ts` (e.g., `adminGateway.ts`, `foodRules.ts`)
- Go files: `snake_case.go` (e.g., `food_service.go`, `session_enforcement.go`)
- Go test files: `*_test.go` co-located with source
- Migration files: `000NNN_description.up.sql` / `000NNN_description.down.sql`

**Directories:**
- Frontend: `kebab-case` (e.g., `import-wizard`, `scanner`)
- Go: `lowercase` single-word (e.g., `scan`, `handler`, `middleware`)
- Convex model: `model/` subdirectory for pure domain logic

## Key File Locations

**Entry Points:**
- `frontend/src/main.tsx`: Frontend app bootstrap
- `backend/cmd/server/main.go`: Go API server
- `backend/cmd/worker/main.go`: Go background worker

**Configuration:**
- `backend/internal/config/config.go`: Go environment config
- `convex/auth.config.ts`: Better Auth configuration
- `convex/convex.config.ts`: Convex project components
- `frontend/vite.config.ts`: Vite build configuration
- `docker-compose.yml`: Local dev infrastructure

**Schema/Models:**
- `convex/schema.ts`: Convex database schema (source of truth for CRUD data)
- `backend/migrations/`: PostgreSQL schema (source of truth for scan audit data)
- `backend/internal/db/models.go`: sqlc-generated Go types from PG schema
- `convex/model/`: Domain business rules and validation

**Core Logic:**
- `backend/internal/scan/service.go`: Entry scan processing
- `backend/internal/scan/food_service.go`: Food scan processing
- `backend/internal/scan/lua.go`: Atomic check-in Lua script
- `backend/internal/scan/durability.go`: Dual-write persistence
- `convex/sync.ts`: Convex -> Go data synchronization
- `convex/internalGateway.ts`: Go -> Convex bridge mutations

**Testing:**
- `frontend/e2e/`: Playwright E2E tests
- `frontend/src/**/*.test.ts(x)`: Vitest unit tests (co-located)
- `backend/**/*_test.go`: Go unit/integration tests (co-located)
- `backend/tests/hardening/`: Go integration test suite
- `backend/tests/load/`: k6 load test scripts

## Where to Add New Code

**New Convex function (query/mutation/action):**
- If it's a new domain: Create `convex/{domainName}.ts`
- If it extends existing domain: Add to the appropriate existing file (e.g., `convex/guests.ts`)
- If it needs model validation: Add pure helper to `convex/model/{domain}.ts`
- If it's an admin-to-Go proxy: Add to `convex/adminGateway.ts`
- If it's a Go-to-Convex callback: Add route in `convex/http.ts`, handler in `convex/internalGateway.ts`

**New Go API endpoint:**
- Handler: `backend/internal/handler/{feature}.go`
- Route registration: `backend/cmd/server/main.go` (add to chi router)
- If HMAC-protected: Wrap route group with `middleware.HMACAuth(cfg.HMACSecret)`
- If it needs PG queries: Add SQL to `backend/queries/`, run `sqlc generate`

**New Go background job:**
- Task type constant: `backend/internal/worker/tasks.go` or domain-specific file
- Task handler: `backend/internal/{domain}/worker.go` or `backend/internal/worker/{feature}_handler.go`
- Register in: `backend/cmd/worker/main.go` (add `mux.HandleFunc`)

**New frontend route:**
- Create file in `frontend/src/routes/` matching desired URL path
- TanStack Router auto-generates route tree on dev server restart
- Pattern: `createFileRoute("/path")({ component: PageComponent })`

**New frontend component:**
- Domain component: `frontend/src/components/{domain}/{component-name}.tsx`
- Shared UI primitive: `frontend/src/components/ui/{component-name}.tsx` (use shadcn CLI)
- Layout component: `frontend/src/components/layout/{component-name}.tsx`

**New custom hook:**
- Location: `frontend/src/hooks/use-{feature-name}.ts`
- Test: `frontend/src/hooks/use-{feature-name}.test.ts` (co-located)

**New utility function:**
- Location: `frontend/src/lib/{module-name}.ts`
- Test: `frontend/src/lib/{module-name}.test.ts` (co-located)

**New Zustand store:**
- Location: `frontend/src/stores/{store-name}.ts`
- Or co-located with feature: `frontend/src/components/{domain}/use-{store-name}.ts`

**New PostgreSQL migration:**
- Location: `backend/migrations/000{N+1}_{description}.up.sql` and `.down.sql`
- Run: `migrate -path migrations -database $DATABASE_URL up`

## Special Directories

**`convex/_generated/`:**
- Purpose: Auto-generated Convex types, API references, and server utilities
- Generated: Yes (by `npx convex dev`)
- Committed: Yes
- DO NOT edit manually

**`frontend/src/routeTree.gen.ts`:**
- Purpose: Auto-generated TanStack Router route tree
- Generated: Yes (by TanStack Router plugin in Vite)
- Committed: Yes
- DO NOT edit manually

**`frontend/convex/_generated/`:**
- Purpose: Symlinked Convex generated types for frontend import resolution
- Generated: Yes
- Committed: Yes

**`backend/internal/db/`:**
- Purpose: sqlc-generated Go code from SQL queries
- Generated: Yes (by `sqlc generate`)
- Committed: Yes
- Key files: `models.go` (types), `scans.sql.go` (query functions), `food_scans.sql.go`, `querier.go` (interface)

**`.planning/`:**
- Purpose: GSD workflow planning artifacts
- Generated: By GSD workflow commands
- Committed: Yes
- Contains: Codebase analysis docs, phase plans, research

**`frontend/e2e/.auth/`:**
- Purpose: Playwright auth state storage
- Generated: Yes (by Playwright auth setup)
- Committed: No (should be gitignored)

---

*Structure analysis: 2026-04-12*
