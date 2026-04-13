import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOfflineScannerStore } from "@/stores/scanner-store";

function playRejectionAudio() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.3;

    // Descending two-tone: 440Hz -> 220Hz
    const osc1 = ctx.createOscillator();
    osc1.connect(gain);
    osc1.frequency.value = 440;
    osc1.type = "sine";
    osc1.start();
    osc1.stop(ctx.currentTime + 0.1);

    const osc2 = ctx.createOscillator();
    osc2.connect(gain);
    osc2.frequency.value = 220;
    osc2.type = "sine";
    osc2.start(ctx.currentTime + 0.1);
    osc2.stop(ctx.currentTime + 0.2);
  } catch {
    // AudioContext may not be available
  }
}

/**
 * Renders persistent toast notifications for retroactively rejected scans.
 * Mount once at the scanner root level.
 */
export function RetroactiveRejectionToast() {
  const rejections = useOfflineScannerStore((s) => s.rejections);
  const clearRejection = useOfflineScannerStore((s) => s.clearRejection);
  const shownKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const rejection of rejections) {
      if (shownKeysRef.current.has(rejection.idempotencyKey)) continue;
      shownKeysRef.current.add(rejection.idempotencyKey);

      playRejectionAudio();

      toast.custom(
        (toastId) => (
          <div
            className="w-[min(90vw,400px)] rounded-lg bg-[oklch(0.97_0.03_27)] shadow-lg"
            role="alertdialog"
            aria-live="assertive"
          >
            <div className="space-y-2 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 size-5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-foreground">
                    Scan Rejected Retroactively
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {rejection.guestName} &mdash; {rejection.reason}
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  className="h-11"
                  onClick={() => {
                    clearRejection(rejection.idempotencyKey);
                    toast.dismiss(toastId);
                    shownKeysRef.current.delete(rejection.idempotencyKey);
                  }}
                  aria-label={`Acknowledge rejected scan for ${rejection.guestName}`}
                >
                  Acknowledge
                </Button>
              </div>
            </div>
          </div>
        ),
        {
          duration: Infinity,
          id: `rejection-${rejection.idempotencyKey}`,
        },
      );
    }

    // Clean up dismissed keys that are no longer in rejections
    const currentKeys = new Set(rejections.map((r) => r.idempotencyKey));
    for (const key of shownKeysRef.current) {
      if (!currentKeys.has(key)) {
        shownKeysRef.current.delete(key);
      }
    }
  }, [rejections, clearRejection]);

  return null;
}
