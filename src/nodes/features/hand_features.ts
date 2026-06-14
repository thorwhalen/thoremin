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
import {
  ABSENT_HAND,
  dist2d,
  kp,
  LM,
  type Hand,
  type HandFeatures,
  type HandsFrame,
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
})
  // Fail fast on degenerate ranges (the openness/pinch maps divide by these).
  .refine((p) => p.opennessMax > p.opennessMin, {
    message: 'opennessMax must be greater than opennessMin',
    path: ['opennessMax'],
  })
  .refine((p) => p.pinchApart > p.pinchTouch, {
    message: 'pinchApart must be greater than pinchTouch',
    path: ['pinchApart'],
  });
type Params = z.infer<typeof Params>;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

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

function extractOne(hand: Hand, frame: HandsFrame, p: Params): SingleHandFeatures {
  const indexTip = kp(hand, LM.index_tip);
  const wrist = kp(hand, LM.wrist);
  if (!indexTip || !wrist) return { ...ABSENT_HAND, present: true };

  const xRaw = indexTip.x / frame.width;
  const x = clamp01(p.mirrorX ? 1 - xRaw : xRaw);
  const y = clamp01(indexTip.y / frame.height);

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

  return { present: true, x, y, openness, pinch };
}

export const handFeaturesNode = defineNode<Params>({
  type: 'hand-features',
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
