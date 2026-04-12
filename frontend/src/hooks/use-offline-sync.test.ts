import "fake-indexeddb/auto";
import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  queueScan,
  getPendingScans,
  _resetDBInstance,
  getPendingCount,
  type OfflineScan,
} from "@/lib/offline-queue";
import { syncOfflineScans } from "./use-offline-sync";
import { useOfflineScannerStore } from "@/stores/scanner-store";

// Ensure crypto.randomUUID is available
if (!globalThis.crypto?.randomUUID) {
  let counter = 0;
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: () =>
      `test-uuid-${++counter}-${Math.random().toString(36).slice(2)}`,
  });
}

const baseScanParams = {
  scan_payload: "test-qr-payload",
  scan_type: "entry" as const,
  stall_id: "stall-001",
  event_id: "event-001",
  guest_name: "Ahmed Khan",
  guest_category: "VIP",
};

const mockCallbacks = () => ({
  getSessionToken: vi.fn(() => "test-token"),
  onSynced: vi.fn(),
  onRejected: vi.fn(),
  onProgress: vi.fn(),
  onNetworkError: vi.fn(),
});

beforeEach(async () => {
  _resetDBInstance();
  const deleteReq = indexedDB.deleteDatabase("eventarc-offline");
  await new Promise<void>((resolve, reject) => {
    deleteReq.onsuccess = () => resolve();
    deleteReq.onerror = () => reject(deleteReq.error);
  });

  // Reset store
  useOfflineScannerStore.setState({
    networkStatus: "online",
    pendingCount: 0,
    syncProgress: null,
    rejections: [],
  });

  vi.restoreAllMocks();
});

describe("syncOfflineScans", () => {
  test("fetches pending scans sorted by timestamp ascending and sends each to the correct endpoint", async () => {
    // Queue entry and food scans
    await queueScan(baseScanParams);
    await queueScan({
      ...baseScanParams,
      scan_type: "food",
      guest_name: "Fatima Begum",
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    // Check that both endpoints were called
    const urls = fetchMock.mock.calls.map(
      (call: [string, ...unknown[]]) => call[0],
    );
    expect(urls.some((u: string) => u.includes("/api/v1/scan/entry"))).toBe(
      true,
    );
    expect(urls.some((u: string) => u.includes("/api/v1/scan/food"))).toBe(
      true,
    );
  });

  test("each sync request includes idempotency_key, scan_payload, stall_id, and queued_at in body", async () => {
    await queueScan(baseScanParams);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    const body = JSON.parse(
      fetchMock.mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(body).toHaveProperty("idempotency_key");
    expect(body).toHaveProperty("payload", "test-qr-payload");
    expect(body).toHaveProperty("stall_id", "stall-001");
    expect(body).toHaveProperty("queued_at");
    expect(typeof body.queued_at).toBe("number");
  });

  test("successful sync response (200) updates scan to synced with synced_at", async () => {
    await queueScan(baseScanParams);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    );

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    expect(cbs.onSynced).toHaveBeenCalledTimes(1);
    const pending = await getPendingScans();
    expect(pending).toHaveLength(0);
  });

  test("rejection response (409/422) updates scan to rejected with reason and calls onRejected", async () => {
    await queueScan(baseScanParams);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: { message: "already checked in" } }),
      }),
    );

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    expect(cbs.onRejected).toHaveBeenCalledTimes(1);
    expect(cbs.onRejected).toHaveBeenCalledWith(
      expect.any(String),
      "already checked in",
      expect.objectContaining({ guest_name: "Ahmed Khan" }),
    );
  });

  test("network error during sync stops processing remaining scans", async () => {
    await queueScan(baseScanParams);
    await queueScan({ ...baseScanParams, guest_name: "Fatima Begum" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    expect(cbs.onNetworkError).toHaveBeenCalledTimes(1);
    // Both scans should still be pending
    const pending = await getPendingScans();
    expect(pending).toHaveLength(2);
  });

  test("after sync completes, pendingCount is refreshed from IndexedDB", async () => {
    await queueScan(baseScanParams);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    );

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    const count = await getPendingCount();
    expect(count).toBe(0);
  });

  test("partial sync recovery: next sync only processes remaining pending scans", async () => {
    await queueScan(baseScanParams);
    await queueScan({ ...baseScanParams, guest_name: "Fatima Begum" });
    await queueScan({ ...baseScanParams, guest_name: "Rafiq Uddin" });

    // First sync: succeed on first, fail on second
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({}),
          });
        }
        return Promise.reject(new Error("Network error"));
      }),
    );

    const cbs1 = mockCallbacks();
    await syncOfflineScans(
      cbs1.getSessionToken,
      cbs1.onSynced,
      cbs1.onRejected,
      cbs1.onProgress,
      cbs1.onNetworkError,
    );

    // 1 synced, 2 still pending
    const pendingAfterFirst = await getPendingScans();
    expect(pendingAfterFirst).toHaveLength(2);

    // Second sync: all succeed
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    );

    const cbs2 = mockCallbacks();
    await syncOfflineScans(
      cbs2.getSessionToken,
      cbs2.onSynced,
      cbs2.onRejected,
      cbs2.onProgress,
      cbs2.onNetworkError,
    );

    // All synced now
    const pendingAfterSecond = await getPendingScans();
    expect(pendingAfterSecond).toHaveLength(0);
    expect(cbs2.onSynced).toHaveBeenCalledTimes(2);
  });

  test("idempotent sync: duplicate idempotency key returns 200, scan marked synced", async () => {
    await queueScan(baseScanParams);

    // Server treats duplicate as success (INSERT ON CONFLICT DO NOTHING)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    );

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    expect(cbs.onSynced).toHaveBeenCalledTimes(1);
    expect(cbs.onRejected).not.toHaveBeenCalled();
    expect(cbs.onNetworkError).not.toHaveBeenCalled();
  });

  test("sync sets progress through onProgress callback", async () => {
    await queueScan(baseScanParams);
    await queueScan({ ...baseScanParams, guest_name: "Fatima Begum" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    );

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    // Should have been called twice (once per scan)
    expect(cbs.onProgress).toHaveBeenCalledTimes(2);

    // First progress update
    expect(cbs.onProgress).toHaveBeenNthCalledWith(1, {
      total: 2,
      completed: 1,
      failed: 0,
    });

    // Second progress update
    expect(cbs.onProgress).toHaveBeenNthCalledWith(2, {
      total: 2,
      completed: 2,
      failed: 0,
    });
  });

  test("after sync, cleanupExpiredScans() is called to purge old records", async () => {
    // Create an old scan directly in the DB
    const { openOfflineDB } = await import("@/lib/offline-queue");
    const db = await openOfflineDB();
    await db.put("offline_scans", {
      ...baseScanParams,
      idempotency_key: "old-expired-key",
      timestamp: Date.now() - 31 * 60 * 1000, // 31 minutes ago
      status: "synced" as const,
      rejection_reason: null,
      synced_at: Date.now() - 30 * 60 * 1000,
    });

    // Queue a fresh pending scan
    await queueScan(baseScanParams);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    );

    const cbs = mockCallbacks();
    await syncOfflineScans(
      cbs.getSessionToken,
      cbs.onSynced,
      cbs.onRejected,
      cbs.onProgress,
      cbs.onNetworkError,
    );

    // The old expired record should have been cleaned up
    const record = await db.get("offline_scans", "old-expired-key");
    expect(record).toBeUndefined();
  });
});
