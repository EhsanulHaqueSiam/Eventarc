# Coding Conventions

**Analysis Date:** 2026-04-12

## Naming Patterns

**Files (Frontend):**
- Components: `kebab-case.tsx` (e.g., `event-card.tsx`, `scan-flash-overlay.tsx`, `scanner-setup.tsx`)
- Hooks: `use-kebab-case.ts` (e.g., `use-sse.ts`, `use-device-session.ts`, `use-scanner.ts`)
- Tests: co-located with source, same name + `.test.ts` or `.test.tsx` suffix
- Stores: `kebab-case-store.ts` (e.g., `scanner-store.ts`)
- Lib/utils: `kebab-case.ts` (e.g., `offline-queue.ts`, `parse-file.ts`, `auth-client.ts`)
- Routes: match TanStack Router file-based routing (`$eventId.tsx`, `index.tsx`, `login.tsx`)

**Files (Convex):**
- Module files: `camelCase.ts` (e.g., `events.ts`, `foodRules.ts`, `cardTemplates.ts`, `vendorCategories.ts`)
- Model helpers: `convex/model/kebab-case.ts` (e.g., `events.ts`, `categories.ts`, `guests.ts`, `phone.ts`)
- Schema: `convex/schema.ts` (single file)

**Files (Go Backend):**
- Source: `snake_case.go` (e.g., `food_handler.go`, `food_service.go`, `event_sync.go`)
- Tests: `snake_case_test.go` co-located with source
- SQL generated: `snake_case.sql.go` (e.g., `food_scans.sql.go`, `scans.sql.go`)

**Functions/Variables (TypeScript):**
- Functions: `camelCase` (e.g., `handleSubmit`, `parseEntryResponse`, `seedTestGuest`)
- React components: `PascalCase` (e.g., `EventCard`, `MetricCard`, `ScannerSetup`)
- Hooks: `useCamelCase` (e.g., `useSSE`, `useDeviceSession`, `useAnimatedCounter`)
- Constants: `UPPER_SNAKE_CASE` for module-level (e.g., `MOBILE_BREAKPOINT`, `DB_NAME`, `SESSION_KEY`)
- Type exports: `PascalCase` (e.g., `ScanState`, `SessionInfo`, `SSEConnectionStatus`)
- Interfaces: `PascalCase` with descriptive suffix (e.g., `EventCardProps`, `UseSSEOptions`, `SyncProgress`)
- Zustand stores: `useCamelCaseStore` (e.g., `useOfflineScannerStore`, `useScannerStore`)

**Functions/Variables (Go):**
- Functions: `PascalCase` for exported, `camelCase` for unexported (standard Go)
- Struct names: `PascalCase` (e.g., `Service`, `SessionHandler`, `ErrorResponse`)
- Method receivers: single letter or short abbreviation (e.g., `(s *Service)`, `(h *SessionHandler)`)
- Constants: `PascalCase` for exported (e.g., `PayloadVersion`, `QRTypeEntry`)

**Convex Tables:**
- Table names: `camelCase` plural (e.g., `events`, `guests`, `foodRules`, `appUsers`, `deviceSessions`)
- Field names: `camelCase` (e.g., `eventDate`, `guestCount`, `qrGenerationStatus`, `tokenIdentifier`)
- Index names: `by_field` or `by_field1_and_field2` (e.g., `by_event`, `by_event_status`, `by_event_and_user`)

## Code Style

**Formatting:**
- No Prettier configured (no `.prettierrc` file detected)
- ESLint handles code quality via `eslint.config.js`
- Frontend uses double quotes for JSX strings, single quotes occasionally in imports
- Semicolons are used consistently in TypeScript
- 2-space indentation in TypeScript/TSX files

**Linting (Frontend):**
- ESLint 9 with flat config at `frontend/eslint.config.js`
- Plugins: `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `typescript-eslint`
- Extends: `js.configs.recommended`, `tseslint.configs.recommended`, `reactHooks.configs.flat.recommended`
- Target: `ecmaVersion: 2020`, browser globals

**TypeScript Config:**
- Target: `es2023`
- Module: `esnext` with `bundler` module resolution
- `verbatimModuleSyntax: true` -- use `import type` for type-only imports
- `noUnusedLocals: true` and `noUnusedParameters: true`
- `erasableSyntaxOnly: true`
- `noFallthroughCasesInSwitch: true`
- NO strict mode flags (`strict` is not enabled)

**Go:**
- Standard `go fmt` formatting
- `log/slog` for structured logging (stdlib, no external logger)
- chi middleware patterns for HTTP handler composition

## Import Organization

**Order (Frontend components -- observed pattern):**
1. Framework imports (`react`, `@tanstack/react-router`)
2. Convex imports (`convex/react`, `convex/_generated/api`, `convex/_generated/dataModel`)
3. UI component imports (`@/components/ui/*`)
4. Feature component imports (`@/components/events/*`, `@/components/dashboard/*`)
5. Library imports (`@/lib/*`)
6. Icon imports (`lucide-react`)
7. Third-party utilities (`sonner`, `motion/react`)

**Path Aliases:**
- `@/*` maps to `frontend/src/*` (configured in `tsconfig.json` and `vite.config.ts`)
- `convex/_generated` maps to `../convex/_generated` (Vite alias in `vite.config.ts`)

**Go Imports:**
- Standard library first, blank line, then third-party, blank line, then internal packages
- Internal packages use full module path: `github.com/ehsanul-haque-siam/eventarc/internal/*`

## Component Patterns

**React Component Structure:**
- Use function declarations for components (not arrow functions): `export function EventCard(...) { ... }`
- Props defined as interfaces above the component: `interface EventCardProps { ... }`
- Components are named exports (not default exports)
- Hooks extracted to `src/hooks/` when reusable
- Co-located tests in same directory

**Props Pattern:**
```tsx
interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  progress?: number;
  className?: string;
}

export function MetricCard({ label, value, subtitle, progress, className }: MetricCardProps) {
  // ...
}
```

**State Management:**
- Zustand stores in `src/stores/` for cross-component UI state (scanner offline state)
- Zustand stores in hooks for feature-scoped state (scanner workflow in `use-scanner.ts`)
- Convex `useQuery`/`useMutation` for server state
- Local `useState` for component-scoped UI state
- `useRef` for stable callback refs (avoids re-creating EventSource on callback changes)

**Data Fetching:**
- Convex `useQuery(api.module.queryName, args)` for reactive data
- Convex `useMutation(api.module.mutationName)` for mutations
- Direct `fetch()` calls to Go API for scan hot path and session management
- No TanStack Query usage yet despite being a declared dependency

## Convex Patterns

**Query/Mutation Structure:**
```typescript
export const create = mutation({
  args: {
    name: v.string(),
    eventDate: v.number(),
    config: eventConfigValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ensureAdminAccess(ctx);
    // Validation
    // Business logic
    // Return ID
  },
});
```

**Authorization:**
- Auth helpers in `convex/authz.ts`
- `ensureAdminAccess(ctx)` -- throws if not admin
- `ensureEventReadAccess(ctx, eventId)` -- throws if no read permission
- `ensureEventEditAccess(ctx, eventId)` -- throws if no edit permission
- Called at the start of every mutation/query handler

**Validators:**
- Reusable validators defined as module-level constants (e.g., `eventConfigValidator`, `statusValidator`)
- Use `v.union(v.literal(...))` for enums
- Use `v.optional(...)` for nullable fields
- IDs validated with `v.id("tableName")`

**Model Helpers:**
- Business logic extracted to `convex/model/*.ts` (e.g., state machine in `model/events.ts`)
- Validation helpers in model files (e.g., `validateCategoryName` in `model/categories.ts`)
- Pure functions that take `MutationCtx` as parameter

**Error Handling (Convex):**
- Throw `new Error("message")` for validation/auth failures
- Convex surfaces these as client-side errors

## Go Backend Patterns

**Handler Pattern:**
```go
type SessionHandler struct {
    redis *redis.Client
}

func NewSessionHandler(rc *redis.Client) *SessionHandler {
    return &SessionHandler{redis: rc}
}

func (h *SessionHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
    // Decode JSON body
    // Validate required fields
    // Business logic
    // Write JSON response
}
```

**Service Pattern:**
```go
type Service struct {
    redis      *redis.Client
    pgPool     *pgxpool.Pool
    hmacSecret []byte
}

func NewService(redisClient *redis.Client, pgPool *pgxpool.Pool, hmacSecret []byte) *Service {
    return &Service{...}
}
```

**Error Handling (Go):**
- Sentinel errors in `internal/model/errors.go` (e.g., `ErrNotFound`, `ErrDuplicate`, `ErrUnauthorized`)
- Standard JSON error envelope: `{ "error": { "code": "...", "message": "..." } }`
- HTTP handlers use `writeErrorJSON(w, statusCode, code, message)` helper
- `errors.Is()` for sentinel error comparison

## Styling Approach

**CSS Framework:**
- TailwindCSS 4.2 via `@tailwindcss/vite` plugin
- shadcn/ui (base-nova style) with `@base-ui/react` primitives
- `class-variance-authority` (CVA) for component variants
- `clsx` + `tailwind-merge` via `cn()` helper in `src/lib/utils.ts`

**Design Tokens (defined in `src/app.css`):**
- Fonts: `--font-sans` (Inter Variable), `--font-display` (Cal Sans), `--font-mono` (Roboto Mono)
- Shadows: `--shadow-card`, `--shadow-card-hover`, `--shadow-soft`
- Custom colors: `--color-success` (oklch green), `--color-warning` (oklch amber)
- All standard shadcn color tokens (oklch-based grayscale palette): `--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`
- Dark mode via `.dark` class with `@custom-variant dark (&:is(.dark *))`
- Radius system: `--radius` base with computed `--radius-sm` through `--radius-4xl`

**Typography Guidelines:**
- Headings/branding: `font-display` (Cal Sans) with `font-semibold tracking-tight`
- Body text: `font-sans` (Inter Variable)
- Data/metrics: `font-mono` for numbers, timestamps, technical data
- Metric values: `font-display text-[28px] font-semibold leading-[1.1]`
- Small labels: `text-xs text-muted-foreground`

**Icon Usage:**
- Lucide React icons (`lucide-react` package)
- Standard sizing: `size-4` for inline, `size-3.5` for small contexts
- Always paired with text via flex layout: `<span className="flex items-center gap-1.5">`

## Animation System

**Motion Library (`motion/react`):**
- Animation presets defined in `src/lib/motion.tsx`
- Easing curves: `easeOutQuart [0.25, 1, 0.5, 1]`, `easeOutExpo [0.16, 1, 0.3, 1]`
- Named variants: `fadeIn`, `fadeSlideUp`, `fadeSlideDown`, `scaleIn`, `staggerContainer`, `staggerItem`
- Wrapper components: `PageTransition`, `StaggerList`, `StaggerItem`, `PresenceGroup`
- All wrappers respect `prefers-reduced-motion` via `useReducedMotion()`

**CSS Keyframe Animations (in `src/app.css`):**
- `tab-fade-in`: opacity + translateY for tab content switching
- `tooltip-in`: opacity + scale for tooltip appearance
- `dropdown-in`: opacity + scale + translateY for dropdowns
- `fade-slide-in`: opacity + translateY for alerts
- `skeleton-pulse`: opacity pulse for loading skeletons
- `flash-burst`: scale + opacity for scanner flash overlay
- `flash-text`: scale + opacity for scanner result text
- Global `data-slot` attribute selectors for hover/active transitions
- `prefers-reduced-motion: reduce` media query disables all animations

## Error Handling Patterns

**Frontend (User-Facing):**
- `sonner` toast notifications for success/error feedback
- `toast.success("message")` and `toast.error("message")`
- Try/catch in async handlers with generic error messages to users
- Empty `catch` blocks with no re-throw (errors logged to console)

**Frontend (Network Errors):**
- Offline queue (`src/lib/offline-queue.ts`) for scan failures -- queues to IndexedDB
- Network status tracking via `useNetworkStatus` hook
- Graceful degradation: scans queued when offline, synced when online

**Convex (Server):**
- `throw new Error("message")` for validation failures
- Auth errors: "Authentication required", "Admin access required"
- Business rule errors: "Event name must be between 1 and 200 characters"
- State machine errors: "Invalid transition: draft -> live"

**Go (API):**
- Sentinel errors in `internal/model/errors.go`
- Structured JSON error responses: `{ "error": { "code": "CODE", "message": "..." } }`
- HTTP status codes mapped to error types (400, 401, 403, 404, 409, 422, 500)

## Logging

**Frontend:** `console.log`, `console.warn`, `console.error` (no structured logging library)
- `console.warn` for non-critical issues (SSE parse failures)
- `console.error` for failures (scan confirm, session create)

**Go Backend:** `log/slog` (stdlib structured logging)
- Request logging middleware: method, path, status, duration_ms, request_id
- Event-level logging: `[AUTO GO-LIVE]`, `[SCAN]` prefixes for log grep

**Convex:** `console.log` for server-side debugging (Convex dashboard captures these)

## Comments

**When to Comment:**
- JSDoc on exported hook/utility functions with `/** ... */`
- Inline comments for non-obvious business logic (e.g., `// Idempotent: only transition if...`)
- Reference IDs for design decisions (e.g., `// D-07`, `// D-08`, `// D-09`, `// D-11`)
- Phase references in schema comments (e.g., `// Phase 3`, `// Phase 8`)

**Go Comments:**
- Godoc style on exported types/functions
- Status code documentation on HTTP handlers
- Step-by-step pipeline comments on complex functions

## Module Design

**Exports:**
- Named exports only (no default exports in frontend)
- Barrel files: NOT used -- import directly from source files
- UI components export component + variants (e.g., `export { Button, buttonVariants }`)

**Convex Module Organization:**
- One file per domain: `events.ts`, `guests.ts`, `stalls.ts`, `foodRules.ts`
- All queries/mutations exported as named exports from module file
- Internal mutations use `internalMutation` (not accessible from client)
- Model helpers in `convex/model/` directory

---

*Convention analysis: 2026-04-12*
