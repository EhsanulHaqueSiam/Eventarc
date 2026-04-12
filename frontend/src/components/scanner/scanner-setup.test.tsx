import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock convex/react before importing the component
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

// Mock convex generated API
vi.mock("convex/_generated/api", () => ({
  api: {
    events: { list: "events.list" },
    vendorTypes: { listByEvent: "vendorTypes.listByEvent" },
    vendorCategories: {
      listByVendorType: "vendorCategories.listByVendorType",
    },
    stalls: { listByCategory: "stalls.listByCategory" },
  },
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { useQuery } from "convex/react";
import { ScannerSetup } from "./scanner-setup";

const mockUseQuery = vi.mocked(useQuery);

describe("ScannerSetup", () => {
  const mockOnSessionCreated = vi.fn();
  const mockCreateSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return empty arrays / skip for most queries
    mockUseQuery.mockImplementation((queryFn: unknown, args?: unknown) => {
      if (queryFn === "events.list") {
        return [
          {
            _id: "event-1",
            name: "Test Event",
            status: "live",
            _creationTime: 0,
          },
        ] as never;
      }
      if (args === "skip") return undefined as never;
      return [] as never;
    });
  });

  it('renders heading "Select Your Station"', () => {
    render(
      <ScannerSetup
        onSessionCreated={mockOnSessionCreated}
        createSession={mockCreateSession}
      />,
    );
    expect(screen.getByText("Select Your Station")).toBeDefined();
  });

  it("renders the event dropdown", () => {
    render(
      <ScannerSetup
        onSessionCreated={mockOnSessionCreated}
        createSession={mockCreateSession}
      />,
    );
    expect(screen.getByText("Event")).toBeDefined();
  });

  it("renders EventArc branding", () => {
    render(
      <ScannerSetup
        onSessionCreated={mockOnSessionCreated}
        createSession={mockCreateSession}
      />,
    );
    expect(screen.getByText("EventArc")).toBeDefined();
  });

  it('renders "Start Scanning" button', () => {
    render(
      <ScannerSetup
        onSessionCreated={mockOnSessionCreated}
        createSession={mockCreateSession}
      />,
    );
    const button = screen.getByText("Start Scanning");
    expect(button).toBeDefined();
  });

  it('"Start Scanning" button is disabled when dropdowns not all selected', () => {
    render(
      <ScannerSetup
        onSessionCreated={mockOnSessionCreated}
        createSession={mockCreateSession}
      />,
    );
    const button = screen.getByText("Start Scanning").closest("button");
    expect(button?.disabled).toBe(true);
  });

  it("renders description text", () => {
    render(
      <ScannerSetup
        onSessionCreated={mockOnSessionCreated}
        createSession={mockCreateSession}
      />,
    );
    expect(
      screen.getByText("Choose your assigned scanning station to begin"),
    ).toBeDefined();
  });
});
