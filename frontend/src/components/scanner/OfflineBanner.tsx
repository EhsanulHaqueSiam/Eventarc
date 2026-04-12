import { WifiOff } from "lucide-react";
import { useOfflineScannerStore } from "@/stores/scanner-store";

export function OfflineBanner() {
  const networkStatus = useOfflineScannerStore((s) => s.networkStatus);

  if (networkStatus !== "offline") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-0 right-0 z-40 flex h-9 items-center justify-center gap-2 animate-in slide-in-from-top duration-200"
      style={{
        top: "var(--scanner-top-bar-height, 48px)",
        backgroundColor: "oklch(0.82 0.17 85)",
        color: "oklch(0.25 0.05 85)",
      }}
    >
      <WifiOff className="size-4" aria-hidden="true" />
      <span className="text-sm font-normal">
        Offline &mdash; scans will be queued
      </span>
    </div>
  );
}
