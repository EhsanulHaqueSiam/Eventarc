import { useEffect, useRef } from "react";
import { useOfflineScannerStore } from "@/stores/scanner-store";

const OFFLINE_DEBOUNCE_MS = 500;
const ONLINE_DEBOUNCE_MS = 2000;
const HEALTH_RETRY_MS = 5000;
const HEALTH_TIMEOUT_MS = 3000;

export function useNetworkStatus() {
  const { networkStatus, setNetworkStatus } = useOfflineScannerStore();
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const clearAllTimers = () => {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      if (onlineTimerRef.current) {
        clearTimeout(onlineTimerRef.current);
        onlineTimerRef.current = null;
      }
      if (healthRetryTimerRef.current) {
        clearTimeout(healthRetryTimerRef.current);
        healthRetryTimerRef.current = null;
      }
    };

    const checkHealth = async (): Promise<boolean> => {
      try {
        const API_URL =
          typeof import.meta !== "undefined" &&
          import.meta.env?.VITE_GO_API_URL
            ? import.meta.env.VITE_GO_API_URL
            : "http://localhost:8080";
        const res = await fetch(`${API_URL}/api/v1/health`, {
          method: "HEAD",
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        return res.ok;
      } catch {
        return false;
      }
    };

    const handleOffline = () => {
      // Cancel any pending online transition
      if (onlineTimerRef.current) {
        clearTimeout(onlineTimerRef.current);
        onlineTimerRef.current = null;
      }
      if (healthRetryTimerRef.current) {
        clearTimeout(healthRetryTimerRef.current);
        healthRetryTimerRef.current = null;
      }

      // Debounce: wait 500ms before committing to offline
      if (!offlineTimerRef.current) {
        offlineTimerRef.current = setTimeout(() => {
          offlineTimerRef.current = null;
          setNetworkStatus("offline");
        }, OFFLINE_DEBOUNCE_MS);
      }
    };

    const attemptOnlineTransition = async () => {
      const healthy = await checkHealth();
      if (healthy) {
        setNetworkStatus("online");
      } else {
        // Health check failed, retry in 5 seconds
        healthRetryTimerRef.current = setTimeout(() => {
          healthRetryTimerRef.current = null;
          attemptOnlineTransition();
        }, HEALTH_RETRY_MS);
      }
    };

    const handleOnline = () => {
      // Cancel any pending offline transition
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }

      // Debounce: wait 2s then verify with health check
      if (!onlineTimerRef.current) {
        onlineTimerRef.current = setTimeout(() => {
          onlineTimerRef.current = null;
          attemptOnlineTransition();
        }, ONLINE_DEBOUNCE_MS);
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearAllTimers();
    };
  }, [setNetworkStatus]);

  return {
    networkStatus,
    isOffline: networkStatus === "offline",
    isSyncing: networkStatus === "syncing",
  };
}
