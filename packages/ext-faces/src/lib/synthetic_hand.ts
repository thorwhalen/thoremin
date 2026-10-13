/**
 * The scripted hand (#385 E8): "Your hand shapes" with no camera and no hand model, as the
 * scripted face is for "Your faces" (`./synthetic.ts`). A right hand, held up, goes through a few
 * shapes with a relaxed hand between them; its 21 keypoints are built from per-finger CURLS (each
 * finger a three-segment chain bent at every joint toward the palm, out of the image plane), a
 * spread and a thumb that can cross the palm or meet the index tip, so every shape feature the
 * hand categorizer reads (flexion, spread, pinch, openness) moves as it does on a real hand.
 * (`makeHandKeypoints`, the graph's synthetic hand, keeps its fingers straight: no curl.)
 *
 * The frame is a `HandsFrame`; `handsFrameVector` turns it into the merged vector's
 * `hand.right.*` keys, the same path a recorded hands fixture takes. Deterministic: the jitter is
 * a hash of (frame, keypoint).
 */
import { LM, type HandsFrame, type Keypoint } from '@thoremin/sdk/nodes/domain';
import { handsFrameVector } from '@thoremin/sdk/features/modalities/hand';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** One scripted shape: per-finger curl (0 straight, 1 fully bent), how far the fingers fan, and
 *  where the thumb goes (`across` the palm, toward the index tip as `pinch` grows). */
export interface SyntheticHandShape {
  name: string;
  color: string;
  curl: Readonly<{ thumb: number; index: number; middle: number; ring: number; pinky: number }>;
  spread: number;
  across: number;
  pinch: number;
}

export const SYNTHETIC_HAND_SHAPES: readonly SyntheticHandShape[] = [
  { name: 'rest', color: '#334155', curl: { thumb: 0.2, index: 0.25, middle: 0.3, ring: 0.3, pinky: 0.3 }, spread: 0.35, across: 0, pinch: 0 },
  { name: 'open', color: '#16a34a', curl: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }, spread: 1, across: 0, pinch: 0 },
  { name: 'fist', color: '#b91c1c', curl: { thumb: 0.6, index: 1, middle: 1, ring: 1, pinky: 1 }, spread: 0, across: 1, pinch: 0 },
  { name: 'point', color: '#ca8a04', curl: { thumb: 0.6, index: 0, middle: 1, ring: 1, pinky: 1 }, spread: 0.2, across: 1, pinch: 0 },
  { name: 'pinch', color: '#0891b2', curl: { thumb: 0.3, index: 0.45, middle: 0.1, ring: 0.1, pinky: 0.1 }, spread: 0.6, across: 0, pinch: 1 },
];

export const SYNTHETIC_HAND_TIMELINE = {
  /** The opening rest. */
  restMs: 3500,
  /** Each held shape (a shape, or the relaxed hand between two). */
  holdMs: 1300,
  /** The glide from one shape to the next. */
  glideMs: 250,
  /** Frame-to-frame jitter of each keypoint, in hand lengths. */
  jitter: 0.004,
} as const;

/** The scripted hand's frame: its size, and the hand's place and length in it (pixels). */
export const SYNTHETIC_HAND_FRAME = { width: 640, height: 480, cx: 320, cy: 380, length: 200 } as const;

/** The shapes after the opening rest, in turn: each shape, then the relaxed hand. */
const CYCLE: readonly number[] = [1, 0, 2, 0, 3, 0, 4, 0];

/** Which shape (index into {@link SYNTHETIC_HAND_SHAPES}) the hand is moving to at `ms`, from which,
 *  and how far (0..1) through the glide. */
export function syntheticHandPhase(ms: number): { from: number; to: number; mix: number } {
  const { restMs, holdMs, glideMs } = SYNTHETIC_HAND_TIMELINE;
  if (ms < restMs) return { from: 0, to: 0, mix: 1 };
  const span = holdMs + glideMs;
  const step = Math.floor((ms - restMs) / span);
  const into = ms - restMs - step * span;
  return { from: step === 0 ? 0 : CYCLE[(step - 1) % CYCLE.length], to: CYCLE[step % CYCLE.length], mix: Math.min(1, into / glideMs) };
}

/** The shape the hand shows at `ms` (the one it is gliding to once past halfway). */
export function syntheticHandShapeAt(ms: number): SyntheticHandShape {
  const p = syntheticHandPhase(ms);
  return SYNTHETIC_HAND_SHAPES[p.mix >= 0.5 ? p.to : p.from];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function blend(a: SyntheticHandShape, b: SyntheticHandShape, t: number): SyntheticHandShape {
  const curl = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
  for (const f of Object.keys(curl) as (keyof typeof curl)[]) curl[f] = lerp(a.curl[f], b.curl[f], t);
  return { name: t < 0.5 ? a.name : b.name, color: t < 0.5 ? a.color : b.color, curl, spread: lerp(a.spread, b.spread, t), across: lerp(a.across, b.across, t), pinch: lerp(a.pinch, b.pinch, t) };
}

/** A deterministic jitter in [-1, 1] for (frame, key). */
function jitterOf(frame: number, key: number): number {
  let h = (frame * 73856093) ^ (key * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Joint bend at full curl (radians), per joint of a finger: base, middle, tip. */
const FULL_BEND = [1.4, 1.7, 1.2] as const;
/** Segment lengths (hand lengths) of each long finger, base to tip; and where its knuckle sits
 *  across the palm, with its fan angle at full spread (radians). */
const FINGERS = [
  { name: 'index', mcp: LM.index_mcp, x: -0.32, seg: [0.36, 0.22, 0.17], fan: -0.3 },
  { name: 'middle', mcp: LM.middle_mcp, x: -0.1, seg: [0.4, 0.25, 0.18], fan: -0.08 },
  { name: 'ring', mcp: LM.ring_mcp, x: 0.12, seg: [0.37, 0.23, 0.17], fan: 0.14 },
  { name: 'pinky', mcp: LM.pinky_mcp, x: 0.32, seg: [0.29, 0.17, 0.15], fan: 0.36 },
] as const;

/** The hand's 21 keypoints for `shape` (pixels; z toward the camera is negative). */
export function syntheticHandKeypoints(shape: SyntheticHandShape, frame = 0): Keypoint[] {
  const { cx, cy, length: L } = SYNTHETIC_HAND_FRAME;
  const pts: Keypoint[] = new Array(21);
  const set = (i: number, x: number, y: number, z: number) => {
    const j = SYNTHETIC_HAND_TIMELINE.jitter * L;
    pts[i] = { x: x + j * jitterOf(frame, i * 3), y: y + j * jitterOf(frame, i * 3 + 1), z: z + j * jitterOf(frame, i * 3 + 2) };
  };
  set(LM.wrist, cx, cy, 0);
  const knuckleY = cy - 0.75 * L;
  for (const f of FINGERS) {
    const curl = shape.curl[f.name];
    const fan = f.fan * shape.spread;
    // The finger's plane: up the image, fanned by `fan`; each joint bends it out toward the camera.
    let x = cx + f.x * L;
    let y = knuckleY;
    let z = 0;
    set(f.mcp, x, y, z);
    let bend = 0;
    for (let s = 0; s < 3; s++) {
      bend += curl * FULL_BEND[s];
      const len = f.seg[s] * L;
      const up = Math.cos(bend);
      x += len * up * Math.sin(fan);
      y -= len * up * Math.cos(fan);
      z -= len * Math.sin(bend);
      set(f.mcp + s + 1, x, y, z);
    }
  }
  // The thumb: from the base of the palm out to the side, its tip pulled across the palm by
  // `across` and toward the index tip by `pinch`, bent by its curl on the way.
  const cmc = { x: cx - 0.3 * L, y: cy - 0.15 * L, z: 0 };
  const mcp = { x: cx - 0.5 * L, y: cy - 0.35 * L, z: -0.05 * L };
  set(LM.thumb_cmc, cmc.x, cmc.y, cmc.z);
  set(LM.thumb_mcp, mcp.x, mcp.y, mcp.z);
  const open = { x: cx - 0.75 * L, y: cy - 0.6 * L, z: -0.05 * L };
  const acrossTo = { x: cx - 0.05 * L, y: knuckleY + 0.15 * L, z: -0.25 * L };
  const indexTip = pts[LM.index_tip];
  let tip = { x: lerp(open.x, acrossTo.x, shape.across), y: lerp(open.y, acrossTo.y, shape.across), z: lerp(open.z, acrossTo.z, shape.across) };
  tip = { x: lerp(tip.x, indexTip.x, shape.pinch), y: lerp(tip.y, indexTip.y, shape.pinch), z: lerp(tip.z, indexTip.z ?? 0, shape.pinch) };
  // The interphalangeal joint sits between, pushed out of line by the thumb's curl.
  const bendOut = shape.curl.thumb * 0.12 * L;
  set(LM.thumb_ip, (mcp.x + tip.x) / 2 - bendOut, (mcp.y + tip.y) / 2, (mcp.z + tip.z) / 2 - bendOut);
  set(LM.thumb_tip, tip.x, tip.y, tip.z);
  return pts;
}

/** The scripted hand's frame at `ms` after the start (`frame` seeds the jitter). */
export function syntheticHandsFrame(ms: number, frame: number): HandsFrame {
  const { from, to, mix } = syntheticHandPhase(ms);
  const shape = blend(SYNTHETIC_HAND_SHAPES[from], SYNTHETIC_HAND_SHAPES[to], mix);
  const { width, height } = SYNTHETIC_HAND_FRAME;
  return { width, height, hands: [{ handedness: 'Right', keypoints: syntheticHandKeypoints(shape, frame), score: 1 }] } as HandsFrame;
}

/** One shape held (by name), as a frame. */
export function syntheticHandShapeFrame(name: string, frame: number): HandsFrame {
  const shape = SYNTHETIC_HAND_SHAPES.find((s) => s.name === name);
  if (!shape) throw new Error(`no synthetic hand shape "${name}"`);
  const { width, height } = SYNTHETIC_HAND_FRAME;
  return { width, height, hands: [{ handedness: 'Right', keypoints: syntheticHandKeypoints(shape, frame), score: 1 }] } as HandsFrame;
}

/** The scripted hand's merged vector (`hand.right.*`) at `ms`, read as the live node reads (x mirrored for
 *  the selfie view), its handedness as is. */
export function syntheticHandVector(ms: number, frame: number): FeatureVector {
  return handsFrameVector(syntheticHandsFrame(ms, frame), { mirrorX: true, mirrorHandedness: false });
}
