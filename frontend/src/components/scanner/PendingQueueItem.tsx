import { User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OfflineScan } from "@/lib/offline-queue";

interface PendingQueueItemProps {
  scan: OfflineScan;
}

function relativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${diffSec} sec ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function StatusBadge({ status }: { status: OfflineScan["status"] }) {
  switch (status) {
    case "pending":
      return (
        <Badge
          variant="outline"
          className="border-[oklch(0.82_0.17_85)] text-[oklch(0.25_0.05_85)]"
        >
          Pending
        </Badge>
      );
    case "synced":
      return (
        <Badge
          variant="outline"
          className="border-[oklch(0.72_0.19_142)] text-[oklch(0.72_0.19_142)]"
        >
          Synced
        </Badge>
      );
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return null;
  }
}

export function PendingQueueItem({ scan }: PendingQueueItemProps) {
  return (
    <div
      className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-3"
      aria-label={`${scan.guest_name}, ${scan.scan_type}, ${scan.status}`}
    >
      <User
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base text-foreground">{scan.guest_name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {scan.scan_type === "entry" ? "Entry" : "Food"} scan &mdash; queued{" "}
          {relativeTime(scan.timestamp)}
        </p>
      </div>
      <StatusBadge status={scan.status} />
    </div>
  );
}
