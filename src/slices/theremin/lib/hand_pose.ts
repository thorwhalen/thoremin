/**
 * The pitch hand's SHAPE, as the codified theremin techniques describe it (Rockmore's aerial
 * fingering, Eyck's eight finger positions; `poses.ts`, `docs/research/theremin-technique.md`):
 * how far each finger is opened, whether the thumb and index form a ring, and how the hand is
 * turned (Eyck's ring goes from vertical in position 1 to horizontal in position 8).
 *
 * Read from the 3D world landmarks when the hand model gives them (metres, so the shape does not
 * depend on where the hand is or how big it looks), from the image otherwise. Pure.
 */
import { LM, type Hand, type Keypoint } from '@thoremin/sdk/nodes/domain';

/** The four fingers a position opens and closes, thumb excluded (it holds the ring). */
export const POSE_FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
export type PoseFinger = (typeof POSE_FINGERS)[number];

/** A hand's shape in the terms the techniques use. */
export interface PoseFeatures {
  /** Per finger, how open it is: 0 curled into the palm, 1 straight. */
  open: Record<PoseFinger, number>;
  /** Thumb tip to index tip, in palm lengths: small when they touch (the ring). */
  ring: number;
  /** How the knuckle line (index to little-finger knuckle) is turned, degrees from horizontal:
   *  0 with the hand flat, 90 with it on its edge. */
  roll: number;
}

const CHAINS: Record<PoseFinger, readonly [number, number, number, number]> = {
  index: [LM.index_mcp, LM.index_pip, LM.index_dip, LM.index_tip],
  middle: [LM.middle_mcp, LM.middle_pip, LM.middle_dip, LM.middle_tip],
  ring: [LM.ring_mcp, LM.ring_pip, LM.ring_dip, LM.ring_tip],
  pinky: [LM.pinky_mcp, LM.pinky_pip, LM.pinky_dip, LM.pinky_tip],
};

/** A finger's bends summed over its three joints at full curl, radians (about 90 degrees each at
 *  the knuckle and the middle joint, 60 at the last). */
const FULL_CURL = Math.PI * (0.5 + 0.5 + 0.33);

type V = { x: number; y: number; z: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: V): number => Math.hypot(a.x, a.y, a.z);
/** The bend at `b` between the segments a-b and b-c, radians (0 straight). */
function bend(a: V, b: V, c: V): number {
  const u = sub(b, a);
  const v = sub(c, b);
  const d = len(u) * len(v);
  return d > 0 ? Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / d))) : 0;
}

/** The hand's points: world landmarks when present (all 21), else the image keypoints (z 0). */
function points(hand: Hand): V[] | null {
  const w = hand.worldKeypoints;
  const src: readonly Keypoint[] = w && w.length >= 21 ? w : hand.keypoints;
  if (src.length < 21) return null;
  return src.map((k) => ({ x: k.x, y: k.y, z: w && w.length >= 21 ? (k.z ?? 0) : 0 }));
}

/** The shape of one hand, or null without all 21 landmarks. */
export function poseFeatures(hand: Hand): PoseFeatures | null {
  const p = points(hand);
  if (!p) return null;
  const open = {} as Record<PoseFinger, number>;
  for (const f of POSE_FINGERS) {
    const [m, pi, d, t] = CHAINS[f];
    const curl = bend(p[LM.wrist]!, p[m]!, p[pi]!) + bend(p[m]!, p[pi]!, p[d]!) + bend(p[pi]!, p[d]!, p[t]!);
    open[f] = Math.max(0, Math.min(1, 1 - curl / FULL_CURL));
  }
  const palm = len(sub(p[LM.middle_mcp]!, p[LM.wrist]!));
  const ring = palm > 0 ? len(sub(p[LM.thumb_tip]!, p[LM.index_tip]!)) / palm : 0;
  const k = sub(p[LM.pinky_mcp]!, p[LM.index_mcp]!);
  const roll = (Math.atan2(Math.abs(k.y), Math.hypot(k.x, k.z)) * 180) / Math.PI;
  return { open, ring, roll };
}

/** The features as one ordered vector (the pose library's centroids use this order). */
export const POSE_FEATURE_IDS = ['open.index', 'open.middle', 'open.ring', 'open.pinky', 'ring', 'roll'] as const;
export function poseVector(f: PoseFeatures): number[] {
  return [f.open.index, f.open.middle, f.open.ring, f.open.pinky, f.ring, f.roll];
}
