import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNetworkStatus } from "./use-network-status";
import { useOfflineScannerStore } from "@/stores/scanner-store";

// Track event listeners
let eventListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

function fireWindowEvent(event: string) {
  const handlers = eventListeners[event] || [];
  handlers.forEach((fn) => fn(new Event(event)));
}

beforeEach(() => {
  vi.useFakeTimers();
  eventListeners = {};

  // Mock addEventListener/removeEventListener
  vi.spyOn(window, "addEventListener").mockImplementation(
    (event: string, handler: unknown) => {
      if (!eventListeners[event]) eventListeners[event] = [];
      eventListeners[event].push(handler as (...args: unknown[]) => void);
    },
  );
  vi.spyOn(window, "removeEventListener").mockImplementation(
    (event: string, handler: unknown) => {
      eventListeners[event] = (eventListeners[event] || []).filter(
        (h) => h !== handler,
      );
    },
  );

  // Default: navigator.onLine = true
  Object.defineProperty(navigator, "onLine", {
    value: true,
    writable: true,
    configurable: true,
  });

  // Reset store state
  useOfflineScannerStore.setState({
    networkStatus: "online",
    pendingCount: 0,
    syncProgress: null,
    rejections: [],
  });

  // Default: mock fetch to succeed
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useNetworkStatus", () => {
  test("initial state is 'online' when navigator.onLine is true", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    useOfflineScannerStore.setState({ networkStatus: "online" });

    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.networkStatus).toBe("online");
    expect(result.current.isOffline).toBe(false);
  });

  test("initial state is 'offline' when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    useOfflineScannerStore.setState({ networkStatus: "offline" });

    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.networkStatus).toBe("offline");
    expect(result.current.isOffline).toBe(true);
  });

  test("transitions to 'offline' when window 'offline' event fires after 500ms debounce", async () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.networkStatus).toBe("online");

    // Fire offline event
    act(() => {
      fireWindowEvent("offline");
    });

    // Still online during debounce
    expect(result.current.networkStatus).toBe("online");

    // Advance past 500ms debounce
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.networkStatus).toBe("offline");
    expect(result.current.isOffline).toBe(true);
  });

  test("does NOT transition to 'offline' if 'online' event fires within 500ms debounce", async () => {
    const { result } = renderHook(() => useNetworkStatus());

    // Fire offline then online within debounce window
    act(() => {
      fireWindowEvent("offline");
    });

    // 200ms later: online event fires
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    act(() => {
      fireWindowEvent("online");
    });

    // Advance past the original offline debounce
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Should still be online (offline transition was cancelled)
    expect(result.current.networkStatus).not.toBe("offline");
  });

  test("transitions to 'online' when 'online' event fires AND health check succeeds after 2s debounce", async () => {
    // Start offline
    useOfflineScannerStore.setState({ networkStatus: "offline" });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.networkStatus).toBe("offline");

    // Fire online event
    act(() => {
      fireWindowEvent("online");
    });

    // Advance past 2s online debounce
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Allow fetch promise to resolve
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.networkStatus).toBe("online");
  });

  test("does NOT transition to 'online' if health check fails even when navigator.onLine is true", async () => {
    // Start offline
    useOfflineScannerStore.setState({ networkStatus: "offline" });

    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNetworkStatus());

    // Fire online event
    act(() => {
      fireWindowEvent("online");
    });

    // Advance past 2s debounce to trigger health check
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Flush the resolved fetch promise (one microtask tick)
    await act(async () => {
      await Promise.resolve();
    });

    // Should still be offline since health check failed
    expect(result.current.networkStatus).toBe("offline");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("cleanup removes event listeners on unmount", () => {
    const { unmount } = renderHook(() => useNetworkStatus());

    expect(eventListeners["online"]?.length).toBeGreaterThan(0);
    expect(eventListeners["offline"]?.length).toBeGreaterThan(0);

    unmount();

    expect(eventListeners["online"]?.length || 0).toBe(0);
    expect(eventListeners["offline"]?.length || 0).toBe(0);
  });
});
