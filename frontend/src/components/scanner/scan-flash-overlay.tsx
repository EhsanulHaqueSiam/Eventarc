import { useEffect } from "react";
import type { ScanOutcome } from "@/hooks/use-scanner";

interface ScanFlashOverlayProps {
  outcome: ScanOutcome | null;
  onComplete: () => void;
}

const FLASH_DURATION = 1000;

const overlayConfig: Record<
  ScanOutcome,
  { bg: string; text: string; textColor: string }
> = {
  allowed: {
    bg: "oklch(0.72 0.19 142 / 90%)",
    text: "ALLOWED",
    textColor: "white",
  },
  served: {
    bg: "oklch(0.72 0.19 142 / 90%)",
    text: "SERVED",
    textColor: "white",
  },
  denied: {
    bg: "oklch(0.577 0.245 27.325 / 90%)",
    text: "DENIED",
    textColor: "white",
  },
  duplicate_entry: {
    bg: "oklch(0.82 0.17 85 / 90%)",
    text: "ALREADY IN",
    textColor: "oklch(0.25 0.05 85)",
  },
  duplicate_food: {
    bg: "oklch(0.82 0.17 85 / 90%)",
    text: "ALREADY SERVED",
    textColor: "oklch(0.25 0.05 85)",
  },
  network_error: {
    bg: "oklch(0.75 0.15 55 / 90%)",
    text: "NO CONNECTION",
    textColor: "oklch(0.25 0.1 55)",
  },
};

export function ScanFlashOverlay({
  outcome,
  onComplete,
}: ScanFlashOverlayProps) {
  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(onComplete, FLASH_DURATION);
    return () => clearTimeout(timer);
  }, [outcome, onComplete]);

  if (!outcome) return null;

  const config = overlayConfig[outcome];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-100"
      style={{ backgroundColor: config.bg }}
      role="status"
      aria-live="assertive"
    >
      <span
        className="text-4xl font-semibold tracking-wide"
        style={{ color: config.textColor, fontSize: "36px" }}
      >
        {config.text}
      </span>
    </div>
  );
}
