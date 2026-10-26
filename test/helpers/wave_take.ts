/**
 * A scripted take of a hand waving (#751), for the motion segmenter's tests: an open right
 * hand held up, a rest, then `waves` waves with a pause between each, then a tail of rest.
 *
 * Each frame is the scripted articulated hand (`@thoremin/ext-faces/lib/synthetic_hand`, its
 * per-keypoint jitter deterministic) shifted sideways, read by `handsFrameVector` exactly as the
 * live node reads a hand: the vector carries the real `hand.right.*` ids. A wave is a
 * Hann-windowed side-to-side oscillation (`cycles` swings out and back over `waveMs`), so it
 * starts and ends at rest with no jump; on top, a slow sideways drift keeps the resting hand
 * from being unnaturally still (a real hand wanders at low frequency, and so does MediaPipe).
 *
 * `waves` returns the ground truth: when each wave began and ended.
 */
import { SYNTHETIC_HAND_FRAME, SYNTHETIC_HAND_SHAPES, syntheticHandKeypoints } from '@thoremin/ext-faces/lib/synthetic_hand';
import { handsFrameVector } from '@thoremin/sdk/features/modalities/hand';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

export interface WaveScript {
  /** The opening rest, long enough for the noise estimate to warm (30 frames). */
  restMs: number;
  waves: number;
  /** One wave's duration. */
  waveMs: number;
  /** Swings out and back per wave. */
  cycles: number;
  /** The wave's half-width, in hand lengths. */
  amplitude: number;
  /** Rest between two waves. */
  pauseMs: number;
  /** Rest after the last wave. */
  tailMs: number;
  fps: number;
  /** Offsets the jitter's hash, so two takes differ. */
  seed: number;
  /** The resting drift's half-width in hand lengths, and its period. */
  drift: number;
  driftPeriodMs: number;
}

export const WAVE_SCRIPT: WaveScript = {
  restMs: 2000,
  waves: 5,
  waveMs: 1000,
  cycles: 2,
  amplitude: 0.25,
  pauseMs: 1000,
  tailMs: 1000,
  fps: 30,
  seed: 1,
  // Calibrated so the resting reading peaks near 3 noise-sigma, inside the band a held face
  // measures (p90 4, max ~5; `MOTION_DEFAULTS`): still, but not unnaturally so.
  drift: 0.02,
  driftPeriodMs: 3000,
};

export interface WaveTake {
  frames: { v: FeatureVector; t: number }[];
  /** Each wave's start and end, in ms on the take's clock. */
  waves: { startMs: number; endMs: number }[];
}

const OPEN = SYNTHETIC_HAND_SHAPES.find((s) => s.name === 'open')!;

/** The take for `script` (any field overridden; the rest from {@link WAVE_SCRIPT}). */
export function waveTake(script: Partial<WaveScript> = {}): WaveTake {
  const s = { ...WAVE_SCRIPT, ...script };
  const L = SYNTHETIC_HAND_FRAME.length;
  const waves = Array.from({ length: s.waves }, (_, i) => {
    const startMs = s.restMs + i * (s.waveMs + s.pauseMs);
    return { startMs, endMs: startMs + s.waveMs };
  });
  const totalMs = s.waves > 0 ? waves[waves.length - 1].endMs + s.tailMs : s.restMs;
  const frameMs = 1000 / s.fps;

  /** The sideways shift at `t`, in pixels. */
  const shift = (t: number): number => {
    let x = s.drift * L * Math.sin((2 * Math.PI * t) / s.driftPeriodMs);
    for (const w of waves) {
      if (t < w.startMs || t > w.endMs) continue;
      const tau = (t - w.startMs) / s.waveMs;
      x += s.amplitude * L * Math.sin(Math.PI * tau) ** 2 * Math.sin(2 * Math.PI * s.cycles * tau);
    }
    return x;
  };

  const frames: WaveTake['frames'] = [];
  for (let i = 0; i * frameMs <= totalMs; i++) {
    const t = i * frameMs;
    const dx = shift(t);
    const keypoints = syntheticHandKeypoints(OPEN, s.seed * 1e6 + i).map((k) => ({ ...k, x: k.x + dx }));
    const frame = { width: SYNTHETIC_HAND_FRAME.width, height: SYNTHETIC_HAND_FRAME.height, hands: [{ handedness: 'Right', keypoints, score: 1 }] } as HandsFrame;
    frames.push({ v: handsFrameVector(frame, { mirrorX: true, mirrorHandedness: false }), t });
  }
  return { frames, waves };
}
