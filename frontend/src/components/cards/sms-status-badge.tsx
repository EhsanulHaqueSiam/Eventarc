import { Badge } from "@/components/ui/badge";

type SMSStatus = "queued" | "sending" | "sent" | "delivered" | "failed";

const statusConfig: Record<
  SMSStatus,
  { label: string; className: string }
> = {
  queued: {
    label: "Queued",
    className: "bg-muted text-muted-foreground border-muted",
  },
  sending: {
    label: "Sending",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
  sent: {
    label: "Sent",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
  delivered: {
    label: "Delivered",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
};

interface SMSStatusBadgeProps {
  status: SMSStatus;
}

export function SMSStatusBadge({ status }: SMSStatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.queued;
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}
