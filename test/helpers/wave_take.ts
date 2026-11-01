/**
 * A scripted take of a hand waving (#751), for the motion segmenter's tests: an open right
 * hand held up, a rest, then `waves` waves with a pause between each, then a tail of rest.
 * Any other gesture's path can stand in for the wave (`path`, `GESTURE_PATHS`; #752).
 *
 * Each frame is the scripted articulated hand (`@thoremin/ext-faces/lib/synthetic_hand`, its
 * per-keypoint jitter deterministic) shifted sideways, read by `handsFrameVector` exactly as the
 * live node reads a hand: the vector carries the real `hand.right.*` ids. A wave is a
 * Hann-windowed side-to-side oscillation (`cycles` swings out and back over `waveMs`), so it
 * starts and ends at rest with no jump; on top, a slow sideways drift keeps the resting hand
 * from being unnaturally still (a real hand wanders at low frequency, and so does MediaPipe).
 *
 * A still left hand can come into view at `leftHandFromMs` (the other hand entering the shot:
 * new features whose noise is not known yet).
 *
 * `waves` returns the ground truth: when each wave began and ended.
 */
import { SYNTHETIC_HAND_FRAME, SYNTHETIC_HAND_SHAPES, syntheticHandKeypoints } from '@thoremin/ext-faces/lib/synthetic_hand';
import { handsFrameVector } from '@thoremin/sdk/features/modalities/hand';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/**
 * A gesture's path (#752): the hand's displacement at `tau` (0..1 through one repetition) in
 * units of the amplitude, `[sideways, down]`, starting and ending at rest. `cycles` is the
 * script's.
 */
export type GesturePath = (tau: number, cycles: number) => readonly [number, number];

const hann = (tau: number) => Math.sin(Math.PI * tau) ** 2;
const swing = (tau: number, cycles: number) => hann(tau) * Math.sin(2 * Math.PI * cycles * tau);

/** The scripted gestures: a wave is a side-to-side swing, a nod the same swing up and down, a
 *  circle a loop, a push one swing out and back, a diagonal the swing at 45 degrees. */
export const GESTURE_PATHS = {
  wave: (tau, cycles) => [swing(tau, cycles), 0],
  nod: (tau, cycles) => [0, swing(tau, cycles)],
  circle: (tau, cycles) => [hann(tau) * Math.sin(2 * Math.PI * cycles * tau), hann(tau) * (1 - Math.cos(2 * Math.PI * cycles * tau))],
  push: (tau) => [hann(tau), 0],
  diagonal: (tau, cycles) => [swing(tau, cycles) / Math.SQRT2, swing(tau, cycles) / Math.SQRT2],
} satisfies Record<string, GesturePath>;

export interface WaveScript {
  /** What each repetition traces (default the wave). */
  path: GesturePath;
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
  /** When a still left hand comes into view (null: never). */
  leftHandFromMs: number | null;
}

export const WAVE_SCRIPT: WaveScript = {
  path: GESTURE_PATHS.wave,
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
  leftHandFromMs: null,
};

export interface WaveTake {
  frames: { v: FeatureVector; t: number }[];
  /** Each wave's start and end, in ms on the take's clock. */
  waves: { startMs: number; endMs: number }[];
}

const OPEN = SYNTHETIC_HAND_SHAPES.find((s) => s.name === 'open')!;
const REST = SYNTHETIC_HAND_SHAPES.find((s) => s.name === 'rest')!;
/** Where the left hand sits, beside the right (pixels). */
const LEFT_HAND_DX = -260;

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

  /** The hand's shift at `t`, in pixels: the drift sideways, plus the gesture's path. */
  const shift = (t: number): [number, number] => {
    let x = s.drift * L * Math.sin((2 * Math.PI * t) / s.driftPeriodMs);
    let y = 0;
    for (const w of waves) {
      if (t < w.startMs || t > w.endMs) continue;
      const [px, py] = s.path((t - w.startMs) / s.waveMs, s.cycles);
      x += s.amplitude * L * px;
      y += s.amplitude * L * py;
    }
    return [x, y];
  };

  const frames: WaveTake['frames'] = [];
  for (let i = 0; i * frameMs <= totalMs; i++) {
    const t = i * frameMs;
    const [dx, dy] = shift(t);
    const keypoints = syntheticHandKeypoints(OPEN, s.seed * 1e6 + i).map((k) => ({ ...k, x: k.x + dx, y: k.y + dy }));
    const hands = [{ handedness: 'Right', keypoints, score: 1 }];
    if (s.leftHandFromMs !== null && t >= s.leftHandFromMs) {
      const left = syntheticHandKeypoints(REST, s.seed * 1e6 + i + 5e5).map((k) => ({ ...k, x: k.x + LEFT_HAND_DX }));
      hands.push({ handedness: 'Left', keypoints: left, score: 1 });
    }
    const frame = { width: SYNTHETIC_HAND_FRAME.width, height: SYNTHETIC_HAND_FRAME.height, hands } as HandsFrame;
    frames.push({ v: handsFrameVector(frame, { mirrorX: true, mirrorHandedness: false }), t });
  }
  return { frames, waves };
}
