import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAudioFeedback } from "./use-audio-feedback";

// Mock Web Audio API
const mockStop = vi.fn();
const mockStart = vi.fn();
const mockConnect = vi.fn();

const mockOscillator = {
  connect: mockConnect,
  frequency: { value: 0 },
  type: "sine" as OscillatorType,
  start: mockStart,
  stop: mockStop,
};

const mockGainNode = {
  connect: mockConnect,
  gain: { value: 0 },
};

const mockResume = vi.fn().mockResolvedValue(undefined);
const mockCreateOscillator = vi.fn(() => ({ ...mockOscillator }));
const mockCreateGain = vi.fn(() => ({ ...mockGainNode }));

class MockAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = mockResume;
  createOscillator = mockCreateOscillator;
  createGain = mockCreateGain;
}

// @ts-expect-error -- mock AudioContext
globalThis.AudioContext = MockAudioContext;

describe("useAudioFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("playSuccess creates oscillators with rising frequencies (440Hz + 660Hz)", () => {
    const { result } = renderHook(() => useAudioFeedback());

    act(() => {
      result.current.playSuccess();
    });

    // First tone at 440Hz played immediately
    expect(mockCreateOscillator).toHaveBeenCalledTimes(1);
    const firstOsc = mockCreateOscillator.mock.results[0].value;
    expect(firstOsc.frequency.value).toBe(440);

    // Second tone at 660Hz after delay
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(mockCreateOscillator).toHaveBeenCalledTimes(2);
    const secondOsc = mockCreateOscillator.mock.results[1].value;
    expect(secondOsc.frequency.value).toBe(660);

    vi.useRealTimers();
  });

  it("playFailure creates oscillators with descending frequencies (440Hz + 220Hz)", () => {
    const { result } = renderHook(() => useAudioFeedback());

    act(() => {
      result.current.playFailure();
    });

    expect(mockCreateOscillator).toHaveBeenCalledTimes(1);
    const firstOsc = mockCreateOscillator.mock.results[0].value;
    expect(firstOsc.frequency.value).toBe(440);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(mockCreateOscillator).toHaveBeenCalledTimes(2);
    const secondOsc = mockCreateOscillator.mock.results[1].value;
    expect(secondOsc.frequency.value).toBe(220);

    vi.useRealTimers();
  });

  it("playDuplicate creates single tone at 440Hz", () => {
    const { result } = renderHook(() => useAudioFeedback());

    act(() => {
      result.current.playDuplicate();
    });

    expect(mockCreateOscillator).toHaveBeenCalledTimes(1);
    const osc = mockCreateOscillator.mock.results[0].value;
    expect(osc.frequency.value).toBe(440);

    vi.useRealTimers();
  });

  it("resumes AudioContext if state is suspended", () => {
    // Create a fresh mock with suspended state
    const suspendedResume = vi.fn().mockResolvedValue(undefined);
    const suspendedCreateOscillator = vi.fn(() => ({ ...mockOscillator }));
    const suspendedCreateGain = vi.fn(() => ({ ...mockGainNode }));

    class SuspendedAudioContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      resume = suspendedResume;
      createOscillator = suspendedCreateOscillator;
      createGain = suspendedCreateGain;
    }

    // @ts-expect-error -- mock AudioContext
    globalThis.AudioContext = SuspendedAudioContext;

    const { result } = renderHook(() => useAudioFeedback());

    act(() => {
      result.current.play("success");
    });

    expect(suspendedResume).toHaveBeenCalled();

    // Restore
    // @ts-expect-error -- mock AudioContext
    globalThis.AudioContext = MockAudioContext;

    vi.useRealTimers();
  });
});
