import "fake-indexeddb/auto";
import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  openOfflineDB,
  queueScan,
  getPendingScans,
  updateScanStatus,
  cleanupExpiredScans,
  getPendingCount,
  getAllScans,
  _resetDBInstance,
} from "./offline-queue";

// Ensure crypto.randomUUID is available in test env
if (!globalThis.crypto?.randomUUID) {
  let counter = 0;
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: () => `test-uuid-${++counter}-${Math.random().toString(36).slice(2)}`,
  });
}

const baseScanParams = {
  scan_payload: "test-qr-payload-data",
  scan_type: "entry" as const,
  stall_id: "stall-001",
  event_id: "event-001",
  guest_name: "Ahmed Khan",
  guest_category: "VIP",
};

beforeEach(async () => {
  _resetDBInstance();
  // Delete the database between tests for clean state
  const deleteReq = indexedDB.deleteDatabase("eventarc-offline");
  await new Promise<void>((resolve, reject) => {
    deleteReq.onsuccess = () => resolve();
    deleteReq.onerror = () => reject(deleteReq.error);
  });
});

describe("offline-queue", () => {
  test("openOfflineDB() creates database with offline_scans store and two indexes", async () => {
    const db = await openOfflineDB();
    expect(db.name).toBe("eventarc-offline");
    expect(db.objectStoreNames.contains("offline_scans")).toBe(true);

    const tx = db.transaction("offline_scans", "readonly");
    const store = tx.objectStore("offline_scans");
    expect(store.indexNames.contains("by_status")).toBe(true);
    expect(store.indexNames.contains("by_timestamp")).toBe(true);
    await tx.done;
  });

  test("queueScan() stores a record with all required fields", async () => {
    const key = await queueScan(baseScanParams);
    const db = await openOfflineDB();
    const record = await db.get("offline_scans", key);

    expect(record).toBeDefined();
    expect(record!.idempotency_key).toBe(key);
    expect(record!.scan_payload).toBe("test-qr-payload-data");
    expect(record!.scan_type).toBe("entry");
    expect(record!.stall_id).toBe("stall-001");
    expect(record!.event_id).toBe("event-001");
    expect(record!.guest_name).toBe("Ahmed Khan");
    expect(record!.guest_category).toBe("VIP");
    expect(record!.timestamp).toBeGreaterThan(0);
    expect(record!.status).toBe("pending");
    expect(record!.rejection_reason).toBeNull();
    expect(record!.synced_at).toBeNull();
  });

  test("queueScan() generates a unique idempotency key via crypto.randomUUID() for each call", async () => {
    const key1 = await queueScan(baseScanParams);
    const key2 = await queueScan(baseScanParams);
    const key3 = await queueScan(baseScanParams);

    expect(key1).not.toBe(key2);
    expect(key2).not.toBe(key3);
    expect(key1).not.toBe(key3);
  });

  test("getPendingScans() returns only records with status='pending', sorted by timestamp ascending", async () => {
    // Queue scans with controlled timestamps
    const now = Date.now();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(now + 200)
      .mockReturnValueOnce(now + 100)
      .mockReturnValueOnce(now + 300);

    await queueScan(baseScanParams);
    await queueScan({ ...baseScanParams, guest_name: "Fatima Begum" });
    await queueScan({ ...baseScanParams, guest_name: "Rafiq Uddin" });

    // Mark one as synced
    const allScans = await getAllScans();
    const firstScan = allScans.find((s) => s.guest_name === "Ahmed Khan")!;
    await updateScanStatus(firstScan.idempotency_key, "synced");

    const pending = await getPendingScans();
    expect(pending).toHaveLength(2);
    // Should be sorted by timestamp ascending (oldest first)
    expect(pending[0].timestamp).toBeLessThanOrEqual(pending[1].timestamp);
    // The synced one should not appear
    expect(pending.every((s) => s.status === "pending")).toBe(true);

    vi.restoreAllMocks();
  });

  test("getPendingScans() returns empty array when no pending scans exist", async () => {
    const pending = await getPendingScans();
    expect(pending).toEqual([]);
  });

  test("updateScanStatus() changes a scan's status to 'synced' and sets synced_at timestamp", async () => {
    const key = await queueScan(baseScanParams);

    await updateScanStatus(key, "synced");

    const db = await openOfflineDB();
    const record = await db.get("offline_scans", key);
    expect(record!.status).toBe("synced");
    expect(record!.synced_at).toBeGreaterThan(0);
    expect(record!.rejection_reason).toBeNull();
  });

  test("updateScanStatus() changes a scan's status to 'rejected' and sets rejection_reason", async () => {
    const key = await queueScan(baseScanParams);

    await updateScanStatus(key, "rejected", "fuchka limit reached");

    const db = await openOfflineDB();
    const record = await db.get("offline_scans", key);
    expect(record!.status).toBe("rejected");
    expect(record!.rejection_reason).toBe("fuchka limit reached");
    expect(record!.synced_at).toBeNull();
  });

  test("cleanupExpiredScans() deletes records with timestamp older than 30 minutes", async () => {
    // Create a scan with an old timestamp
    const db = await openOfflineDB();
    const oldTimestamp = Date.now() - 31 * 60 * 1000; // 31 minutes ago

    await db.put("offline_scans", {
      ...baseScanParams,
      idempotency_key: "old-scan-key",
      timestamp: oldTimestamp,
      status: "pending",
      rejection_reason: null,
      synced_at: null,
    });

    const deleted = await cleanupExpiredScans();
    expect(deleted).toBe(1);

    const record = await db.get("offline_scans", "old-scan-key");
    expect(record).toBeUndefined();
  });

  test("cleanupExpiredScans() does NOT delete records younger than 30 minutes", async () => {
    const key = await queueScan(baseScanParams);

    const deleted = await cleanupExpiredScans();
    expect(deleted).toBe(0);

    const db = await openOfflineDB();
    const record = await db.get("offline_scans", key);
    expect(record).toBeDefined();
  });

  test("getPendingCount() returns count of records with status='pending'", async () => {
    expect(await getPendingCount()).toBe(0);

    await queueScan(baseScanParams);
    await queueScan({ ...baseScanParams, guest_name: "Fatima Begum" });
    expect(await getPendingCount()).toBe(2);

    // Mark one as synced
    const pending = await getPendingScans();
    await updateScanStatus(pending[0].idempotency_key, "synced");
    expect(await getPendingCount()).toBe(1);
  });

  test("getAllScans() returns all records regardless of status, sorted by timestamp descending", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(now + 100)
      .mockReturnValueOnce(now + 200)
      .mockReturnValueOnce(now + 300);

    const key1 = await queueScan(baseScanParams);
    await queueScan({ ...baseScanParams, guest_name: "Fatima Begum" });
    const key3 = await queueScan({ ...baseScanParams, guest_name: "Rafiq Uddin" });

    // Mark one as synced, one as rejected
    await updateScanStatus(key1, "synced");
    await updateScanStatus(key3, "rejected", "already checked in");

    const allScans = await getAllScans();
    expect(allScans).toHaveLength(3);

    // Should be sorted by timestamp descending (newest first)
    for (let i = 0; i < allScans.length - 1; i++) {
      expect(allScans[i].timestamp).toBeGreaterThanOrEqual(allScans[i + 1].timestamp);
    }

    // Should include all statuses
    const statuses = new Set(allScans.map((s) => s.status));
    expect(statuses.has("pending")).toBe(true);
    expect(statuses.has("synced")).toBe(true);
    expect(statuses.has("rejected")).toBe(true);

    vi.restoreAllMocks();
  });
});
