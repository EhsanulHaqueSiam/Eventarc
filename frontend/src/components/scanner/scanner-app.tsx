import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { ScannerSetup } from "@/components/scanner/scanner-setup";
import { CameraViewfinder } from "@/components/scanner/camera-viewfinder";
import { ScanFlashOverlay } from "@/components/scanner/scan-flash-overlay";
import { ScanResultCard } from "@/components/scanner/scan-result-card";
import { ScanNextCard } from "@/components/scanner/scan-next-card";
import { SessionRevoked } from "@/components/scanner/session-revoked";
import { SessionStatus } from "@/components/scanner/session-status";
import { OfflineBanner } from "@/components/scanner/offline-banner";
import { PendingQueuePanel } from "@/components/scanner/pending-queue-panel";
import { RetroactiveRejectionToast } from "@/components/scanner/retroactive-rejection-toast";
import { useDeviceSession } from "@/hooks/use-device-session";
import { useScannerStore } from "@/hooks/use-scanner";
import { useAudioFeedback } from "@/hooks/use-audio-feedback";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { getPendingCount } from "@/lib/offline-queue";
import { useOfflineScannerStore } from "@/stores/scanner-store";

export function ScannerApp({ fixedEventId }: { fixedEventId?: string }) {
  const { token, session, isLoading, isRevoked, createSession, clearSession } =
    useDeviceSession(fixedEventId);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <Skeleton className="mx-auto h-8 w-48" />
          <Skeleton className="mx-auto h-4 w-32" />
        </div>
      </div>
    );
  }

  if (isRevoked) {
    return <SessionRevoked onSelectNewStation={clearSession} />;
  }

  if (!token || !session) {
    return (
      <ScannerSetup
        fixedEventId={fixedEventId}
        onSessionCreated={() => {
          // Session created, component will re-render with token
        }}
        createSession={createSession}
      />
    );
  }

  return <ActiveScanner session={session} token={token} onChangeStation={clearSession} />;
}

function ActiveScanner({
  session,
  token,
  onChangeStation,
}: {
  session: {
    stallId: string;
    eventId: string;
    vendorCategoryId: string;
    vendorTypeId: string;
    vendorType: "entry" | "food";
    stallName: string;
    eventName?: string;
  };
  token: string;
  onChangeStation: () => void;
}) {
  const state = useScannerStore((s) => s.state);
  const scanResult = useScannerStore((s) => s.scanResult);
  const serverResponse = useScannerStore((s) => s.serverResponse);
  const scanCount = useScannerStore((s) => s.scanCount);
  const onQrDetected = useScannerStore((s) => s.onQrDetected);
  const onConfirm = useScannerStore((s) => s.onConfirm);
  const onDismiss = useScannerStore((s) => s.onDismiss);
  const onFlashComplete = useScannerStore((s) => s.onFlashComplete);
  const onScanNext = useScannerStore((s) => s.onScanNext);

  const { playSuccess, playFailure, playDuplicate } = useAudioFeedback();
  const { networkStatus } = useNetworkStatus();
  useOfflineSync();
  const pendingCount = useOfflineScannerStore((s) => s.pendingCount);
  const setPendingCount = useOfflineScannerStore((s) => s.setPendingCount);
  const [pendingPanelOpen, setPendingPanelOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getPendingCount()
      .then((count) => {
        if (mounted) {
          setPendingCount(count);
        }
      })
      .catch(() => {
        // Silently ignore — count will refresh on next scan
      });
    return () => {
      mounted = false;
    };
  }, [setPendingCount]);

  // Play audio cue when flash starts
  useEffect(() => {
    if (state === "flash" && serverResponse) {
      switch (serverResponse.outcome) {
        case "allowed":
        case "served":
          playSuccess();
          break;
        case "denied":
          playFailure();
          break;
        case "duplicate_entry":
        case "duplicate_food":
        case "network_error":
          playDuplicate();
          break;
      }
    }
  }, [state, serverResponse, playSuccess, playFailure, playDuplicate]);

  const handleConfirm = useCallback(() => {
    onConfirm(
      token,
      session.eventId,
      session.stallId,
      session.vendorType,
      session.vendorCategoryId,
    );
  }, [
    onConfirm,
    token,
    session.eventId,
    session.stallId,
    session.vendorType,
    session.vendorCategoryId,
  ]);

  const cameraActive = state === "idle";
  const showResultCard = state === "reviewing" || state === "confirming";
  const showFlash = state === "flash" && serverResponse;
  const showScanNext = state === "ready";

  return (
    <div className="relative flex min-h-screen flex-col bg-black">
      {/* Top bar — station info + connection status */}
      <div className="fixed inset-x-0 top-0 z-30 bg-black/80 backdrop-blur-sm">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="min-w-0 flex-1">
            {session.eventName && (
              <p className="truncate text-xs font-medium text-white/70">
                {session.eventName}
              </p>
            )}
            <p className="truncate font-display text-base font-semibold text-white">
              {session.stallName || "Scanning Station"}
            </p>
            <p className="text-xs text-white/50">
              {session.vendorType === "entry" ? "Entry Gate" : "Food Stall"}
            </p>
          </div>
          <SessionStatus isConnected={networkStatus !== "offline"} />
        </div>
      </div>
      <OfflineBanner />

      {/* Camera viewfinder */}
      <div className="flex flex-1 items-center justify-center pt-14 pb-28">
        {cameraError ? (
          <CameraErrorState
            message={cameraError}
            onRetry={() => setCameraError(null)}
          />
        ) : (
          <CameraViewfinder
            onQrDetected={onQrDetected}
            onError={(msg) => setCameraError(msg)}
            isActive={cameraActive}
          />
        )}
      </div>

      {/* Bottom panel — scan count + actions */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-black/80 backdrop-blur-sm">
        {/* Stats row */}
        <div className="flex items-center justify-center gap-6 border-t border-white/10 px-4 py-2">
          <div className="text-center">
            <p className="font-display text-xl font-semibold text-white">{scanCount}</p>
            <p className="text-[10px] uppercase tracking-wider text-white/40">Scans</p>
          </div>
          {pendingCount > 0 && (
            <div className="text-center">
              <p className="font-display text-xl font-semibold text-warning">{pendingCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/40">Pending</p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-4 pb-4 pt-1">
          {pendingCount > 0 && (
            <Button
              variant="outline"
              className="h-11 flex-1 border-white/20 bg-white/5 text-sm text-white hover:bg-white/10"
              onClick={() => setPendingPanelOpen(true)}
            >
              View Pending
            </Button>
          )}
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className={`h-11 border-white/20 bg-white/5 text-sm text-white hover:bg-white/10 ${pendingCount > 0 ? "flex-1" : "w-full"}`}
              >
                Change Station
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Change station?</DialogTitle>
                <DialogDescription>
                  You will need to select a new scanning station to continue.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button onClick={onChangeStation}>Change Station</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Flash overlay */}
      {showFlash && (
        <ScanFlashOverlay
          outcome={serverResponse.outcome}
          onComplete={onFlashComplete}
        />
      )}

      {/* Result card (pre-confirm: reviewing/confirming) */}
      {showResultCard && (
        <ScanResultCard
          scanType={session.vendorType}
          outcome={serverResponse?.outcome ?? null}
          serverResponse={serverResponse}
          qrPayload={scanResult?.qrPayload ?? ""}
          isConfirming={state === "confirming"}
          onConfirm={handleConfirm}
          onDismiss={onDismiss}
        />
      )}

      {/* Scan next card */}
      {showScanNext && (
        <ScanNextCard
          wasConfirmed={serverResponse !== null}
          onScanNext={onScanNext}
        />
      )}

      <PendingQueuePanel
        open={pendingPanelOpen}
        onClose={() => setPendingPanelOpen(false)}
      />
      <RetroactiveRejectionToast />
    </div>
  );
}

function CameraErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5 px-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-white/10">
        <Camera className="size-8 text-white/70" />
      </div>
      <div>
        <h2 className="font-display text-lg font-semibold text-white">
          Camera access required
        </h2>
        <p className="mt-2 max-w-[280px] text-sm leading-relaxed text-white/60">
          {message.includes("NotAllowed") || message.includes("Permission")
            ? "Allow camera access in your browser settings, then tap Retry."
            : `Camera error: ${message}`}
        </p>
      </div>
      <Button
        className="h-12 w-full max-w-[280px] text-base"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}
