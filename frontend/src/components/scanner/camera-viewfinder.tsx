import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { cn } from "@/lib/utils";

interface CameraViewfinderProps {
  onQrDetected: (qrPayload: string) => void;
  isActive: boolean;
}

const VIEWFINDER_ID = "scanner-viewfinder";

export function CameraViewfinder({
  onQrDetected,
  isActive,
}: CameraViewfinderProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isRunningRef = useRef(false);
  const isActiveRef = useRef(isActive);

  // Keep isActive ref in sync
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Initialize and manage scanner lifecycle
  useEffect(() => {
    const scanner = new Html5Qrcode(VIEWFINDER_ID);
    scannerRef.current = scanner;

    const startScanner = async () => {
      if (isRunningRef.current) return;
      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 280, height: 280 },
            aspectRatio: 1,
          },
          (decodedText) => {
            if (isActiveRef.current) {
              onQrDetected(decodedText);
            }
          },
          () => {
            // QR code not found in frame -- ignore
          },
        );
        isRunningRef.current = true;
      } catch (err) {
        console.error("Failed to start QR scanner:", err);
      }
    };

    startScanner();

    return () => {
      if (isRunningRef.current) {
        scanner.stop().catch(() => {
          // Camera already released
        });
        isRunningRef.current = false;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause/resume based on isActive
  useEffect(() => {
    const scanner = scannerRef.current;
    if (!scanner || !isRunningRef.current) return;

    if (isActive) {
      scanner.resume();
    } else {
      try {
        scanner.pause();
      } catch {
        // Scanner may not be in a pauseable state
      }
    }
  }, [isActive]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="relative">
        {/* Viewfinder container */}
        <div
          id={VIEWFINDER_ID}
          className={cn(
            "size-[280px] overflow-hidden rounded-lg border-2 md:size-[320px]",
            isActive ? "border-primary" : "border-white",
          )}
        />

        {/* Animated corner brackets */}
        <div className="pointer-events-none absolute inset-0">
          {/* Top-left */}
          <div className="absolute left-0 top-0 h-8 w-8 border-l-[3px] border-t-[3px] border-white rounded-tl-lg" />
          {/* Top-right */}
          <div className="absolute right-0 top-0 h-8 w-8 border-r-[3px] border-t-[3px] border-white rounded-tr-lg" />
          {/* Bottom-left */}
          <div className="absolute bottom-0 left-0 h-8 w-8 border-b-[3px] border-l-[3px] border-white rounded-bl-lg" />
          {/* Bottom-right */}
          <div className="absolute bottom-0 right-0 h-8 w-8 border-b-[3px] border-r-[3px] border-white rounded-br-lg" />
        </div>
      </div>
    </div>
  );
}
