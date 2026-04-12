import { useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getAllScans, type OfflineScan } from "@/lib/offline-queue";
import { useOfflineScannerStore } from "@/stores/scanner-store";
import { PendingQueueItem } from "./PendingQueueItem";

interface PendingQueuePanelProps {
  open: boolean;
  onClose: () => void;
}

export function PendingQueuePanel({ open, onClose }: PendingQueuePanelProps) {
  const [scans, setScans] = useState<OfflineScan[]>([]);
  const networkStatus = useOfflineScannerStore((s) => s.networkStatus);

  const loadScans = useCallback(async () => {
    const allScans = await getAllScans();
    setScans(allScans);
  }, []);

  useEffect(() => {
    if (!open) return;

    loadScans();

    // Refresh every 2 seconds during sync for live updates
    if (networkStatus === "syncing") {
      const interval = setInterval(loadScans, 2000);
      return () => clearInterval(interval);
    }
  }, [open, networkStatus, loadScans]);

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md animate-in slide-in-from-bottom duration-200"
        style={{ maxHeight: "60vh" }}
        role="dialog"
        aria-labelledby="pending-queue-heading"
      >
        <div className="rounded-t-xl border-t border-border bg-card shadow-xl">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1 w-8 rounded-full bg-muted-foreground/40" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pb-3">
            <div>
              <h2
                id="pending-queue-heading"
                className="text-2xl font-semibold leading-tight"
              >
                Pending Scans
              </h2>
              <p className="text-sm text-muted-foreground">
                {scans.length > 0
                  ? `${scans.filter((s) => s.status === "pending").length} scans will sync when online`
                  : "No pending scans"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label="Close pending scans panel"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Content */}
          <ScrollArea style={{ maxHeight: "calc(60vh - 120px)" }}>
            {scans.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                No pending scans
              </div>
            ) : (
              <div>
                {scans.map((scan) => (
                  <PendingQueueItem
                    key={scan.idempotency_key}
                    scan={scan}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </>
  );
}
