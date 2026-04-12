import type { ScanOutcome, ServerResponse } from "@/hooks/use-scanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface ScanResultCardProps {
  outcome: ScanOutcome | null;
  serverResponse: ServerResponse | null;
  qrPayload: string;
  isConfirming: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

const outcomeConfig: Record<
  ScanOutcome,
  {
    icon: typeof CheckCircle;
    iconColor: string;
    borderColor: string;
    heading: string;
  }
> = {
  allowed: {
    icon: CheckCircle,
    iconColor: "text-[oklch(0.72_0.19_142)]",
    borderColor: "border-l-[oklch(0.72_0.19_142)]",
    heading: "Entry Allowed",
  },
  served: {
    icon: CheckCircle,
    iconColor: "text-[oklch(0.72_0.19_142)]",
    borderColor: "border-l-[oklch(0.72_0.19_142)]",
    heading: "Food Served",
  },
  denied: {
    icon: XCircle,
    iconColor: "text-destructive",
    borderColor: "border-l-destructive",
    heading: "Scan Rejected",
  },
  duplicate_entry: {
    icon: AlertTriangle,
    iconColor: "text-[oklch(0.82_0.17_85)]",
    borderColor: "border-l-[oklch(0.82_0.17_85)]",
    heading: "Already Checked In",
  },
  duplicate_food: {
    icon: AlertTriangle,
    iconColor: "text-[oklch(0.82_0.17_85)]",
    borderColor: "border-l-[oklch(0.82_0.17_85)]",
    heading: "Already Served",
  },
};

function ResultBody({
  outcome,
  response,
}: {
  outcome: ScanOutcome;
  response: ServerResponse;
}) {
  switch (outcome) {
    case "allowed":
      return (
        <p className="text-base text-foreground">
          {response.guestName ?? "Guest"} &mdash;{" "}
          {response.guestCategory ?? ""}
        </p>
      );
    case "served":
      return (
        <div className="space-y-1">
          <p className="text-base text-foreground">
            {response.guestName ?? "Guest"} &mdash;{" "}
            {response.foodCategory ?? ""}
          </p>
          {response.used !== undefined && response.limit !== undefined && (
            <p className="text-sm text-muted-foreground">
              {response.used}/{response.limit} used
              {response.remaining !== undefined &&
                ` (${response.remaining} remaining)`}
            </p>
          )}
        </div>
      );
    case "denied":
      return (
        <p className="text-base text-foreground">
          {response.reason ?? "Scan rejected"}
        </p>
      );
    case "duplicate_entry":
      return (
        <div className="space-y-1">
          <p className="text-base text-foreground">
            {response.guestName ?? "Guest"}
          </p>
          {response.originalCheckIn && (
            <p className="text-sm text-muted-foreground">
              Checked in at {response.originalCheckIn.time} via{" "}
              {response.originalCheckIn.stall}
            </p>
          )}
        </div>
      );
    case "duplicate_food":
      return (
        <div className="space-y-1">
          <p className="text-base text-foreground">
            {response.guestName ?? "Guest"} &mdash;{" "}
            {response.foodCategory ?? ""}
          </p>
          {response.used !== undefined && response.limit !== undefined && (
            <p className="text-sm text-muted-foreground">
              Limit reached ({response.used}/{response.limit})
            </p>
          )}
          {response.consumptionHistory &&
            response.consumptionHistory.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Last served at{" "}
                {response.consumptionHistory[response.consumptionHistory.length - 1].stall}{" "}
                at{" "}
                {response.consumptionHistory[response.consumptionHistory.length - 1].time}
              </p>
            )}
        </div>
      );
    default:
      return null;
  }
}

export function ScanResultCard({
  outcome,
  serverResponse,
  qrPayload,
  isConfirming,
  onConfirm,
  onDismiss,
}: ScanResultCardProps) {
  // Pre-confirm state: show QR data with Confirm/Dismiss
  if (!outcome || !serverResponse) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
        <Card
          className="w-[min(90vw,400px)] max-h-[70vh] overflow-auto border-l-4 border-l-primary shadow-lg"
          role="alertdialog"
          aria-labelledby="scan-result-heading"
          aria-describedby="scan-result-body"
        >
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="size-6 text-primary" />
              <h3
                id="scan-result-heading"
                className="text-2xl font-semibold leading-tight"
              >
                QR Scanned
              </h3>
            </div>
            <p id="scan-result-body" className="text-sm text-muted-foreground">
              Confirm to process this scan, or dismiss to cancel.
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {qrPayload.substring(0, 40)}
              {qrPayload.length > 40 ? "..." : ""}
            </p>
            <div className="flex gap-3 pt-2" style={{ minHeight: "80px" }}>
              <Button
                variant="secondary"
                className="h-14 flex-1 text-base"
                onClick={onDismiss}
                disabled={isConfirming}
                aria-label="Dismiss scan"
              >
                Dismiss
              </Button>
              <Button
                className="h-14 flex-1 text-base"
                onClick={onConfirm}
                disabled={isConfirming}
                aria-label="Confirm scan"
              >
                {isConfirming ? "Processing..." : "Confirm"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Post-confirm state: show server response
  const config = outcomeConfig[outcome];
  const Icon = config.icon;
  const guestName = serverResponse.guestName ?? "Guest";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <Card
        className={`w-[min(90vw,400px)] max-h-[70vh] overflow-auto border-l-4 ${config.borderColor} shadow-lg`}
        role="alertdialog"
        aria-labelledby="scan-result-heading"
        aria-describedby="scan-result-body"
      >
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <Icon className={`size-6 ${config.iconColor}`} />
            <h3
              id="scan-result-heading"
              className="text-2xl font-semibold leading-tight"
            >
              {config.heading}
            </h3>
          </div>
          <div id="scan-result-body">
            <ResultBody outcome={outcome} response={serverResponse} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
