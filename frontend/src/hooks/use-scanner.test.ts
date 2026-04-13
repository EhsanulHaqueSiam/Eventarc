import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { useScannerStore } from "./use-scanner";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock import.meta.env
vi.stubEnv("VITE_API_URL", "http://localhost:8080");

describe("useScannerStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    act(() => {
      useScannerStore.getState().reset();
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initial state is 'idle'", () => {
    expect(useScannerStore.getState().state).toBe("idle");
  });

  it("onQrDetected transitions from 'idle' to 'reviewing'", () => {
    act(() => {
      useScannerStore.getState().onQrDetected("test-qr-payload");
    });

    const state = useScannerStore.getState();
    expect(state.state).toBe("reviewing");
    expect(state.scanResult).not.toBeNull();
    expect(state.scanResult?.qrPayload).toBe("test-qr-payload");
  });

  it("onQrDetected is ignored when state is not 'idle' (prevents double-scan)", () => {
    // First QR detection
    act(() => {
      useScannerStore.getState().onQrDetected("first-payload");
    });
    expect(useScannerStore.getState().state).toBe("reviewing");

    // Second QR detection should be ignored
    act(() => {
      useScannerStore.getState().onQrDetected("second-payload");
    });
    expect(useScannerStore.getState().scanResult?.qrPayload).toBe(
      "first-payload",
    );
  });

  it("onConfirm transitions from 'reviewing' to 'confirming' then to 'flash' on server success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "allowed",
        guest: { name: "Test Guest", category: "VIP" },
      }),
    });

    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });

    await act(async () => {
      await useScannerStore
        .getState()
        .onConfirm({ sessionToken: "session-token", vendorType: "entry" });
    });

    const state = useScannerStore.getState();
    expect(state.state).toBe("flash");
    expect(state.serverResponse?.outcome).toBe("allowed");
    expect(state.serverResponse?.guestName).toBe("Test Guest");
  });

  it("onConfirm sends to food endpoint when vendorTypeId is not 'entry'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "served",
        guest: { name: "Test Guest" },
        foodCategory: "fuchka",
        used: 1,
        limit: 3,
        remaining: 2,
      }),
    });

    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });

    await act(async () => {
      await useScannerStore
        .getState()
        .onConfirm({ sessionToken: "session-token", vendorType: "food" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/scan/food"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("qr_payload"),
      }),
    );

    const state = useScannerStore.getState();
    expect(state.serverResponse?.outcome).toBe("served");
    expect(state.serverResponse?.foodCategory).toBe("fuchka");
  });

  it("onConfirm handles network error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });

    await act(async () => {
      await useScannerStore
        .getState()
        .onConfirm({ sessionToken: "session-token", vendorType: "entry" });
    });

    const state = useScannerStore.getState();
    expect(state.state).toBe("flash");
    expect(state.serverResponse?.outcome).toBe("network_error");
    expect(state.serverResponse?.reason).toContain("not confirmed");
  });

  it("onFlashComplete transitions from 'flash' to 'ready'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "allowed",
        guest: { name: "Test Guest", category: "VIP" },
      }),
    });

    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });

    await act(async () => {
      await useScannerStore
        .getState()
        .onConfirm({ sessionToken: "session-token", vendorType: "entry" });
    });

    expect(useScannerStore.getState().state).toBe("flash");

    act(() => {
      useScannerStore.getState().onFlashComplete();
    });

    expect(useScannerStore.getState().state).toBe("ready");
  });

  it("onDismiss transitions from 'reviewing' to 'ready' with no server call", () => {
    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });
    expect(useScannerStore.getState().state).toBe("reviewing");

    act(() => {
      useScannerStore.getState().onDismiss();
    });

    expect(useScannerStore.getState().state).toBe("ready");
    expect(useScannerStore.getState().serverResponse).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("onScanNext transitions from 'ready' to 'idle' and increments scanCount", () => {
    // Go through full cycle to reach 'ready'
    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });
    act(() => {
      useScannerStore.getState().onDismiss();
    });
    expect(useScannerStore.getState().state).toBe("ready");
    expect(useScannerStore.getState().scanCount).toBe(0);

    act(() => {
      useScannerStore.getState().onScanNext();
    });

    expect(useScannerStore.getState().state).toBe("idle");
    expect(useScannerStore.getState().scanCount).toBe(1);
    expect(useScannerStore.getState().scanResult).toBeNull();
  });

  it("reset returns to initial state", () => {
    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });

    act(() => {
      useScannerStore.getState().reset();
    });

    const state = useScannerStore.getState();
    expect(state.state).toBe("idle");
    expect(state.scanResult).toBeNull();
    expect(state.serverResponse).toBeNull();
    expect(state.scanCount).toBe(0);
  });

  it("handles duplicate entry response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "duplicate",
        guest: { name: "Test Guest", category: "Regular" },
        originalCheckIn: { time: "2026-04-12T10:00:00Z", stall: "Gate 1" },
      }),
    });

    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });

    await act(async () => {
      await useScannerStore
        .getState()
        .onConfirm({ sessionToken: "session-token", vendorType: "entry" });
    });

    const state = useScannerStore.getState();
    expect(state.serverResponse?.outcome).toBe("duplicate_entry");
    expect(state.serverResponse?.originalCheckIn?.stall).toBe("Gate 1");
  });

  it("handles duplicate food response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "already_served",
        guest: { name: "Test Guest" },
        foodCategory: "fuchka",
        used: 3,
        limit: 3,
        history: [
          { stall: "fuchka-1", time: "2026-04-12T10:00:00Z" },
          { stall: "fuchka-2", time: "2026-04-12T10:30:00Z" },
        ],
      }),
    });

    act(() => {
      useScannerStore.getState().onQrDetected("test-payload");
    });

    await act(async () => {
      await useScannerStore
        .getState()
        .onConfirm({ sessionToken: "session-token", vendorType: "food" });
    });

    const state = useScannerStore.getState();
    expect(state.serverResponse?.outcome).toBe("duplicate_food");
    expect(state.serverResponse?.used).toBe(3);
    expect(state.serverResponse?.limit).toBe(3);
    expect(state.serverResponse?.consumptionHistory).toHaveLength(2);
  });
});
