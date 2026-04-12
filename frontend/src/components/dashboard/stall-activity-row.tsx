interface StallActivityRowProps {
  stallName: string;
  status: "active" | "idle" | "inactive";
  rate: string; // e.g., "12/min"
  lastScan: string; // formatted time string
}

const statusColors: Record<string, string> = {
  active: "bg-success",
  idle: "bg-warning",
};

export function StallActivityRow({
  stallName,
  status,
  rate,
  lastScan,
}: StallActivityRowProps) {
  const dotClass =
    status === "inactive"
      ? "size-2 rounded-full border border-muted-foreground"
      : `size-2 rounded-full ${statusColors[status]}`;

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span
        className={dotClass}
        aria-label={status.charAt(0).toUpperCase() + status.slice(1)}
      />
      <span className="flex-1 truncate text-sm">{stallName}</span>
      <span className="font-mono text-xs text-muted-foreground">{rate}</span>
      <span className="font-mono text-xs text-muted-foreground">
        {lastScan}
      </span>
    </div>
  );
}
