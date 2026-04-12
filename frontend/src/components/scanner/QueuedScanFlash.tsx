import { useEffect, useRef } from "react";

interface QueuedScanFlashProps {
  onComplete: () => void;
}

const FLASH_DURATION = 1000;
const AUDIO_FREQUENCY = 330;
const AUDIO_DURATION_MS = 150;

export function QueuedScanFlash({ onComplete }: QueuedScanFlashProps) {
  const audioPlayed = useRef(false);

  useEffect(() => {
    // Play neutral 330Hz tone once
    if (!audioPlayed.current) {
      audioPlayed.current = true;
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = AUDIO_FREQUENCY;
        osc.type = "sine";
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(ctx.currentTime + AUDIO_DURATION_MS / 1000);
      } catch {
        // AudioContext may not be available in all contexts
      }
    }

    const timer = setTimeout(onComplete, FLASH_DURATION);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-100"
      style={{ backgroundColor: "oklch(0.82 0.17 85 / 90%)" }}
      role="status"
      aria-live="assertive"
    >
      <span
        className="font-semibold tracking-wide text-white"
        style={{ fontSize: "36px" }}
      >
        QUEUED
      </span>
    </div>
  );
}
