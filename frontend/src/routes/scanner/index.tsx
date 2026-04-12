import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
import { useDeviceSession } from "@/hooks/use-device-session";
import { useScannerStore } from "@/hooks/use-scanner";
import { useAudioFeedback } from "@/hooks/use-audio-feedback";

export const Route = createFileRoute("/scanner/")({
  component: ScannerPage,
});

function ScannerPage() {
  const { token, session, isLoading, isRevoked, createSession, clearSession } =
    useDeviceSession();

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
    stallName: string;
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
    onConfirm(token, session.stallId, session.vendorTypeId);
  }, [onConfirm, token, session.stallId, session.vendorTypeId]);

  const cameraActive = state === "idle";
  const showResultCard = state === "reviewing" || state === "confirming";
  const showFlash = state === "flash" && serverResponse;
  const showScanNext = state === "ready";

  return (
    <div className="relative flex min-h-screen flex-col bg-black">
      {/* Top bar */}
      <div
        className="fixed inset-x-0 top-0 z-30 flex h-12 items-center justify-between px-4"
        style={{ backgroundColor: "oklch(0 0 0 / 60%)" }}
      >
        <span className="truncate text-sm font-medium text-white">
          {session.stallName || "Scanning Station"}
        </span>
        <SessionStatus isConnected={navigator.onLine} />
      </div>

      {/* Camera viewfinder */}
      <div className="flex flex-1 items-center justify-center pt-12 pb-12">
        <CameraViewfinder
          onQrDetected={onQrDetected}
          isActive={cameraActive}
        />
      </div>

      {/* Bottom bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 flex h-12 items-center justify-between px-4"
        style={{ backgroundColor: "oklch(0 0 0 / 60%)" }}
      >
        <span className="text-sm text-white">Scans today: {scanCount}</span>
        <Dialog>
          <DialogTrigger className="text-sm text-white/80 hover:text-white">
            Change Station
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
    </div>
  );
}
