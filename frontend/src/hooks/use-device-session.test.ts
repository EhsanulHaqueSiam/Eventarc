import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDeviceSession } from "./use-device-session";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((_i: number) => null),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useDeviceSession", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null token when localStorage is empty", async () => {
    // Mock fetch for validation (should not be called when no token stored)
    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.token).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it("returns token from localStorage when present and validation succeeds", async () => {
    localStorageMock.setItem(
      "eventarc_scanner_session",
      "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stallId: "stall-1",
        eventId: "event-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
        createdAt: "2026-04-12T00:00:00Z",
      }),
    });

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.token).toBe(
      "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    );
  });

  it("clears token and sets isRevoked when validation returns 401", async () => {
    localStorageMock.setItem("eventarc_scanner_session", "invalid-token");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.token).toBeNull();
    expect(result.current.isRevoked).toBe(true);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      "eventarc_scanner_session",
    );
  });

  it("keeps token on network error — does not mark as revoked", async () => {
    localStorageMock.setItem("eventarc_scanner_session", "valid-token");

    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Token should NOT be cleared on network error
    expect(result.current.isRevoked).toBe(false);
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
  });

  it("keeps token when server returns 500", async () => {
    localStorageMock.setItem("eventarc_scanner_session", "valid-token");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isRevoked).toBe(false);
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
  });

  it("createSession returns false on server error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let success: boolean = true;
    await act(async () => {
      success = await result.current.createSession({
        stallId: "stall-1",
        eventId: "event-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
        stallName: "Stall 1",
      });
    });

    expect(success).toBe(false);
    expect(result.current.token).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it("createSession returns false on network exception", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let success: boolean = true;
    await act(async () => {
      success = await result.current.createSession({
        stallId: "stall-1",
        eventId: "event-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
        stallName: "Stall 1",
      });
    });

    expect(success).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it("createSession POSTs to /api/v1/session and stores token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token:
          "newtoken1234567890abcdef1234567890abcdef1234567890abcdef12345678",
      }),
    });

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let success: boolean = false;
    await act(async () => {
      success = await result.current.createSession({
        stallId: "stall-1",
        eventId: "event-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
        stallName: "Stall 1",
      });
    });

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/session"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "eventarc_scanner_session",
      expect.stringContaining("newtoken1234567890abcdef1234567890abcdef1234567890abcdef12345678"),
    );
    expect(result.current.token).toBe(
      "newtoken1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    );
  });

  it("clearSession removes token from localStorage", async () => {
    localStorageMock.setItem(
      "eventarc_scanner_session",
      "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stallId: "stall-1",
        eventId: "event-1",
        vendorCategoryId: "cat-1",
        vendorTypeId: "type-1",
        createdAt: "2026-04-12T00:00:00Z",
      }),
    });

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.clearSession();
    });

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      "eventarc_scanner_session",
    );
    expect(result.current.token).toBeNull();
    expect(result.current.session).toBeNull();
  });
});
