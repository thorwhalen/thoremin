/**
 * MediaPipe FaceLandmarker mesh-landmark indices used by the geometric face
 * features, plus the shared scale + aspect-ratio helpers built on them.
 *
 * MediaPipe emits 478 3-D mesh points (x, y normalized to 0..1; z relative;
 * indices 468-477 are the two irises). Every geometric feature is normalized by
 * a face-scale reference so it is invariant to how close the face is to the
 * camera. The reference is the outer-canthi span {@link FL.eyeOuterL}..
 * {@link FL.eyeOuterR} (labelled `IOD` in the catalog for continuity with the
 * research appendix; strictly it is the bitemporal eye span, not the clinical
 * inter-ocular distance — the iris-center span {@link irisDistance} is the true
 * inter-pupillary measure and a stabler alternative).
 *
 * All helpers return `NaN` when a required point is missing or the scale is
 * degenerate, so a feature reads "unavailable" (and is dropped before it can
 * poison a running statistic) rather than Infinity/NaN silently.
 */
import { dist2, safeDiv, type Vec3 } from './math';

/** A face-landmark array is a sparse-safe list of 3-D points (may be undefined). */
export type FaceLandmarks = ReadonlyArray<Vec3 | undefined>;

/**
 * Named FaceLandmarker mesh indices referenced by the geometric catalog. Grouped
 * by region; values are the canonical MediaPipe 478-mesh indices. Only the points
 * the catalog actually uses are named (the mesh has 478; naming all would be noise).
 */
export const FL = {
  // Nose / face center
  noseTip: 1,
  subnasale: 2,
  glabella: 168,
  chin: 152,
  // Eyes — outer/inner canthi (scale references)
  eyeOuterL: 33,
  eyeInnerL: 133,
  eyeOuterR: 263,
  eyeInnerR: 362,
  // Left-eye lids (subject-left; MediaPipe indices)
  eyeUpperL: 159,
  eyeLowerL: 145,
  eyeUpperL2: 160,
  eyeLowerL2: 144,
  eyeUpperL3: 158,
  eyeLowerL3: 153,
  // Right-eye lids
  eyeUpperR: 386,
  eyeLowerR: 374,
  eyeUpperR2: 385,
  eyeLowerR2: 380,
  eyeUpperR3: 387,
  eyeLowerR3: 373,
  // Irises (present only when refineLandmarks / iris output is on)
  irisL: 468,
  irisLright: 469,
  irisLleft: 471,
  irisR: 473,
  irisRright: 474,
  irisRleft: 476,
  // Mouth
  mouthCornerL: 61,
  mouthCornerR: 291,
  lipTopInner: 13,
  lipBottomInner: 14,
  lipTopL: 81,
  lipBottomL: 178,
  lipTopR: 311,
  lipBottomR: 402,
  mouthInnerL: 78,
  mouthInnerR: 308,
  // Brows
  browInnerL: 55,
  browInnerR: 285,
  browMidL: 105,
  browMidR: 334,
  // Cheeks / nose sides
  cheekL: 118,
  cheekR: 347,
  noseAlaL: 129,
  noseAlaR: 358,
} as const;

/** Fetch a landmark by index (safe: out-of-range/absent → undefined). */
export function L(landmarks: FaceLandmarks | undefined, i: number): Vec3 | undefined {
  return landmarks ? landmarks[i] : undefined;
}

/** 2-D distance between two landmarks by index, or `NaN` if either is missing. */
export function dL(landmarks: FaceLandmarks | undefined, i: number, j: number): number {
  const a = L(landmarks, i);
  const b = L(landmarks, j);
  if (!a || !b) return NaN;
  return dist2(a, b);
}

/**
 * The face-scale reference `IOD = d(eyeOuterL, eyeOuterR)` (outer-canthi span),
 * or `NaN` if a point is missing. Used to normalize every geometric feature.
 */
export function iod(landmarks: FaceLandmarks | undefined): number {
  const d = dL(landmarks, FL.eyeOuterL, FL.eyeOuterR);
  return d > 1e-9 ? d : NaN;
}

/** The inter-pupillary (iris-center) span `d(irisL, irisR)` — the clinically
 *  literal inter-ocular distance, present only when iris landmarks are emitted;
 *  a stabler scale alternative to {@link iod}. `NaN` when irises are absent. */
export function irisDistance(landmarks: FaceLandmarks | undefined): number {
  return dL(landmarks, FL.irisL, FL.irisR);
}

/**
 * Eye Aspect Ratio for one eye (Soukupova & Cech 2016): the mean of two vertical
 * lid gaps over the horizontal corner span. Self-normalizing (a ratio), so it
 * needs no IOD. `NaN` if any landmark or the corner span is missing/degenerate.
 * `side` selects the subject-left or subject-right eye's index set.
 */
export function ear(landmarks: FaceLandmarks | undefined, side: 'left' | 'right'): number {
  const idx =
    side === 'left'
      ? { u1: FL.eyeUpperL2, l1: FL.eyeLowerL2, u2: FL.eyeUpperL3, l2: FL.eyeLowerL3, c1: FL.eyeInnerL, c2: FL.eyeOuterL }
      : { u1: FL.eyeUpperR2, l1: FL.eyeLowerR2, u2: FL.eyeUpperR3, l2: FL.eyeLowerR3, c1: FL.eyeInnerR, c2: FL.eyeOuterR };
  const v1 = dL(landmarks, idx.u1, idx.l1);
  const v2 = dL(landmarks, idx.u2, idx.l2);
  const h = dL(landmarks, idx.c1, idx.c2);
  return safeDiv(v1 + v2, 2 * h);
}

/**
 * Mouth Aspect Ratio (the MAR analogue of EAR): mean of three vertical lip gaps
 * over the horizontal mouth span. Self-normalizing. `NaN` if degenerate.
 */
export function mar(landmarks: FaceLandmarks | undefined): number {
  const v1 = dL(landmarks, FL.lipTopL, FL.lipBottomL);
  const v2 = dL(landmarks, FL.lipTopInner, FL.lipBottomInner);
  const v3 = dL(landmarks, FL.lipTopR, FL.lipBottomR);
  const h = dL(landmarks, FL.mouthInnerL, FL.mouthInnerR);
  return safeDiv(v1 + v2 + v3, 2 * h);
}
