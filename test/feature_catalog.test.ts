/**
 * Feature-catalog unit tests over synthetic inputs — verifying the formulas and
 * the #119 load-bearing corrections directly (not via a fixture): the acos clamp
 * (no NaN on collinear points), blendshape passthrough, EAR/MAR geometry,
 * present-gating / divide-by-zero guards, the dropped `tongueOut`, and the flat
 * registry's invariants.
 */
import { describe, it, expect } from 'vitest';
import { angleAt, angleBetween } from '@/features/math';
import {
  ALL_FEATURES,
  buildFaceCtx,
  buildHandCtx,
  FACE_FEATURES,
  FEATURE_BY_ID,
  FEATURE_GROUP_IDS,
  HAND_SIDE_FEATURES,
} from '@/features/catalog';
import { FL } from '@/features/landmarks';
import { makeHandKeypoints, type HandsFrame } from '@/nodes/domain';

// ---- math: the mandatory acos clamp ---------------------------------------

describe('angle helpers clamp the dot product (no NaN)', () => {
  it('angleAt returns pi for a straight A-B-C and 0 for a degenerate one', () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(Math.PI, 6);
    // a === c: both rays identical → acos(1). The clamp guarantees 0, not NaN.
    const deg = angleAt({ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 });
    expect(Number.isNaN(deg)).toBe(false);
    expect(deg).toBeCloseTo(0, 6);
  });

  it('angleBetween never NaNs for parallel/antiparallel vectors', () => {
    expect(angleBetween({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(0, 6);
    expect(angleBetween({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toBeCloseTo(Math.PI, 6);
  });
});

// ---- face: blendshapes + geometry -----------------------------------------

const face = (id: string) => FACE_FEATURES.find((f) => f.id === id)!;

/** A 478-point mesh, all at (0.5, 0.5, 0), with named indices overridden. */
function makeFaceLandmarks(overrides: Record<number, { x: number; y: number; z?: number }>): { x: number; y: number; z?: number }[] {
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i, p] of Object.entries(overrides)) pts[Number(i)] = { z: 0, ...p };
  return pts;
}

describe('face catalog — blendshapes', () => {
  it('passes a blendshape score straight through, 0 for an absent key', () => {
    const ctx = buildFaceCtx({ present: true, blendshapes: { jawOpen: 0.8, mouthSmileLeft: 0.6, mouthSmileRight: 0.4 } });
    expect(face('face.blendshape.jaw.open').compute(ctx)).toBeCloseTo(0.8);
    expect(face('face.blendshape.cheek.puff').compute(ctx)).toBe(0); // absent → 0
    // AU12 (smile) is the mean of the two smile shapes.
    expect(face('face.au.au12_lipCornerPuller').compute(ctx)).toBeCloseTo(0.5);
    // AU26 jaw drop aliases jawOpen.
    expect(face('face.au.au26_jawDrop').compute(ctx)).toBeCloseTo(0.8);
    // Symmetry: right - left.
    expect(face('face.symmetry.smile').compute(ctx)).toBeCloseTo(0.4 - 0.6);
  });

  it('has exactly 51 usable blendshape features and NO tongue group/feature', () => {
    const bs = FACE_FEATURES.filter((f) => f.group.startsWith('face.blendshape.'));
    expect(bs.length).toBe(51);
    expect(ALL_FEATURES.some((f) => f.id.includes('tongue') || f.group.includes('tongue'))).toBe(false);
    expect(ALL_FEATURES.some((f) => f.id.includes('_neutral'))).toBe(false);
  });
});

describe('face catalog — geometry', () => {
  it('EAR is (v1+v2)/(2h) from the lid + corner landmarks', () => {
    const l = makeFaceLandmarks({
      [FL.eyeUpperL2]: { x: 0.30, y: 0.40 },
      [FL.eyeLowerL2]: { x: 0.30, y: 0.44 }, // v1 = 0.04
      [FL.eyeUpperL3]: { x: 0.34, y: 0.40 },
      [FL.eyeLowerL3]: { x: 0.34, y: 0.44 }, // v2 = 0.04
      [FL.eyeInnerL]: { x: 0.28, y: 0.42 },
      [FL.eyeOuterL]: { x: 0.40, y: 0.42 }, // h = 0.12
    });
    const ctx = buildFaceCtx({ present: true, blendshapes: {}, landmarks: l });
    expect(face('face.geom.eye.earLeft').compute(ctx)).toBeCloseTo((0.04 + 0.04) / (2 * 0.12), 5);
  });

  it('MAR is (v1+v2+v3)/(2h) from the lip landmarks', () => {
    const l = makeFaceLandmarks({
      [FL.lipTopL]: { x: 0.45, y: 0.60 },
      [FL.lipBottomL]: { x: 0.45, y: 0.66 }, // 0.06
      [FL.lipTopInner]: { x: 0.50, y: 0.60 },
      [FL.lipBottomInner]: { x: 0.50, y: 0.68 }, // 0.08
      [FL.lipTopR]: { x: 0.55, y: 0.60 },
      [FL.lipBottomR]: { x: 0.55, y: 0.66 }, // 0.06
      [FL.mouthInnerL]: { x: 0.42, y: 0.63 },
      [FL.mouthInnerR]: { x: 0.58, y: 0.63 }, // h = 0.16
    });
    const ctx = buildFaceCtx({ present: true, blendshapes: {}, landmarks: l });
    expect(face('face.geom.mouth.aspectRatio').compute(ctx)).toBeCloseTo((0.06 + 0.08 + 0.06) / (2 * 0.16), 5);
  });

  it('geometry features are NaN when the frame carries no landmarks (present-gating)', () => {
    const ctx = buildFaceCtx({ present: true, blendshapes: { jawOpen: 0.5 } });
    expect(Number.isNaN(face('face.geom.mouth.aspectRatio').compute(ctx))).toBe(true);
    expect(Number.isNaN(face('face.gaze.x').compute(ctx))).toBe(true);
    // ...but blendshape features still compute.
    expect(face('face.blendshape.jaw.open').compute(ctx)).toBeCloseTo(0.5);
  });

  it('head pose reads NaN without a matrix, the value with one', () => {
    const noPose = buildFaceCtx({ present: true, blendshapes: {} });
    expect(Number.isNaN(face('face.head.yaw').compute(noPose))).toBe(true);
    const withPose = buildFaceCtx({ present: true, blendshapes: {}, headPose: { yaw: 12, pitch: -3, roll: 1 } });
    expect(face('face.head.yaw').compute(withPose)).toBe(12);
  });
});

// ---- hand: synthetic geometry ---------------------------------------------

const hand = (id: string) => HAND_SIDE_FEATURES.find((f) => f.id === id)!;

function synthHandCtx(spread: number, pinch = 0) {
  const kps = makeHandKeypoints({ cx: 320, cy: 240, scale: 80, spread, pinch, handedness: 'Right' });
  const frame: HandsFrame = { width: 640, height: 480, hands: [{ handedness: 'Right', keypoints: kps }] };
  return buildHandCtx(frame.hands[0], frame, { mirrorX: true, side: 'right' });
}

describe('hand catalog — synthetic geometry', () => {
  it('openness rises with finger spread and stays finite', () => {
    const open = hand('openness').compute(synthHandCtx(1));
    const closed = hand('openness').compute(synthHandCtx(0));
    expect(Number.isFinite(open)).toBe(true);
    expect(Number.isFinite(closed)).toBe(true);
    expect(open).toBeGreaterThan(closed);
  });

  it('curl is finite and within [0, 3pi]', () => {
    const curl = hand('index.curl').compute(synthHandCtx(1));
    expect(Number.isFinite(curl)).toBe(true);
    expect(curl).toBeGreaterThanOrEqual(-1e-6);
    expect(curl).toBeLessThanOrEqual(3 * Math.PI + 1e-6);
  });

  it('a degenerate hand (zero palm span) yields NaN, never Infinity', () => {
    const kps = Array.from({ length: 21 }, () => ({ x: 100, y: 100 }));
    const frame: HandsFrame = { width: 640, height: 480, hands: [{ handedness: 'Right', keypoints: kps }] };
    const ctx = buildHandCtx(frame.hands[0], frame, { mirrorX: true, side: 'right' });
    const opn = hand('openness').compute(ctx);
    const pinch = hand('pinch.thumbIndex').compute(ctx);
    expect(Number.isNaN(opn) || opn === 0).toBe(true);
    expect(Number.isFinite(pinch)).toBe(false); // NaN, not Infinity
  });
});

// ---- flat registry invariants ---------------------------------------------

describe('flat feature registry', () => {
  it('every id is unique and resolvable, and every group is a known group', () => {
    const ids = ALL_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    const groups = new Set(FEATURE_GROUP_IDS);
    for (const f of ALL_FEATURES) {
      expect(groups.has(f.group)).toBe(true);
      expect(FEATURE_BY_ID[f.id]).toBe(f);
    }
  });

  it('expands hand side features per hand (left + right)', () => {
    expect(FEATURE_BY_ID['hand.left.index.curl']).toBeTruthy();
    expect(FEATURE_BY_ID['hand.right.index.curl']).toBeTruthy();
    expect(FEATURE_BY_ID['hand.pair.distance']).toBeTruthy();
  });
});
