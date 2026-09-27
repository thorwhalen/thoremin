/**
 * A synthetic air-guitar performance (#249): the chord hand holds one of the synthetic
 * "chord shapes" (`synthetic_hand.ts`, with per-frame joint jitter), the strumming hand
 * strokes down and back up at a steady period. Plus the enrolment samples a player would
 * give for a shape: the same featurizer the node runs, on jittered holds. Self-made data,
 * safe to commit. Handedness is as the player sees it (no mirror).
 */
import { makeHandKeypoints, type HandsFrame } from '@/nodes/domain';
import { chordShapeVector } from '@/features/hand_shape';
import type { FeatureVector } from '@/enroll';
import { SHAPES, frameOf, noise, perturb, rng, syntheticHand } from './synthetic_hand';

const W = 640;
const H = 480;
const JOINT_SD = 0.03; // radians of per-frame joint jitter

const shapeHand = (name: string, r: () => number, label: 'Left' | 'Right', cx = 180) =>
  syntheticHand(perturb(SHAPES[name], () => 0, () => noise(r, JOINT_SD)), { cx, cy: 0.45 * H, scale: 90, world: true }, label);

/** `n` enrolment samples of a held shape, as the node's `shape` output would give them. */
export function enrolSamples(name: string, n: number, seed: number): FeatureVector[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const hand = shapeHand(name, r, 'Left');
    return chordShapeVector(hand, frameOf([hand], W, H));
  });
}

export interface GuitarTake {
  duration: number;
  fps?: number;
  /** The shape the chord hand holds at time t (a key of SHAPES). */
  chordAt: (t: number) => string;
  period?: number;
  depth?: number;
  seed?: number;
}

export function guitarTake({ duration, fps = 30, chordAt, period = 0.5, depth = 0.15, seed = 7 }: GuitarTake): HandsFrame[] {
  const r = rng(seed);
  const frames: HandsFrame[] = [];
  for (let i = 0; i < Math.round(duration * fps); i++) {
    const t = i / fps;
    const strumY = 0.5 * H + depth * H * (1 - Math.cos((2 * Math.PI * t) / period)) * 0.5;
    const strum = { handedness: 'Right' as const, keypoints: makeHandKeypoints({ cx: 480, cy: strumY, scale: 50, spread: 0.6, pinch: 0, handedness: 'Right' }) };
    frames.push({ t, width: W, height: H, hands: [shapeHand(chordAt(t), r, 'Left'), strum] });
  }
  return frames;
}
