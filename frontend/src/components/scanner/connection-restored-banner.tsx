import { Wifi, Loader2 } from "lucide-react";
import { useOfflineScannerStore } from "@/stores/scanner-store";

export function ConnectionRestoredBanner() {
  const networkStatus = useOfflineScannerStore((s) => s.networkStatus);
  const syncProgress = useOfflineScannerStore((s) => s.syncProgress);

  if (networkStatus !== "syncing") return null;

  const remaining = syncProgress
    ? syncProgress.total - syncProgress.completed - syncProgress.failed
    : 0;
  const displayCount = syncProgress ? syncProgress.total : remaining;

  return (
    <div
      aria-live="polite"
      className="fixed left-0 right-0 z-40 flex h-9 items-center justify-center gap-2 animate-in slide-in-from-top duration-200"
      style={{
        top: "var(--scanner-top-bar-height, 48px)",
        backgroundColor: "oklch(0.72 0.19 142)",
        color: "oklch(0.98 0.02 142)",
      }}
    >
      <Wifi className="size-4" aria-hidden="true" />
      <span className="text-sm font-normal">
        Back online &mdash; syncing {displayCount} scans
      </span>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
    </div>
  );
}
