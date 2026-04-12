import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE } from "./use-sse";

// Minimal EventSource mock
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate async open
    setTimeout(() => {
      if (!this.closed) {
        this.readyState = 1;
        this.onopen?.();
      }
    }, 0);
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  close() {
    this.readyState = 2;
    this.closed = true;
  }

  // Helper to simulate server events in tests
  _emit(type: string, data: string) {
    const event = new MessageEvent(type, { data });
    this.listeners[type]?.forEach((h) => h(event));
  }
}

// Install mock globally
const OriginalEventSource = globalThis.EventSource;

describe("useSSE", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).EventSource = OriginalEventSource;
  });

  it("creates EventSource with correct URL when enabled", () => {
    renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
      }),
    );

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      "http://localhost:8080/api/v1/events/123/live",
    );
  });

  it("does not create EventSource when enabled is false", () => {
    const { result } = renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: false,
      }),
    );

    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.status).toBe("disconnected");
  });

  it("fires onSnapshot callback when snapshot event received", () => {
    const onSnapshot = vi.fn();
    renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
        onSnapshot,
      }),
    );

    const es = MockEventSource.instances[0];
    const snapshotData = { attendance: { checkedIn: 42, totalInvited: 100, percentage: 42 } };
    act(() => {
      es._emit("snapshot", JSON.stringify(snapshotData));
    });

    expect(onSnapshot).toHaveBeenCalledWith(snapshotData);
  });

  it("fires onCounters callback when counters event received", () => {
    const onCounters = vi.fn();
    renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
        onCounters,
      }),
    );

    const es = MockEventSource.instances[0];
    const countersData = { counters: { scans_total: 100 }, attendance: { checkedIn: 50, totalInvited: 200, percentage: 25 } };
    act(() => {
      es._emit("counters", JSON.stringify(countersData));
    });

    expect(onCounters).toHaveBeenCalledWith(countersData);
  });

  it("fires onAlert callback when alert event received", () => {
    const onAlert = vi.fn();
    renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
        onAlert,
      }),
    );

    const es = MockEventSource.instances[0];
    const alertData = { type: "duplicate_scan", severity: "warning", title: "Duplicate", detail: "Guest already scanned", timestamp: "2026-04-12T10:00:00Z" };
    act(() => {
      es._emit("alert", JSON.stringify(alertData));
    });

    expect(onAlert).toHaveBeenCalledWith(alertData);
  });

  it("transitions status: connecting -> connected on open", async () => {
    const { result } = renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
      }),
    );

    // Initially should be connecting
    expect(result.current.status).toBe("connecting");

    // Simulate the async open
    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.status).toBe("connected");
  });

  it("transitions status: connected -> reconnecting on error", async () => {
    const { result } = renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
      }),
    );

    // Wait for connection
    await act(async () => {
      vi.runAllTimers();
    });
    expect(result.current.status).toBe("connected");

    // Simulate error
    const es = MockEventSource.instances[0];
    act(() => {
      es.onerror?.();
    });

    expect(result.current.status).toBe("reconnecting");
  });

  it("EventSource is closed on unmount (cleanup)", async () => {
    const { unmount } = renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
      }),
    );

    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);

    unmount();

    expect(es.readyState).toBe(2);
    expect(es.closed).toBe(true);
  });

  it("transitions to disconnected after more than 3 consecutive errors", async () => {
    const { result } = renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
      }),
    );

    await act(async () => {
      vi.runAllTimers();
    });
    expect(result.current.status).toBe("connected");

    const es = MockEventSource.instances[0];

    // Trigger 4 errors to exceed the threshold of 3
    act(() => {
      es.onerror?.();
    });
    expect(result.current.status).toBe("reconnecting");

    act(() => {
      es.onerror?.();
    });
    expect(result.current.status).toBe("reconnecting");

    act(() => {
      es.onerror?.();
    });
    expect(result.current.status).toBe("reconnecting");

    act(() => {
      es.onerror?.();
    });
    expect(result.current.status).toBe("disconnected");
  });

  it("closes existing EventSource when enabled changes to false", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useSSE({
          url: "http://localhost:8080/api/v1/events/123/live",
          enabled,
        }),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      vi.runAllTimers();
    });
    expect(result.current.status).toBe("connected");

    const es = MockEventSource.instances[0];

    rerender({ enabled: false });

    expect(es.closed).toBe(true);
    expect(result.current.status).toBe("disconnected");
  });

  it("updates lastEventTime when events are received", () => {
    const { result } = renderHook(() =>
      useSSE({
        url: "http://localhost:8080/api/v1/events/123/live",
        enabled: true,
      }),
    );

    expect(result.current.lastEventTime).toBeNull();

    const es = MockEventSource.instances[0];
    const now = new Date("2026-04-12T10:00:00Z");
    vi.setSystemTime(now);

    act(() => {
      es._emit("snapshot", JSON.stringify({ attendance: { checkedIn: 0, totalInvited: 0, percentage: 0 } }));
    });

    expect(result.current.lastEventTime).toEqual(now);
  });
});
