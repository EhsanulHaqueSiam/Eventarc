export const AUDIO_CUES = {
  success: {
    tones: [
      { freq: 440, dur: 100 },
      { freq: 660, dur: 100 },
    ],
    delay: 100,
  },
  failure: {
    tones: [
      { freq: 440, dur: 100 },
      { freq: 220, dur: 100 },
    ],
    delay: 100,
  },
  duplicate: {
    tones: [{ freq: 440, dur: 150 }],
    delay: 0,
  },
} as const;

export type AudioCueType = keyof typeof AUDIO_CUES;
