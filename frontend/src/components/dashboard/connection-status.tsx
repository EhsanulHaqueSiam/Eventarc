import type { SSEConnectionStatus } from "@/hooks/use-sse";

interface ConnectionStatusProps {
  status: SSEConnectionStatus;
  lastEventTime: Date | null;
}

const statusConfig: Record<
  SSEConnectionStatus,
  { label: string; dotClass: string }
> = {
  connecting: {
    label: "Connecting...",
    dotClass: "bg-warning animate-pulse",
  },
  connected: { label: "Connected via SSE", dotClass: "bg-success" },
  reconnecting: {
    label: "Reconnecting...",
    dotClass: "bg-warning animate-pulse",
  },
  disconnected: {
    label: "Connection lost -- retrying",
    dotClass: "bg-destructive",
  },
};

export function ConnectionStatus({
  status,
  lastEventTime,
}: ConnectionStatusProps) {
  const config = statusConfig[status];
  const timeSince = lastEventTime ? formatTimeSince(lastEventTime) : null;

  return (
    <div className="flex items-center justify-between rounded-md border bg-card px-4 py-2">
      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${config.dotClass}`}
          aria-hidden="true"
        />
        <span
          className="text-sm"
          aria-label={`Connection status: ${config.label}`}
        >
          {config.label}
        </span>
      </div>
      {timeSince && (
        <span className="font-mono text-xs text-muted-foreground">
          Last update: {timeSince}
        </span>
      )}
    </div>
  );
}

function formatTimeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
}
