/**
 * A synthetic 21-keypoint hand for the air tests: a planar kinematic chain with one
 * curl per finger and one spread per adjacent-finger pair, posed in 3-D (in-plane
 * rotation, yaw, pitch), rendered into pixel coordinates at a chosen position and
 * scale, optionally with MediaPipe-style WORLD landmarks (metres, hand-centred). Not a
 * hand model; enough that the catalog's joint angles, spreads and pinch distances take
 * distinct, controllable values per "chord shape", stay put under translation, scaling
 * and rotation, and exercise the world-landmark path real footage uses.
 *
 * Self-made data only (this file is the whole provenance), so the tests are safe to
 * commit in a public repository.
 */
import type { Hand, HandsFrame, Keypoint } from '@/nodes/domain';
import { LM } from '@/nodes/domain';

export interface HandShape {
  /** Curl per finger, radians per joint (0 = straight, ~1.2 = fist). */
  curl: { thumb: number; index: number; middle: number; ring: number; pinky: number };
  /** Spread angle (radians) added to each finger's base direction; index..pinky. */
  spread: { index: number; middle: number; ring: number; pinky: number };
}

export interface HandPose {
  cx: number;
  cy: number;
  /** Palm scale in pixels (index-MCP..pinky-MCP span ≈ 0.6 * scale). */
  scale: number;
  /** In-plane rotation, radians. */
  rotation?: number;
  /** Out-of-plane rotation about the vertical axis, radians (foreshortens x). */
  yaw?: number;
  /** Out-of-plane rotation about the horizontal axis, radians (foreshortens y). */
  pitch?: number;
  /** Emit `worldKeypoints` (metres, centred) as `video_to_landmarks.py` does. */
  world?: boolean;
}

const FINGER_SEGMENTS = [0.38, 0.26, 0.2];
const THUMB_SEGMENTS = [0.3, 0.26, 0.2];
/** Metres per unit of `scale` = 1: a palm span of ~0.08 m at scale 1. */
const METRES_PER_UNIT = 0.13;

type V3 = [number, number, number];

function rotZ([x, y, z]: V3, a: number): V3 {
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
}
function rotY([x, y, z]: V3, a: number): V3 {
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}
function rotX([x, y, z]: V3, a: number): V3 {
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

/** A finger chain in the palm plane, curling out of it (toward -z, the camera). */
function chain(base: V3, dir: number, curl: number, segs: readonly number[]): V3[] {
  const pts: V3[] = [];
  let [x, y, z] = base;
  let bend = 0;
  for (const len of segs) {
    x += Math.cos(dir) * len * Math.cos(bend);
    y += Math.sin(dir) * len * Math.cos(bend);
    z -= len * Math.sin(bend);
    pts.push([x, y, z]);
    bend += curl;
  }
  return pts;
}

/** Build the 21 keypoints of a hand in a given shape and pose (unit palm, then posed). */
export function syntheticHand(shape: HandShape, pose: HandPose, handedness: 'Left' | 'Right' = 'Left'): Hand {
  const up = -Math.PI / 2;
  const local: Record<number, V3> = {};
  local[LM.wrist] = [0, 0.5, 0];
  const mcpX = { index: -0.3, middle: -0.1, ring: 0.1, pinky: 0.3 } as const;
  const fingerIdx = {
    index: [LM.index_mcp, LM.index_pip, LM.index_dip, LM.index_tip],
    middle: [LM.middle_mcp, LM.middle_pip, LM.middle_dip, LM.middle_tip],
    ring: [LM.ring_mcp, LM.ring_pip, LM.ring_dip, LM.ring_tip],
    pinky: [LM.pinky_mcp, LM.pinky_pip, LM.pinky_dip, LM.pinky_tip],
  } as const;
  for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
    const base: V3 = [mcpX[f], -0.25, 0];
    local[fingerIdx[f][0]] = base;
    chain(base, up + shape.spread[f], shape.curl[f], FINGER_SEGMENTS).forEach((p, i) => (local[fingerIdx[f][i + 1]] = p));
  }
  const thumbBase: V3 = [-0.45, 0.2, 0];
  local[LM.thumb_cmc] = thumbBase;
  const tpts = chain(thumbBase, up - 0.9, shape.curl.thumb, THUMB_SEGMENTS);
  local[LM.thumb_mcp] = tpts[0];
  local[LM.thumb_ip] = tpts[1];
  local[LM.thumb_tip] = tpts[2];

  const posed: V3[] = [];
  for (let i = 0; i < 21; i++) {
    let p = local[i];
    p = rotX(p, pose.pitch ?? 0);
    p = rotY(p, pose.yaw ?? 0);
    p = rotZ(p, pose.rotation ?? 0);
    posed.push(p);
  }
  const s = pose.scale;
  // Image z scales with the hand like x and y (MediaPipe's z is in image units).
  const keypoints: Keypoint[] = posed.map(([x, y, z]) => ({ x: pose.cx + x * s, y: pose.cy + y * s, z: z * s }));
  const hand: Hand = { handedness, keypoints, score: 0.95 };
  if (pose.world) {
    const c = posed.reduce<V3>((acc, p) => [acc[0] + p[0] / 21, acc[1] + p[1] / 21, acc[2] + p[2] / 21], [0, 0, 0]);
    hand.worldKeypoints = posed.map(([x, y, z]) => ({
      x: (x - c[0]) * METRES_PER_UNIT,
      y: (y - c[1]) * METRES_PER_UNIT,
      z: (z - c[2]) * METRES_PER_UNIT,
    }));
  }
  return hand;
}

export function frameOf(hands: Hand[], width = 640, height = 480): HandsFrame {
  return { width, height, hands };
}

/** Five distinct "chord shapes", named after the open chords they loosely evoke. */
export const SHAPES: Record<string, HandShape> = {
  E: { curl: { thumb: 0.2, index: 0.6, middle: 0.9, ring: 0.9, pinky: 0.1 }, spread: { index: -0.15, middle: 0, ring: 0.1, pinky: 0.35 } },
  A: { curl: { thumb: 0.2, index: 0.8, middle: 0.8, ring: 0.8, pinky: 0.1 }, spread: { index: -0.05, middle: 0, ring: 0.05, pinky: 0.35 } },
  D: { curl: { thumb: 0.3, index: 0.5, middle: 0.5, ring: 1.0, pinky: 0.2 }, spread: { index: -0.3, middle: 0.1, ring: 0.2, pinky: 0.4 } },
  G: { curl: { thumb: 0.1, index: 0.7, middle: 0.5, ring: 0.3, pinky: 0.3 }, spread: { index: -0.4, middle: -0.2, ring: 0.3, pinky: 0.45 } },
  C: { curl: { thumb: 0.2, index: 0.4, middle: 0.7, ring: 1.0, pinky: 0.1 }, spread: { index: -0.35, middle: -0.1, ring: 0.15, pinky: 0.4 } },
};

/** Deterministic PRNG for the tests (same mulberry32 as the model). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian-ish noise from a uniform PRNG (sum of three uniforms, centred). */
export const noise = (r: () => number, sd: number): number => (r() + r() + r() - 1.5) * sd * 1.41;

/** A shape perturbed per player (a systematic offset) and per frame (jitter). */
export function perturb(shape: HandShape, offset: (k: string) => number, jitter: () => number): HandShape {
  const c = shape.curl;
  const sp = shape.spread;
  return {
    curl: {
      thumb: c.thumb + offset('c.thumb') + jitter(),
      index: c.index + offset('c.index') + jitter(),
      middle: c.middle + offset('c.middle') + jitter(),
      ring: c.ring + offset('c.ring') + jitter(),
      pinky: c.pinky + offset('c.pinky') + jitter(),
    },
    spread: {
      index: sp.index + offset('s.index') + jitter(),
      middle: sp.middle + offset('s.middle') + jitter(),
      ring: sp.ring + offset('s.ring') + jitter(),
      pinky: sp.pinky + offset('s.pinky') + jitter(),
    },
  };
}
