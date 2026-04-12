import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface OfflineScan {
  idempotency_key: string;
  scan_payload: string;
  scan_type: "entry" | "food";
  stall_id: string;
  event_id: string;
  guest_name: string;
  guest_category: string;
  timestamp: number;
  status: "pending" | "synced" | "rejected";
  rejection_reason: string | null;
  synced_at: number | null;
}

interface OfflineScanDB extends DBSchema {
  offline_scans: {
    key: string;
    value: OfflineScan;
    indexes: {
      by_status: string;
      by_timestamp: number;
    };
  };
}

const DB_NAME = "eventarc-offline";
const DB_VERSION = 1;
const STORE_NAME = "offline_scans" as const;
const DEFAULT_RETENTION_MS = 30 * 60 * 1000; // 30 minutes

let dbInstance: IDBPDatabase<OfflineScanDB> | null = null;

export async function openOfflineDB(): Promise<IDBPDatabase<OfflineScanDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<OfflineScanDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE_NAME, {
        keyPath: "idempotency_key",
      });
      store.createIndex("by_status", "status");
      store.createIndex("by_timestamp", "timestamp");
    },
  });

  return dbInstance;
}

/**
 * Reset the singleton DB instance. Used in tests to get a fresh DB.
 */
export function _resetDBInstance(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export async function queueScan(
  params: Omit<
    OfflineScan,
    | "idempotency_key"
    | "timestamp"
    | "status"
    | "rejection_reason"
    | "synced_at"
  >,
): Promise<string> {
  const db = await openOfflineDB();
  const idempotency_key = crypto.randomUUID();

  const record: OfflineScan = {
    ...params,
    idempotency_key,
    timestamp: Date.now(),
    status: "pending",
    rejection_reason: null,
    synced_at: null,
  };

  await db.put(STORE_NAME, record);
  return idempotency_key;
}

export async function getPendingScans(): Promise<OfflineScan[]> {
  const db = await openOfflineDB();
  const scans = await db.getAllFromIndex(STORE_NAME, "by_status", "pending");
  return scans.sort((a, b) => a.timestamp - b.timestamp);
}

export async function updateScanStatus(
  key: string,
  status: "synced" | "rejected",
  rejectionReason?: string,
): Promise<void> {
  const db = await openOfflineDB();
  const scan = await db.get(STORE_NAME, key);
  if (!scan) return;

  scan.status = status;
  if (status === "synced") {
    scan.synced_at = Date.now();
  }
  if (status === "rejected" && rejectionReason) {
    scan.rejection_reason = rejectionReason;
  }

  await db.put(STORE_NAME, scan);
}

export async function cleanupExpiredScans(
  retentionMs: number = DEFAULT_RETENTION_MS,
): Promise<number> {
  const db = await openOfflineDB();
  const cutoff = Date.now() - retentionMs;
  let deletedCount = 0;

  const tx = db.transaction(STORE_NAME, "readwrite");
  let cursor = await tx.store.index("by_timestamp").openCursor();

  while (cursor) {
    if (cursor.value.timestamp < cutoff) {
      await cursor.delete();
      deletedCount++;
    }
    cursor = await cursor.continue();
  }

  await tx.done;
  return deletedCount;
}

export async function getPendingCount(): Promise<number> {
  const db = await openOfflineDB();
  const scans = await db.getAllFromIndex(STORE_NAME, "by_status", "pending");
  return scans.length;
}

export async function getAllScans(): Promise<OfflineScan[]> {
  const db = await openOfflineDB();
  const scans = await db.getAll(STORE_NAME);
  return scans.sort((a, b) => b.timestamp - a.timestamp);
}
