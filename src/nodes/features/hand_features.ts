/**
 * `hand-features` node — turns a {@link HandsFrame} (raw landmarks) into
 * normalized, musically useful per-hand features: position (x, y), openness
 * (fist↔spread) and pinch (thumb↔index). Pure and deterministic, so it is the
 * first stage we record and the first we test from a replay.
 *
 * Normalization rationale: openness/pinch are divided by a per-hand size
 * reference (wrist→middle-knuckle distance) so they are invariant to how close
 * the hand is to the camera.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { clamp01 } from '@/features/math';
import {
  ABSENT_HAND,
  dist2d,
  dist3d,
  FINGER_NAMES,
  kp,
  LM,
  type FingerCloseness,
  type FingerName,
  type Hand,
  type HandFeatures,
  type HandsFrame,
  type Keypoint,
  type SingleHandFeatures,
} from '../domain';

const Params = z.object({
  /** Mirror x so moving the hand to your right increases x (selfie view). */
  mirrorX: z.boolean().default(true),
  /**
   * Swap reported Left/Right handedness (the mirrored webcam reports the
   * opposite hand). On by default to match a selfie camera.
   */
  mirrorHandedness: z.boolean().default(true),
  /** openRaw value mapped to openness=0 (closed fist). */
  opennessMin: z.number().default(1.3),
  /** openRaw value mapped to openness=1 (fully spread). */
  opennessMax: z.number().default(2.3),
  /** pinchDist/handScale at/below which pinch=1 (touching). */
  pinchTouch: z.number().default(0.25),
  /** pinchDist/handScale at/above which pinch=0 (apart). */
  pinchApart: z.number().default(1.2),
  /**
   * Finger→thumb closeness range, as a distance RATIO (thumb-tip→fingertip divided
   * by the rigid palm span index-MCP→pinky-MCP). Rotation/scale-invariant: computed
   * on world landmarks when present. `fingerTouch` (small ratio) → closeness 1;
   * `fingerApart` (large ratio) → closeness 0. Defaults are sane starting points; a
   * per-user open/closed calibration is the intended refinement (see discussion #80).
   */
  fingerTouch: z.number().default(0.3),
  fingerApart: z.number().default(1.8),
})
  // Fail fast on degenerate ranges (the openness/pinch maps divide by these).
  .refine((p) => p.opennessMax > p.opennessMin, {
    message: 'opennessMax must be greater than opennessMin',
    path: ['opennessMax'],
  })
  .refine((p) => p.pinchApart > p.pinchTouch, {
    message: 'pinchApart must be greater than pinchTouch',
    path: ['pinchApart'],
  })
  .refine((p) => p.fingerApart > p.fingerTouch, {
    message: 'fingerApart must be greater than fingerTouch',
    path: ['fingerApart'],
  });
type Params = z.infer<typeof Params>;

/**
 * Normalize `value` from [lo, hi] to [0, 1], clamped. Guards a zero range so a
 * misconfigured param (lo === hi) can never produce NaN, even if params bypass
 * Zod parsing (e.g. a direct node.make() call).
 */
function normRange(value: number, lo: number, hi: number): number {
  const denom = hi - lo;
  if (Math.abs(denom) < 1e-9) return 0;
  return clamp01((value - lo) / denom);
}

function handScaleOf(hand: Hand): number {
  const wrist = kp(hand, LM.wrist);
  const midMcp = kp(hand, LM.middle_mcp);
  if (!wrist || !midMcp) return 1;
  const s = dist2d(wrist, midMcp);
  return s > 1e-6 ? s : 1;
}

const FINGER_TIP_LM: Record<FingerName, number> = {
  index: LM.index_tip,
  middle: LM.middle_tip,
  ring: LM.ring_tip,
  pinky: LM.pinky_tip,
};
const ZERO_FINGERS: FingerCloseness = { index: 0, middle: 0, ring: 0, pinky: 0 };

/**
 * Per-finger thumb closeness (0 = far, 1 = touching the thumb), invariant to hand
 * orientation and camera distance: uses MediaPipe *world* landmarks when present
 * (metric 3D → rotation-robust), normalizing the thumb-tip→fingertip distance by the
 * RIGID palm span (index-MCP → pinky-MCP), then mapping the ratio through
 * [fingerApart, fingerTouch]. Falls back to 2D image landmarks (scale-invariant only)
 * when world landmarks are absent (the synthetic source). See discussion #80.
 */
function fingerClosenessOf(hand: Hand, p: Params): FingerCloseness {
  const world = hand.worldKeypoints;
  const useWorld = !!(world && world.length >= 21);
  const d = useWorld ? dist3d : dist2d;
  const get = (i: number): Keypoint | undefined => (useWorld ? world![i] : kp(hand, i));
  const thumbTip = get(LM.thumb_tip);
  const indexMcp = get(LM.index_mcp);
  const pinkyMcp = get(LM.pinky_mcp);
  if (!thumbTip || !indexMcp || !pinkyMcp) return { ...ZERO_FINGERS };
  const palmSpan = d(indexMcp, pinkyMcp);
  if (palmSpan < 1e-6) return { ...ZERO_FINGERS };
  const out: FingerCloseness = { ...ZERO_FINGERS };
  for (const name of FINGER_NAMES) {
    const tip = get(FINGER_TIP_LM[name]);
    if (!tip) continue;
    // Inverted range: a small ratio (finger near thumb) → 1, a large ratio → 0.
    out[name] = normRange(d(thumbTip, tip) / palmSpan, p.fingerApart, p.fingerTouch);
  }
  return out;
}

function extractOne(hand: Hand, frame: HandsFrame, p: Params): SingleHandFeatures {
  const indexTip = kp(hand, LM.index_tip);
  const wrist = kp(hand, LM.wrist);
  if (!indexTip || !wrist) return { ...ABSENT_HAND, present: true };

  const xRaw = indexTip.x / frame.width;
  const x = clamp01(p.mirrorX ? 1 - xRaw : xRaw);
  const y = clamp01(indexTip.y / frame.height);

  // Wrist position (the alternative, steadier note source — the whole hand rather
  // than the index fingertip). Mirrored like x for the selfie view.
  const wristXRaw = wrist.x / frame.width;
  const wristX = clamp01(p.mirrorX ? 1 - wristXRaw : wristXRaw);
  const wristY = clamp01(wrist.y / frame.height);

  const handScale = handScaleOf(hand);

  // Openness: mean fingertip distance from wrist, scaled by hand size.
  const tips = [LM.index_tip, LM.middle_tip, LM.ring_tip, LM.pinky_tip]
    .map((i) => kp(hand, i))
    .filter((k): k is NonNullable<typeof k> => !!k);
  let openness = 0;
  if (tips.length) {
    const meanTipDist = tips.reduce((s, t) => s + dist2d(t, wrist), 0) / tips.length;
    const openRaw = meanTipDist / handScale;
    openness = normRange(openRaw, p.opennessMin, p.opennessMax);
  }

  // Pinch: thumb-tip to index-tip distance, scaled by hand size, inverted.
  const thumbTip = kp(hand, LM.thumb_tip);
  let pinch = 0;
  if (thumbTip) {
    const pinchDist = dist2d(thumbTip, indexTip) / handScale;
    // Inverted range: pinchDist=pinchTouch → 1, pinchDist=pinchApart → 0.
    pinch = normRange(pinchDist, p.pinchApart, p.pinchTouch);
  }

  const fingers = fingerClosenessOf(hand, p);

  return { present: true, x, y, wristX, wristY, openness, pinch, fingers };
}

export const handFeaturesNode = defineNode<Params>({
  type: 'hand-features',
  roles: ['feature'],
  title: 'Hand Features',
  description: 'Landmarks → normalized per-hand position, openness, pinch.',
  inputs: [{ name: 'hands', kind: 'hands-frame' }],
  outputs: [{ name: 'features', kind: 'hand-features' }],
  params: Params,
  process(inputs, p) {
    const frame = inputs.hands as HandsFrame | undefined;
    const out: HandFeatures = { left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND } };
    if (!frame || !frame.hands?.length) return { features: out };

    for (const hand of frame.hands) {
      let side = hand.handedness;
      if (p.mirrorHandedness) side = side === 'Left' ? 'Right' : 'Left';
      const f = extractOne(hand, frame, p);
      if (side === 'Right') out.right = f;
      else out.left = f;
    }
    return { features: out };
  },
});
