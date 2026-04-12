import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock convex/react before importing the component
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => vi.fn()),
}));

// Mock convex generated API
vi.mock("convex/_generated/api", () => ({
  api: {
    deviceSessions: {
      listByEvent: "deviceSessions.listByEvent",
      revoke: "deviceSessions.revoke",
    },
  },
}));

import { useQuery } from "convex/react";
import { ActiveSessionsTab } from "./active-sessions-tab";
import type { Id } from "convex/_generated/dataModel";

const mockUseQuery = vi.mocked(useQuery);

const TEST_EVENT_ID = "event-1" as Id<"events">;

describe("ActiveSessionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeleton when data is undefined", () => {
    mockUseQuery.mockReturnValue(undefined as never);

    render(<ActiveSessionsTab eventId={TEST_EVENT_ID} />);

    // Skeleton elements should be present (no table headers yet)
    expect(screen.queryByText("Active Sessions")).toBeNull();
  });

  it('renders empty state when no sessions exist', () => {
    mockUseQuery.mockReturnValue([] as never);

    render(<ActiveSessionsTab eventId={TEST_EVENT_ID} />);

    expect(
      screen.getByText("No active scanning sessions for this event"),
    ).toBeDefined();
  });

  it("renders table with correct headers for active sessions", () => {
    const now = Date.now();
    mockUseQuery.mockReturnValue([
      {
        _id: "session-1",
        _creationTime: now,
        stallName: "fuchka-1",
        scanCount: 12,
        createdAt: now - 60000,
        lastHeartbeat: now - 5000, // 5 seconds ago = Connected
        token: "token-1",
        status: "active",
        eventId: TEST_EVENT_ID,
        stallId: "stall-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
      },
    ] as never);

    render(<ActiveSessionsTab eventId={TEST_EVENT_ID} />);

    expect(screen.getByText("Active Sessions")).toBeDefined();
    expect(screen.getByText("1 active scanning station")).toBeDefined();
    // Both desktop table and mobile card render the stall name
    expect(screen.getAllByText("fuchka-1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Connected").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Connected status for session with lastHeartbeat < 30s ago", () => {
    const now = Date.now();
    mockUseQuery.mockReturnValue([
      {
        _id: "session-1",
        _creationTime: now,
        stallName: "gate-1",
        scanCount: 5,
        createdAt: now - 120000,
        lastHeartbeat: now - 10000, // 10 seconds ago
        token: "token-1",
        status: "active",
        eventId: TEST_EVENT_ID,
        stallId: "stall-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
      },
    ] as never);

    render(<ActiveSessionsTab eventId={TEST_EVENT_ID} />);

    expect(screen.getAllByText("Connected").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Idle status for session with lastHeartbeat 30s-2min ago", () => {
    const now = Date.now();
    mockUseQuery.mockReturnValue([
      {
        _id: "session-1",
        _creationTime: now,
        stallName: "biryani-1",
        scanCount: 0,
        createdAt: now - 300000,
        lastHeartbeat: now - 60000, // 60 seconds ago
        token: "token-1",
        status: "active",
        eventId: TEST_EVENT_ID,
        stallId: "stall-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
      },
    ] as never);

    render(<ActiveSessionsTab eventId={TEST_EVENT_ID} />);

    expect(screen.getAllByText("Idle").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Disconnected status for session with lastHeartbeat > 2min ago", () => {
    const now = Date.now();
    mockUseQuery.mockReturnValue([
      {
        _id: "session-1",
        _creationTime: now,
        stallName: "drinks-1",
        scanCount: 3,
        createdAt: now - 600000,
        lastHeartbeat: now - 180000, // 3 minutes ago
        token: "token-1",
        status: "active",
        eventId: TEST_EVENT_ID,
        stallId: "stall-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
      },
    ] as never);

    render(<ActiveSessionsTab eventId={TEST_EVENT_ID} />);

    expect(screen.getAllByText("Disconnected").length).toBeGreaterThanOrEqual(1);
  });

  it("renders Revoke button for each session", () => {
    const now = Date.now();
    mockUseQuery.mockReturnValue([
      {
        _id: "session-1",
        _creationTime: now,
        stallName: "fuchka-1",
        scanCount: 5,
        createdAt: now - 60000,
        lastHeartbeat: now - 5000,
        token: "token-1",
        status: "active",
        eventId: TEST_EVENT_ID,
        stallId: "stall-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
      },
      {
        _id: "session-2",
        _creationTime: now,
        stallName: "gate-1",
        scanCount: 10,
        createdAt: now - 120000,
        lastHeartbeat: now - 3000,
        token: "token-2",
        status: "active",
        eventId: TEST_EVENT_ID,
        stallId: "stall-2",
        vendorCategoryId: "cat-2",
        vendorTypeId: "type-2",
      },
    ] as never);

    render(<ActiveSessionsTab eventId={TEST_EVENT_ID} />);

    // Should show 2 stations count
    expect(screen.getByText("2 active scanning stations")).toBeDefined();

    // Both stalls rendered (desktop table + mobile card = 2 each)
    expect(screen.getAllByText("fuchka-1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("gate-1").length).toBeGreaterThanOrEqual(1);

    // Revoke buttons (both desktop table and mobile card have Revoke buttons)
    const revokeButtons = screen.getAllByText("Revoke");
    expect(revokeButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("filters out revoked sessions", () => {
    const now = Date.now();
    mockUseQuery.mockReturnValue([
      {
        _id: "session-1",
        _creationTime: now,
        stallName: "active-stall",
        scanCount: 5,
        createdAt: now - 60000,
        lastHeartbeat: now - 5000,
        token: "token-1",
        status: "active",
        eventId: TEST_EVENT_ID,
        stallId: "stall-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
      },
      {
        _id: "session-2",
        _creationTime: now,
        stallName: "revoked-stall",
        scanCount: 10,
        createdAt: now - 120000,
        lastHeartbeat: now - 3000,
        token: "token-2",
        status: "revoked",
        eventId: TEST_EVENT_ID,
        stallId: "stall-2",
        vendorCategoryId: "cat-2",
        vendorTypeId: "type-2",
      },
    ] as never);

    render(<ActiveSessionsTab eventId={TEST_EVENT_ID} />);

    expect(screen.getByText("1 active scanning station")).toBeDefined();
    expect(screen.getAllByText("active-stall").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("revoked-stall")).toBeNull();
  });
});
