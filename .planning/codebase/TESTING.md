# Testing Patterns

**Analysis Date:** 2026-04-12

## Test Framework

**Frontend Unit/Integration:**
- Vitest 4.1
- Config: `frontend/vitest.config.ts`
- Environment: `jsdom`
- Globals: `true` (no need to import `describe`/`it`/`expect` -- though most files do import explicitly from `vitest`)
- Path aliases: `@/` and `convex/_generated` resolved via Vite aliases

**Frontend E2E:**
- Playwright 1.59
- Config: `frontend/playwright.config.ts`
- Test directory: `frontend/e2e/`
- Base URL: `http://localhost:5173`
- Projects: `chromium` (desktop), `mobile` (Pixel 7, matches `*.mobile.spec.ts`)
- Retries: 0 locally, 2 in CI
- Reporter: HTML (open: never) + list
- Timeout: 30 seconds per test
- WebServer: auto-starts `pnpm dev` if not running

**Go Backend:**
- Go stdlib `testing` package
- No external test framework (no testify)
- `miniredis` for Redis mocking
- `testcontainers-go` for integration tests (PostgreSQL + Redis containers)
- Build tag `//go:build integration` for integration/hardening tests

**Load Testing:**
- k6 JavaScript test scripts in `backend/tests/load/`
- Custom metrics: `scan_success`, `scan_duplicate`, `scan_error`, `scan_duration`
- Scenarios: ramp to 10K VUs, duplicate flood (100 VUs), configuration matrix

**Assertion Libraries:**
- Frontend: Vitest built-in `expect()` + `@testing-library/jest-dom` (available but not heavily used)
- Go: stdlib `t.Errorf()`, `t.Fatalf()`, `errors.Is()` -- no testify

**Run Commands:**
```bash
# Frontend unit tests
cd frontend && pnpm vitest              # Watch mode
cd frontend && pnpm vitest run          # Single run

# Frontend E2E tests
cd frontend && pnpm test:e2e            # Run all E2E
cd frontend && pnpm test:e2e:ui         # Playwright UI mode
cd frontend && pnpm test:e2e:headed     # Headed browser

# Go backend tests
cd backend && go test ./...             # Unit tests
cd backend && go test -tags=integration ./tests/hardening/...  # Integration tests

# Load tests (k6)
cd backend/tests/load && bash run.sh    # Basic load test
cd backend/tests/load && bash run_matrix.sh  # Config matrix load test
```

## Test File Organization

**Frontend Unit Tests (Co-located):**
```
frontend/src/
├── hooks/
│   ├── use-sse.ts
│   ├── use-sse.test.ts              # Co-located test
│   ├── use-scanner.ts
│   ├── use-scanner.test.ts          # Co-located test
│   ├── use-device-session.ts
│   ├── use-device-session.test.ts
│   ├── use-audio-feedback.ts
│   ├── use-audio-feedback.test.ts
│   ├── use-network-status.ts
│   ├── use-network-status.test.ts
│   ├── use-offline-sync.ts
│   └── use-offline-sync.test.ts
├── lib/
│   ├── offline-queue.ts
│   └── offline-queue.test.ts        # Co-located test
└── components/
    ├── scanner/
    │   ├── scanner-setup.tsx
    │   └── scanner-setup.test.tsx    # Co-located test
    └── sessions/
        ├── active-sessions-tab.tsx
        └── active-sessions-tab.test.tsx
```

**Frontend E2E Tests (Separate directory):**
```
frontend/e2e/
├── fixtures/
│   ├── auth.ts                      # Auth fixture (login flow)
│   └── helpers.ts                   # Navigation/interaction helpers
├── api-health.spec.ts               # Go API health checks
├── auth.spec.ts                     # Authentication flows (no login)
├── events.spec.ts                   # Event CRUD (uses auth fixture)
├── scanner.spec.ts                  # Scanner routing/UI
├── scanner.mobile.spec.ts           # Mobile viewport scanner tests
└── scb-familyday.spec.ts            # Full event setup scenario (serial)
```

**Go Backend Tests (Co-located):**
```
backend/internal/
├── scan/
│   ├── service.go
│   ├── service_test.go              # Unit tests
│   ├── handler.go
│   ├── handler_test.go
│   ├── concurrent_test.go           # Concurrency stress tests
│   ├── security_test.go             # Security/HMAC tests
│   ├── food_service_test.go
│   ├── food_handler_test.go
│   ├── food_reconcile_test.go
│   ├── food_sync_test.go
│   ├── pg_test.go
│   ├── reconciliation_test.go
│   └── reseed_test.go
├── handler/
│   ├── health_test.go
│   ├── session_test.go
│   ├── qr_test.go
│   ├── cards_test.go
│   └── sms_test.go
├── middleware/
│   └── hmac_test.go
├── qr/
│   ├── generator_test.go
│   └── payload_test.go
├── r2/
│   └── client_test.go
├── sms/
│   ├── smsnetbd_test.go
│   └── worker_test.go
├── sse/
│   ├── broker_test.go
│   └── handler_test.go
└── worker/
    └── qr_handler_test.go
```

**Go Integration/Hardening Tests (Separate directory):**
```
backend/tests/
├── hardening/
│   ├── doc.go                       # Package doc
│   ├── helpers_test.go              # Test infrastructure (containers)
│   ├── config_matrix_test.go        # All 6 event config combos
│   ├── image_generation_test.go     # QR/card image tests
│   └── sms_batch_test.go            # SMS batch delivery tests
└── load/
    ├── scan_load_test.js            # k6 main load test
    ├── config_matrix.js             # k6 config matrix definitions
    ├── run.sh                       # Load test runner script
    ├── run_matrix.sh                # Matrix load test runner
    ├── scenarios/
    │   ├── entry_scan.js            # Entry scan scenario
    │   ├── food_scan.js             # Food scan scenario
    │   ├── dashboard_sse.js         # SSE dashboard scenario
    │   └── mixed_load.js            # Mixed workload scenario
    └── cmd/
        ├── seed/main.go             # Test data seeder
        └── seed_matrix/main.go      # Matrix test data seeder
```

## Test Structure

**Frontend Hook Test Pattern (Vitest + React Testing Library):**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDeviceSession } from "./use-device-session";

// Mock external dependencies at module level
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useDeviceSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null token when localStorage is empty", async () => {
    const { result } = renderHook(() => useDeviceSession());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.token).toBeNull();
  });
});
```

**Frontend Component Test Pattern (Vitest + React Testing Library):**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock Convex before importing component
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => vi.fn()),
}));

vi.mock("convex/_generated/api", () => ({
  api: {
    events: { list: "events.list" },
    // ... mock API shape
  },
}));

import { useQuery } from "convex/react";
import { ScannerSetup } from "./scanner-setup";

const mockUseQuery = vi.mocked(useQuery);

describe("ScannerSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockImplementation((queryFn, args) => {
      // Return mock data based on query
    });
  });

  it('renders heading "Select Your Station"', () => {
    render(<ScannerSetup onSessionCreated={vi.fn()} createSession={vi.fn()} />);
    expect(screen.getByText("Select Your Station")).toBeDefined();
  });
});
```

**Frontend Zustand Store Test Pattern:**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useScannerStore } from "./use-scanner";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useScannerStore", () => {
  beforeEach(() => {
    act(() => {
      useScannerStore.getState().reset();
    });
    vi.clearAllMocks();
  });

  it("initial state is 'idle'", () => {
    expect(useScannerStore.getState().state).toBe("idle");
  });

  it("state transitions work correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "valid", guest: { name: "Test" } }),
    });

    act(() => { useScannerStore.getState().onQrDetected("payload"); });
    await act(async () => {
      await useScannerStore.getState().onConfirm("token", "event", "stall", "entry", "cat");
    });
    expect(useScannerStore.getState().state).toBe("flash");
  });
});
```

**Go Unit Test Pattern:**
```go
func TestProcessEntryScan_ValidScan(t *testing.T) {
    svc, _ := newTestService(t)
    guestID := "guest_valid_001"
    seedTestGuest(t, svc.redis, testEventID, guestID, "Alice Test", "vip")

    payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeEntry)
    result, err := svc.ProcessEntryScan(context.Background(), ScanRequest{
        QRPayload: payload,
        StallID:   "stall_A",
        DeviceID:  "device_01",
    })
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if result.Status != "valid" {
        t.Errorf("expected status 'valid', got %q", result.Status)
    }
}
```

**Go Concurrency Test Pattern:**
```go
func TestConcurrentEntryScan_NoDuplicates(t *testing.T) {
    // Setup
    mr := miniredis.RunT(t)
    rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
    svc := NewService(rdb, nil, testSecret)

    const numGuests = 500

    // Seed data + prepare payloads
    // ...

    // Launch goroutines with barrier for simultaneous start
    var wg sync.WaitGroup
    barrier := make(chan struct{})
    for i := 0; i < numGuests; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            <-barrier // Wait for all goroutines
            // Execute scan
        }(i)
    }
    close(barrier) // Release all at once
    wg.Wait()

    // Verify atomic state
}
```

## Mocking

**Frontend Mocking (Vitest):**

**Convex Mocking:**
```typescript
// Mock convex/react at module level (MUST be before component import)
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => vi.fn()),
}));

vi.mock("convex/_generated/api", () => ({
  api: {
    events: { list: "events.list" },
    // Map query names to strings for pattern matching
  },
}));
```

**Fetch Mocking:**
```typescript
const mockFetch = vi.fn();
global.fetch = mockFetch;

mockFetch.mockResolvedValueOnce({
  ok: true,
  json: async () => ({ status: "valid", guest: { name: "Test" } }),
});
```

**Browser API Mocking:**
- `EventSource` mocked with custom class (`MockEventSource`) for SSE tests
- `localStorage` mocked with in-memory store for session tests
- `AudioContext` mocked with mock oscillator/gain nodes for audio feedback tests
- `crypto.randomUUID` stubbed via `vi.stubGlobal()` for offline queue tests
- `navigator.onLine` defined via `Object.defineProperty` for network status tests
- `window.addEventListener/removeEventListener` spied for event listener tests

**IndexedDB Mocking:**
- `fake-indexeddb` package (`import "fake-indexeddb/auto"`) for offline queue tests
- Database deleted between tests: `indexedDB.deleteDatabase("eventarc-offline")`
- Singleton reset via `_resetDBInstance()` exported from offline-queue module

**Go Mocking:**
- `miniredis` in-process Redis mock for unit tests (no real Redis needed)
- `httptest.NewRequest` + `httptest.NewRecorder` for HTTP handler tests
- `testcontainers-go` for integration tests (real PostgreSQL + Redis in Docker)
- No mock framework -- test helpers create real service instances with in-memory dependencies

**What to Mock:**
- External services: Convex client, fetch API, browser APIs (EventSource, AudioContext, localStorage)
- Environment: `import.meta.env` vars via `vi.stubEnv()`

**What NOT to Mock:**
- Zustand stores (test via `getState()` directly)
- Business logic functions (test them directly)
- IndexedDB (use `fake-indexeddb` real implementation)
- Redis in Go (use `miniredis` real implementation)

## Fixtures and Factories

**E2E Auth Fixture (`frontend/e2e/fixtures/auth.ts`):**
```typescript
export const test = base.extend({
  page: async ({ page }, use) => {
    await ensureUserExists();           // POST signup (idempotent)
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(TEST_USER.email);
    await page.getByPlaceholder("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/events", { timeout: 15_000 });
    await use(page);
  },
});
```

**E2E Helper Functions (`frontend/e2e/fixtures/helpers.ts`):**
- `navigateToEvent(page, eventUrl, eventName)` -- navigate to event detail
- `addCategory(page, name)` -- add guest category
- `addVendorCategory(page, type, name)` -- add entry/food vendor category
- `addStall(page, stallName)` -- add stall
- `addCategoryWithStalls(page, type, categoryName, stallNames)` -- composite helper
- `openManageStalls(page, categoryName)` -- open stall management sheet

**Go Test Helpers (co-located in test files):**
```go
func seedTestGuest(t *testing.T, rdb *redis.Client, eventID, guestID, name, category string) {
    t.Helper()
    // Seed Redis hash
}

func makeValidPayload(t *testing.T, eventID, guestID string, qrType byte) string {
    t.Helper()
    // Create HMAC-signed QR payload
}

func newTestService(t *testing.T) (*Service, *miniredis.Miniredis) {
    t.Helper()
    mr := miniredis.RunT(t)
    rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
    svc := NewService(rdb, nil, testSecret)
    return svc, mr
}
```

**Go Integration Test Infrastructure (`backend/tests/hardening/helpers_test.go`):**
- `SetupTestInfra(t)` -- spins up PostgreSQL + Redis containers via testcontainers
- `infra.SeedEvent(t, cfg)` -- seeds event with specific config
- `infra.SeedGuests(t, eventID, cfg, count)` -- seeds N guests with QR payloads
- `infra.SeedFoodRules(t, eventID)` -- seeds food rule matrix
- `infra.SeedVendorHierarchy(t, eventID)` -- seeds vendor types/categories/stalls
- `infra.InitializeCounters(t, eventID)` -- initializes Redis counters
- `infra.Teardown(t)` -- cleanup containers

## Coverage

**Requirements:** No coverage thresholds enforced. No coverage reporting configured.

**View Coverage (if needed):**
```bash
cd frontend && pnpm vitest run --coverage    # Requires @vitest/coverage-v8
cd backend && go test -cover ./...
```

## Test Types

**Unit Tests (Frontend -- 9 test files):**
- Hooks: `use-sse.test.ts`, `use-scanner.test.ts`, `use-device-session.test.ts`, `use-audio-feedback.test.ts`, `use-network-status.test.ts`, `use-offline-sync.test.ts`
- Lib: `offline-queue.test.ts`
- Components: `scanner-setup.test.tsx`, `active-sessions-tab.test.tsx`
- Focus: State transitions, network error handling, offline queue CRUD, browser API interactions

**Unit Tests (Go Backend -- 24+ test files):**
- Scan service: valid/duplicate/invalid HMAC/guest not found/wrong QR type
- Concurrency: 500 goroutine barrier test for race condition detection
- HTTP handlers: health, session CRUD, QR generation, SMS, cards
- Middleware: HMAC signature verification
- QR: payload encode/decode, generator
- SSE: broker subscription, handler streaming
- R2: client upload/download
- SMS: provider API calls, worker processing

**Integration Tests (Go -- `//go:build integration`):**
- Config matrix: all 6 event configurations tested end-to-end
- Real PostgreSQL + Redis via testcontainers
- 50 guests per config: entry scans, food scans, counter verification
- Image generation: QR generation, card compositing with real image processing
- SMS batch: bulk delivery with provider mock

**E2E Tests (Playwright -- 6 spec files):**
- `auth.spec.ts` -- login page rendering, form mode toggle (no real auth)
- `events.spec.ts` -- event list, create dialog, detail page tabs (uses auth fixture)
- `scanner.spec.ts` -- scanner routing, redirect, UI without admin shell
- `scanner.mobile.spec.ts` -- mobile viewport responsiveness
- `api-health.spec.ts` -- Go API health, HMAC protection, SSE endpoint, session API
- `scb-familyday.spec.ts` -- Full serial scenario: create event, add categories, add vendors with stalls, advance status, verify setup

**Load Tests (k6 -- 4 scenarios):**
- `scan_load_test.js`: Ramp 0 -> 1K -> 5K -> 10K VUs over 70s + duplicate flood
- `scenarios/entry_scan.js`: Entry scan focused load
- `scenarios/food_scan.js`: Food scan focused load
- `scenarios/dashboard_sse.js`: SSE connection load
- `scenarios/mixed_load.js`: Combined workload
- Thresholds: p95 < 200ms, zero HTTP errors, zero scan processing errors
- Config matrix: all 6 event configurations tested under load

## Common Test Patterns

**Async Hook Testing:**
```typescript
it("waits for loading to complete", async () => {
  const { result } = renderHook(() => useDeviceSession());
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });
  expect(result.current.token).toBeNull();
});
```

**Fake Timer Usage:**
```typescript
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("fires after delay", async () => {
  // Trigger action
  await act(async () => {
    vi.runAllTimers();
  });
  // Assert result
});
```

**State Machine Testing (Zustand):**
```typescript
it("transitions through states correctly", async () => {
  act(() => { store.getState().onQrDetected("payload"); });
  expect(store.getState().state).toBe("reviewing");

  await act(async () => {
    await store.getState().onConfirm(...);
  });
  expect(store.getState().state).toBe("flash");

  act(() => { store.getState().onFlashComplete(); });
  expect(store.getState().state).toBe("ready");
});
```

**E2E Serial Test Scenario:**
```typescript
test.describe.configure({ mode: "serial" });

let eventUrl: string;

test("step 1: create event", async ({ page }) => {
  // Create and capture URL
  eventUrl = page.url();
});

test("step 2: configure event", async ({ page }) => {
  await navigateToEvent(page, eventUrl, "Event Name");
  // Configure...
});
```

**Go Table-Driven Tests:**
```go
func TestCounterIncrement(t *testing.T) {
    guests := []struct {
        id       string
        name     string
        category string
    }{
        {"g1", "Guest 1", "vip"},
        {"g2", "Guest 2", "regular"},
    }
    for _, g := range guests {
        // Test each guest
    }
}
```

## Test Coverage Gaps

**Not Tested (Frontend):**
- Route components (`src/routes/*.tsx`) -- no unit tests for page-level routes
- Most feature components (`src/components/events/*.tsx`, `src/components/dashboard/*.tsx`, `src/components/cards/*.tsx`) -- only 2 component test files exist
- Convex query/mutation responses in components -- mocked at module level, not tested against real Convex
- TanStack Router navigation flows -- not unit tested
- `src/lib/motion.tsx` animation components -- no tests
- `src/lib/parse-file.ts`, `src/lib/phone.ts` -- no tests
- `src/hooks/use-card-editor.ts`, `src/hooks/use-animated-counter.ts` -- no tests

**Not Tested (Convex):**
- No Convex function tests (no test runner configured for Convex functions)
- Authorization logic (`convex/authz.ts`) only tested indirectly via E2E
- Schema validation only tested indirectly via integration

**Not Tested (Go):**
- No tests for `internal/convexsync/client.go`
- No tests for `internal/db/db.go` (database connection setup)
- No tests for `cmd/server/main.go` and `cmd/worker/main.go` (entry points)

**Not Tested (E2E):**
- Guest import flow (file upload wizard)
- Card editor (Fabric.js canvas)
- SMS sending flow
- Live dashboard with real SSE data
- Food rule configuration matrix
- Multi-user permissions

## CI/CD Test Configuration

**No CI pipeline detected.** No `.github/workflows/`, `.gitlab-ci.yml`, or similar CI config files found. All tests run locally.

**Playwright CI Configuration (pre-configured in `playwright.config.ts`):**
- `forbidOnly: !!process.env.CI` -- prevents `.only` in CI
- `retries: process.env.CI ? 2 : 0` -- retry twice in CI
- `workers: process.env.CI ? 1 : undefined` -- serial in CI
- `reuseExistingServer: !process.env.CI` -- fresh server in CI

**Environment Variables Required for E2E:**
- `VITE_CONVEX_SITE_URL` -- required (throws if missing)
- `E2E_TEST_EMAIL` -- optional (default: `e2e@eventarc.test`)
- `E2E_TEST_PASSWORD` -- optional (default: `E2eTest1234!`)
- `E2E_ORIGIN` -- optional (default: `http://localhost:5173`)
- `GO_API_URL` -- optional (default: `http://localhost:8080`)

---

*Testing analysis: 2026-04-12*
