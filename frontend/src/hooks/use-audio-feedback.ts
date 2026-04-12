import { useRef, useCallback } from "react";
import { AUDIO_CUES, type AudioCueType } from "@/lib/scanner-audio";

export function useAudioFeedback() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const ensureContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback(
    (frequency: number, duration: number) => {
      const ctx = ensureContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = frequency;
      osc.type = "sine";
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);
    },
    [ensureContext],
  );

  const play = useCallback(
    (type: AudioCueType) => {
      const cue = AUDIO_CUES[type];
      cue.tones.forEach((tone, i) => {
        const delayMs = i * (cue.delay + cue.tones[0].dur);
        if (delayMs === 0) {
          playTone(tone.freq, tone.dur);
        } else {
          setTimeout(() => playTone(tone.freq, tone.dur), delayMs);
        }
      });
    },
    [playTone],
  );

  const playSuccess = useCallback(() => play("success"), [play]);
  const playFailure = useCallback(() => play("failure"), [play]);
  const playDuplicate = useCallback(() => play("duplicate"), [play]);

  return { play, playSuccess, playFailure, playDuplicate };
}
