import { useEffect, useRef } from "react";
import {
  getPendingScans,
  updateScanStatus,
  cleanupExpiredScans,
  getPendingCount,
  type OfflineScan,
} from "@/lib/offline-queue";
import { useOfflineScannerStore } from "@/stores/scanner-store";

const SYNC_TIMEOUT_MS = 10000; // 10 seconds per scan

/**
 * Standalone sync function for direct testing.
 * Processes pending scans sequentially in timestamp order.
 */
export async function syncOfflineScans(
  getSessionToken: () => string,
  onSynced: (key: string) => void,
  onRejected: (key: string, reason: string, scan: OfflineScan) => void,
  onProgress: (progress: {
    total: number;
    completed: number;
    failed: number;
  }) => void,
  onNetworkError: () => void,
): Promise<void> {
  const scans = await getPendingScans();
  if (scans.length === 0) return;

  const progress = { total: scans.length, completed: 0, failed: 0 };

  const API_URL =
    typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_API_URL || import.meta.env?.VITE_GO_API_URL)
      ? (import.meta.env.VITE_API_URL ?? import.meta.env.VITE_GO_API_URL)
      : "http://localhost:8080";

  for (const scan of scans) {
    const endpoint =
      scan.scan_type === "entry"
        ? `${API_URL}/api/v1/scan/entry`
        : `${API_URL}/api/v1/scan/food`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getSessionToken()}`,
        },
        body: JSON.stringify({
          qr_payload: scan.scan_payload,
        }),
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });

      if (response.ok) {
        await updateScanStatus(scan.idempotency_key, "synced");
        progress.completed++;
        onSynced(scan.idempotency_key);
      } else if (
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 409 ||
        response.status === 422
      ) {
        const errorData = (await response.json()) as {
          error?: { message?: string };
        };
        const reason =
          errorData?.error?.message ?? "Scan rejected by server";
        await updateScanStatus(
          scan.idempotency_key,
          "rejected",
          reason,
        );
        progress.failed++;
        onRejected(scan.idempotency_key, reason, scan);
      } else {
        // Server error -- stop sync, retry on next reconnect
        onNetworkError();
        break;
      }
    } catch (error) {
      console.error(`Offline sync failed for scan ${scan.idempotency_key}:`, error);
      onNetworkError();
      break;
    }

    onProgress({ ...progress });
  }

  // Cleanup expired scans after sync
  await cleanupExpiredScans();
}

/**
 * React hook that triggers sync when network transitions to online.
 * Mount once at the scanner root component.
 */
export function useOfflineSync() {
  const {
    networkStatus,
    setNetworkStatus,
    setSyncProgress,
    addRejection,
    setPendingCount,
  } = useOfflineScannerStore();
  const prevStatusRef = useRef(networkStatus);
  const syncingRef = useRef(false);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = networkStatus;

    // Trigger sync when transitioning to 'online' from 'offline'
    if (
      networkStatus === "online" &&
      (prevStatus === "offline" || prevStatus === "syncing") &&
      !syncingRef.current
    ) {
      const runSync = async () => {
        const count = await getPendingCount();
        if (count === 0) return;

        syncingRef.current = true;
        setNetworkStatus("syncing");

        const storedSession = localStorage.getItem("eventarc_scanner_session");
        let sessionToken = "";
        if (storedSession) {
          try {
            sessionToken = JSON.parse(storedSession).token ?? "";
          } catch {
            sessionToken = storedSession;
          }
        }
        if (!sessionToken) {
          console.error("Cannot sync offline scans: no session token available");
          setNetworkStatus("offline");
          syncingRef.current = false;
          return;
        }

        await syncOfflineScans(
          () => sessionToken,
          () => {
            // onSynced: state already updated in IndexedDB
          },
          (_key, reason, scan) => {
            addRejection({
              guestName: scan.guest_name,
              reason,
              scanType: scan.scan_type,
              idempotencyKey: scan.idempotency_key,
            });
          },
          (progress) => {
            setSyncProgress(progress);
          },
          () => {
            // onNetworkError: go back to offline
            setNetworkStatus("offline");
          },
        );

        // Sync complete
        syncingRef.current = false;
        const finalCount = await getPendingCount();
        setPendingCount(finalCount);
        setSyncProgress(null);

        // Only set online if we didn't fall back to offline during sync
        if (useOfflineScannerStore.getState().networkStatus === "syncing") {
          setNetworkStatus("online");
        }
      };

      runSync();
    }
  }, [
    networkStatus,
    setNetworkStatus,
    setSyncProgress,
    addRejection,
    setPendingCount,
  ]);

  return {
    isSyncing: networkStatus === "syncing",
  };
}
