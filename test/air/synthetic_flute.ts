/**
 * A synthetic air-flute performance (#249): both hands hold one of the synthetic shapes
 * each (a "fingering" is a pair), with per-frame joint jitter; the face vector carries a
 * blowing or a resting mouth (the catalog's mouth ids, jittered). Plus the enrolment
 * samples for both. Self-made data, safe to commit. Handedness as the player sees it.
 */
import type { HandsFrame } from '@/nodes/domain';
import type { FeatureVector } from '@/enroll';
import { fingeringVector } from '@/nodes/music/air_flute';
import { SHAPES, noise, perturb, rng, syntheticHand } from './synthetic_hand';

const W = 640;
const H = 480;
const JOINT_SD = 0.03;
const MOUTH_SD = 0.03;

/** A fingering: the left hand's shape and the right hand's (keys of SHAPES). */
export type Fingering = [string, string];

function handsFrame(f: Fingering, r: () => number, t = 0): HandsFrame {
  const hand = (name: string, label: 'Left' | 'Right', cx: number) =>
    syntheticHand(perturb(SHAPES[name], () => 0, () => noise(r, JOINT_SD)), { cx, cy: 0.45 * H, scale: 80, world: true }, label);
  return { t, width: W, height: H, hands: [hand(f[0], 'Left', 200), hand(f[1], 'Right', 440)] };
}

/** The mouth states as face feature vectors (a handful of the catalog's mouth ids). */
const MOUTHS = {
  blowing: { 'face.blendshape.mouth.pucker': 0.75, 'face.blendshape.mouth.funnel': 0.45, 'face.blendshape.mouth.pressRight': 0.3, 'face.blendshape.jaw.open': 0.05, 'face.geom.mouth.width': 0.55 },
  resting: { 'face.blendshape.mouth.pucker': 0.05, 'face.blendshape.mouth.funnel': 0.02, 'face.blendshape.mouth.pressRight': 0.05, 'face.blendshape.jaw.open': 0.08, 'face.geom.mouth.width': 0.8 },
} as const;
export type Mouth = keyof typeof MOUTHS;

export function mouthFace(m: Mouth, r: () => number): FeatureVector {
  const out: FeatureVector = { 'face.head.yaw': 0.1 }; // a non-mouth feature the flute must ignore
  for (const [k, v] of Object.entries(MOUTHS[m])) out[k] = v + noise(r, MOUTH_SD);
  return out;
}

export function fingeringSamples(f: Fingering, n: number, seed: number): FeatureVector[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => fingeringVector(handsFrame(f, r), false)!);
}

export function mouthSamples(m: Mouth, n: number, seed: number): FeatureVector[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => mouthFace(m, r));
}

export interface FluteTake {
  duration: number;
  fps?: number;
  fingeringAt: (t: number) => Fingering;
  mouthAt: (t: number) => Mouth | null;
  seed?: number;
}

/** One tick per frame: the hands frame and the face vector (null = no face). */
export function fluteTake({ duration, fps = 30, fingeringAt, mouthAt, seed = 5 }: FluteTake): { frame: HandsFrame; face: FeatureVector | null }[] {
  const r = rng(seed);
  return Array.from({ length: Math.round(duration * fps) }, (_, i) => {
    const t = i / fps;
    const m = mouthAt(t);
    return { frame: handsFrame(fingeringAt(t), r, t), face: m ? mouthFace(m, r) : null };
  });
}
