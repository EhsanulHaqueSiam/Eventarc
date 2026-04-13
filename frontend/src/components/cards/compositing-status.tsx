import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ImageIcon, RefreshCw, PlayCircle } from "lucide-react";

interface CompositingProgress {
  total: number;
  done: number;
  failed: number;
}

interface CompositingStatusProps {
  eventId: string;
  onGenerate: () => void;
}

export function CompositingStatus({
  eventId,
  onGenerate,
}: CompositingStatusProps) {
  const [progress, setProgress] = useState<CompositingProgress | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const [eta, setEta] = useState<string>("");

  // Poll progress every 2 seconds when compositing is active
  useEffect(() => {
    if (!isPolling) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/v1/events/${eventId}/cards/progress`,
        );
        if (res.ok) {
          const data: CompositingProgress = await res.json();
          setProgress(data);

          // Calculate ETA
          if (data.done > 0 && data.total > 0 && startTimeRef.current) {
            const elapsed = Date.now() - startTimeRef.current;
            const remaining =
              ((data.total - data.done) * elapsed) / data.done;
            const minutes = Math.ceil(remaining / 60000);
            setEta(
              minutes > 1 ? `~${minutes} minutes remaining` : "Less than a minute remaining",
            );
          }

          // Stop polling when complete
          if (data.done + data.failed >= data.total && data.total > 0) {
            setIsPolling(false);
          }
        }
      } catch {
        // Silently fail polling — will retry
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [eventId, isPolling]);

  const handleGenerate = () => {
    startTimeRef.current = Date.now();
    setIsPolling(true);
    onGenerate();
  };

  const isComplete =
    progress && progress.total > 0 && progress.done + progress.failed >= progress.total;
  const isRunning =
    progress && progress.total > 0 && progress.done + progress.failed < progress.total;
  const hasData = progress && progress.total > 0;
  const percentDone =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  // Empty state
  if (!hasData && !isPolling) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <ImageIcon className="size-12 text-muted-foreground/40" />
        <div>
          <h3 className="font-display text-lg font-semibold">Cards not generated</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Generate composite invitation cards for all guests. This runs in the
            background and takes about 10 minutes for 60,000 guests.
          </p>
        </div>
        <Button onClick={handleGenerate}>
          <PlayCircle className="size-4" />
          Generate Cards
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="mt-1 text-[28px] font-semibold leading-tight">
              {progress?.total.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Done</p>
            <p className="mt-1 text-[28px] font-semibold leading-tight text-emerald-600">
              {progress?.done.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Failed</p>
            <p className="mt-1 text-[28px] font-semibold leading-tight text-destructive">
              {progress?.failed.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {isRunning
              ? `Generating card ${progress?.done.toLocaleString()} of ${progress?.total.toLocaleString()}...`
              : isComplete && progress?.failed === 0
                ? `${progress?.done.toLocaleString()} invitation cards generated successfully.`
                : isComplete && (progress?.failed ?? 0) > 0
                  ? `${progress?.done.toLocaleString()} generated, ${progress?.failed.toLocaleString()} failed. Retry failed cards.`
                  : ""}
          </span>
          {eta && isRunning && (
            <span className="text-xs text-muted-foreground">{eta}</span>
          )}
        </div>
        <Progress value={percentDone} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button onClick={handleGenerate} disabled={isRunning}>
          <PlayCircle className="size-4" />
          Generate Cards
        </Button>
        {(progress?.failed ?? 0) > 0 && (
          <Button variant="outline" onClick={handleGenerate} disabled={isRunning}>
            <RefreshCw className="size-4" />
            Retry Failed
          </Button>
        )}
      </div>
    </div>
  );
}
