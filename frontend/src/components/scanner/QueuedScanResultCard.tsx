import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { queueScan, getPendingCount } from "@/lib/offline-queue";
import { useOfflineScannerStore } from "@/stores/scanner-store";

interface QueuedScanResultCardProps {
  guestName: string;
  guestCategory: string;
  scanPayload: string;
  scanType: "entry" | "food";
  stallId: string;
  eventId: string;
  onQueued: () => void;
  onDismiss: () => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function QueuedScanResultCard({
  guestName,
  guestCategory,
  scanPayload,
  scanType,
  stallId,
  eventId,
  onQueued,
  onDismiss,
}: QueuedScanResultCardProps) {
  const setPendingCount = useOfflineScannerStore((s) => s.setPendingCount);

  const handleQueueScan = async () => {
    await queueScan({
      scan_payload: scanPayload,
      scan_type: scanType,
      stall_id: stallId,
      event_id: eventId,
      guest_name: guestName,
      guest_category: guestCategory,
    });

    const count = await getPendingCount();
    setPendingCount(count);
    onQueued();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <Card
        className="w-[min(90vw,400px)] max-h-[70vh] overflow-auto shadow-lg"
        style={{ borderLeft: "4px solid oklch(0.82 0.17 85)" }}
        role="alertdialog"
        aria-labelledby="queued-scan-heading"
        aria-describedby="queued-scan-body"
      >
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <Clock
              className="size-6"
              style={{ color: "oklch(0.82 0.17 85)" }}
              aria-hidden="true"
            />
            <h3
              id="queued-scan-heading"
              className="text-2xl font-semibold leading-tight"
            >
              Scan Queued
            </h3>
          </div>

          <div id="queued-scan-body" className="space-y-1">
            <p className="text-base text-foreground">
              Will validate when back online
            </p>
            <p className="text-base text-foreground">
              {guestName} &mdash; {guestCategory}
            </p>
            <p className="text-sm text-muted-foreground">
              Queued at {formatTime(new Date())}
            </p>
          </div>

          <div className="flex gap-3 pt-2" style={{ minHeight: "80px" }}>
            <Button
              variant="secondary"
              className="h-14 flex-1 text-base"
              onClick={onDismiss}
              aria-label="Dismiss scan"
            >
              Dismiss
            </Button>
            <Button
              className="h-14 flex-1 text-base"
              onClick={handleQueueScan}
              aria-label="Queue scan for later sync"
            >
              Queue Scan
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
