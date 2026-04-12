import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useOfflineScannerStore } from "@/stores/scanner-store";

interface PendingBadgeProps {
  onClick: () => void;
}

export function PendingBadge({ onClick }: PendingBadgeProps) {
  const pendingCount = useOfflineScannerStore((s) => s.pendingCount);

  if (pendingCount <= 0) return null;

  const label =
    pendingCount === 1 ? "1 scan pending" : `${pendingCount} scans pending`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="animate-[pulse-scale_3s_ease-in-out_infinite]"
      style={{
        minWidth: "44px",
        minHeight: "44px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px",
      }}
      aria-label={`${pendingCount} scans pending sync`}
    >
      <Badge
        variant="outline"
        className="gap-1 border-[oklch(0.82_0.17_85)] bg-[oklch(0.82_0.17_85_/_0.2)] text-[oklch(0.25_0.05_85)]"
      >
        <Clock className="size-3.5" aria-hidden="true" />
        <span className="text-xs">{label}</span>
      </Badge>
      <style>{`
        @keyframes pulse-scale {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </button>
  );
}
