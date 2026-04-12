import { AlertTriangle, AlertCircle, Info } from "lucide-react";

interface AlertFeedItemProps {
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  timestamp: string; // formatted time string
}

const severityConfig = {
  critical: { icon: AlertTriangle, color: "text-destructive" },
  warning: { icon: AlertCircle, color: "text-warning" },
  info: { icon: Info, color: "text-muted-foreground" },
};

export function AlertFeedItem({
  type: _type,
  severity,
  title,
  detail,
  timestamp,
}: AlertFeedItemProps) {
  const config = severityConfig[severity];
  const Icon = config.icon;

  return (
    <div className="animate-in slide-in-from-top-2 space-y-0.5 border-b border-border py-3 last:border-0">
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 size-3.5 shrink-0 ${config.color}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm">{title}</p>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {timestamp}
            </span>
          </div>
          {detail && (
            <p className="text-xs text-muted-foreground">{detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}
