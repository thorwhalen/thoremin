/**
 * The face feature catalog: raw blendshape channels grouped by facial region,
 * geometric mesh features (EAR/MAR, apertures, brow raise, gaze, jaw), head pose,
 * left/right symmetry, and a FACS Action-Unit approximation layer — every entry a
 * pure {@link FeatureDef}<{@link FaceCtx}>.
 *
 * Load-bearing corrections from the #119 research appendix are implemented here:
 *  - MediaPipe's runtime blendshape model emits 52 categories but index 0 is
 *    `_neutral` and `tongueOut` is NOT emitted (MediaPipe issue #4403). So there
 *    is NO `face.blendshape.tongue` group — a `tongueOut` feature would read 0
 *    forever. `_neutral` is likewise not exposed as a controllable feature.
 *  - Every geometric feature divides by the `IOD` face-scale reference and returns
 *    `NaN` (via {@link safeDiv} / the guarded helpers) when a landmark or the
 *    scale is missing, rather than Infinity.
 *  - Iris-dependent features (gaze, brow raise vs. iris, distance proxy) fall back
 *    to a lid landmark where the appendix specifies one, else read `NaN`.
 */
import { clamp01, safeDiv } from './math';
import { dL, ear, FL, iod as iodOf, L, mar, type FaceLandmarks } from './landmarks';
import type { Controllability, FaceCtx, FeatureDef } from './types';

type FaceFeature = FeatureDef<FaceCtx>;

// ---- Raw blendshape channels, grouped by region ----------------------------
// Each tuple is [feature id suffix, blendshape category name, controllability].
// The runtime model's usable set is 51 (52 categories minus `_neutral`; tongueOut
// is absent). Every name below is confirmed present in the recorded face fixture.

type BsRow = [string, string, Controllability];

const BLENDSHAPE_GROUPS: Record<string, BsRow[]> = {
  'face.blendshape.jaw': [
    ['jaw.open', 'jawOpen', 'easy'],
    ['jaw.forward', 'jawForward', 'moderate'],
    ['jaw.left', 'jawLeft', 'moderate'],
    ['jaw.right', 'jawRight', 'moderate'],
  ],
  'face.blendshape.mouth': [
    ['mouth.close', 'mouthClose', 'moderate'],
    ['mouth.funnel', 'mouthFunnel', 'moderate'],
    ['mouth.pucker', 'mouthPucker', 'easy'],
    ['mouth.left', 'mouthLeft', 'moderate'],
    ['mouth.right', 'mouthRight', 'moderate'],
    ['mouth.rollUpper', 'mouthRollUpper', 'moderate'],
    ['mouth.rollLower', 'mouthRollLower', 'moderate'],
    ['mouth.shrugUpper', 'mouthShrugUpper', 'involuntary'],
    ['mouth.shrugLower', 'mouthShrugLower', 'moderate'],
    ['mouth.smileLeft', 'mouthSmileLeft', 'easy'],
    ['mouth.smileRight', 'mouthSmileRight', 'easy'],
    ['mouth.frownLeft', 'mouthFrownLeft', 'moderate'],
    ['mouth.frownRight', 'mouthFrownRight', 'moderate'],
    ['mouth.dimpleLeft', 'mouthDimpleLeft', 'involuntary'],
    ['mouth.dimpleRight', 'mouthDimpleRight', 'involuntary'],
    ['mouth.stretchLeft', 'mouthStretchLeft', 'moderate'],
    ['mouth.stretchRight', 'mouthStretchRight', 'moderate'],
    ['mouth.pressLeft', 'mouthPressLeft', 'moderate'],
    ['mouth.pressRight', 'mouthPressRight', 'moderate'],
    ['mouth.lowerDownLeft', 'mouthLowerDownLeft', 'moderate'],
    ['mouth.lowerDownRight', 'mouthLowerDownRight', 'moderate'],
    ['mouth.upperUpLeft', 'mouthUpperUpLeft', 'moderate'],
    ['mouth.upperUpRight', 'mouthUpperUpRight', 'moderate'],
  ],
  'face.blendshape.brow': [
    ['brow.innerUp', 'browInnerUp', 'easy'],
    ['brow.downLeft', 'browDownLeft', 'moderate'],
    ['brow.downRight', 'browDownRight', 'moderate'],
    ['brow.outerUpLeft', 'browOuterUpLeft', 'moderate'],
    ['brow.outerUpRight', 'browOuterUpRight', 'moderate'],
  ],
  'face.blendshape.eye': [
    ['eye.blinkLeft', 'eyeBlinkLeft', 'easy'],
    ['eye.blinkRight', 'eyeBlinkRight', 'easy'],
    ['eye.squintLeft', 'eyeSquintLeft', 'moderate'],
    ['eye.squintRight', 'eyeSquintRight', 'moderate'],
    ['eye.wideLeft', 'eyeWideLeft', 'moderate'],
    ['eye.wideRight', 'eyeWideRight', 'moderate'],
  ],
  'face.blendshape.gaze': [
    ['gaze.lookInLeft', 'eyeLookInLeft', 'moderate'],
    ['gaze.lookInRight', 'eyeLookInRight', 'moderate'],
    ['gaze.lookOutLeft', 'eyeLookOutLeft', 'moderate'],
    ['gaze.lookOutRight', 'eyeLookOutRight', 'moderate'],
    ['gaze.lookUpLeft', 'eyeLookUpLeft', 'moderate'],
    ['gaze.lookUpRight', 'eyeLookUpRight', 'moderate'],
    ['gaze.lookDownLeft', 'eyeLookDownLeft', 'moderate'],
    ['gaze.lookDownRight', 'eyeLookDownRight', 'moderate'],
  ],
  'face.blendshape.cheek': [
    ['cheek.puff', 'cheekPuff', 'easy'],
    ['cheek.squintLeft', 'cheekSquintLeft', 'involuntary'],
    ['cheek.squintRight', 'cheekSquintRight', 'involuntary'],
  ],
  'face.blendshape.nose': [
    ['nose.sneerLeft', 'noseSneerLeft', 'involuntary'],
    ['nose.sneerRight', 'noseSneerRight', 'involuntary'],
  ],
};

function blendshapeFeatures(): FaceFeature[] {
  const out: FaceFeature[] = [];
  for (const [group, rows] of Object.entries(BLENDSHAPE_GROUPS)) {
    for (const [suffix, bsName, ctrl] of rows) {
      out.push({
        id: `face.blendshape.${suffix}`,
        group,
        source: 'face',
        range: [0, 1],
        controllability: ctrl,
        description: `MediaPipe blendshape ${bsName}`,
        compute: (ctx) => ctx.bs(bsName),
      });
    }
  }
  return out;
}

// ---- Geometric mesh helpers ------------------------------------------------
// Coordinate accessors that propagate NaN (a missing point → the feature reads
// unavailable, not a crash). `landmarks` are image-normalized (x,y in 0..1).

const lx = (l: FaceLandmarks | undefined, i: number): number => L(l, i)?.x ?? NaN;
const ly = (l: FaceLandmarks | undefined, i: number): number => L(l, i)?.y ?? NaN;
const lz = (l: FaceLandmarks | undefined, i: number): number => L(l, i)?.z ?? NaN;

/** Vertical position of the first present landmark among `idx` (iris-with-lid
 *  fallback for the brow-raise features, per the appendix). `NaN` if none. */
function firstY(l: FaceLandmarks | undefined, idx: number[]): number {
  for (const i of idx) {
    const p = L(l, i);
    if (p) return p.y;
  }
  return NaN;
}

// ---- Geometric features ----------------------------------------------------

function geomFeatures(): FaceFeature[] {
  const g = (
    id: string,
    group: string,
    controllability: Controllability,
    compute: (l: FaceLandmarks | undefined, iod: number) => number,
    description: string,
  ): FaceFeature => ({
    id,
    group,
    source: 'face',
    controllability,
    description,
    compute: (ctx) => (ctx.hasLandmarks ? compute(ctx.landmarks, ctx.iod) : NaN),
  });

  return [
    // face.geom.eye
    g('face.geom.eye.earLeft', 'face.geom.eye', 'moderate', (l) => ear(l, 'left'), 'Eye aspect ratio, subject-left'),
    g('face.geom.eye.earRight', 'face.geom.eye', 'moderate', (l) => ear(l, 'right'), 'Eye aspect ratio, subject-right'),
    g('face.geom.eye.earAvg', 'face.geom.eye', 'easy', (l) => (ear(l, 'left') + ear(l, 'right')) / 2, 'Mean eye aspect ratio (blink/squint)'),
    // Subject-left eye is the 263-side (`*R` constants); subject-right is the 33-side.
    g('face.geom.eye.apertureLeft', 'face.geom.eye', 'moderate', (l, iod) => safeDiv(dL(l, FL.eyeUpperR, FL.eyeLowerR), iod), 'Subject-left eye vertical opening / IOD'),
    g('face.geom.eye.apertureRight', 'face.geom.eye', 'moderate', (l, iod) => safeDiv(dL(l, FL.eyeUpperL, FL.eyeLowerL), iod), 'Subject-right eye vertical opening / IOD'),
    // face.geom.mouth
    g('face.geom.mouth.aspectRatio', 'face.geom.mouth', 'easy', (l) => mar(l), 'Mouth aspect ratio (open/close)'),
    g('face.geom.mouth.openness', 'face.geom.mouth', 'easy', (l, iod) => safeDiv(dL(l, FL.lipTopInner, FL.lipBottomInner), iod), 'Inner-lip gap / IOD'),
    g('face.geom.mouth.width', 'face.geom.mouth', 'moderate', (l, iod) => safeDiv(dL(l, FL.mouthCornerL, FL.mouthCornerR), iod), 'Mouth corner-to-corner width / IOD'),
    g('face.geom.mouth.cornerPullLeft', 'face.geom.mouth', 'moderate', (l, iod) => safeDiv((ly(l, FL.lipTopInner) + ly(l, FL.lipBottomInner)) / 2 - ly(l, FL.mouthCornerL), iod), 'Left corner lift above lip center / IOD'),
    g('face.geom.mouth.cornerPullRight', 'face.geom.mouth', 'moderate', (l, iod) => safeDiv((ly(l, FL.lipTopInner) + ly(l, FL.lipBottomInner)) / 2 - ly(l, FL.mouthCornerR), iod), 'Right corner lift above lip center / IOD'),
    g('face.geom.mouth.protrusion', 'face.geom.mouth', 'moderate', (l, iod) => safeDiv(lz(l, FL.noseTip) - (lz(l, FL.lipTopInner) + lz(l, FL.lipBottomInner)) / 2, iod), 'Lip forward protrusion (relative z) / IOD'),
    // face.geom.brow (iris-with-lid fallback for the vertical reference)
    g('face.geom.brow.raiseLeft', 'face.geom.brow', 'easy', (l, iod) => safeDiv(firstY(l, [FL.irisR, FL.eyeUpperR]) - ly(l, FL.browMidR), iod), 'Subject-left brow height above eye / IOD'),
    g('face.geom.brow.raiseRight', 'face.geom.brow', 'easy', (l, iod) => safeDiv(firstY(l, [FL.irisL, FL.eyeUpperL]) - ly(l, FL.browMidL), iod), 'Subject-right brow height above eye / IOD'),
    g('face.geom.brow.raiseAvg', 'face.geom.brow', 'easy', (l, iod) => {
      const a = safeDiv(firstY(l, [FL.irisR, FL.eyeUpperR]) - ly(l, FL.browMidR), iod);
      const b = safeDiv(firstY(l, [FL.irisL, FL.eyeUpperL]) - ly(l, FL.browMidL), iod);
      return (a + b) / 2;
    }, 'Mean brow raise / IOD'),
    g('face.geom.brow.furrow', 'face.geom.brow', 'moderate', (l, iod) => safeDiv(dL(l, FL.browInnerL, FL.browInnerR), iod), 'Inner-brow separation / IOD (inverse of furrow)'),
    g('face.geom.brow.innerRaise', 'face.geom.brow', 'easy', (l, iod) => safeDiv((firstY(l, [FL.irisL, FL.eyeUpperL]) + firstY(l, [FL.irisR, FL.eyeUpperR])) / 2 - (ly(l, FL.browInnerL) + ly(l, FL.browInnerR)) / 2, iod), 'Inner-brow height above eyes / IOD'),
    // face.geom.nose
    g('face.geom.nose.wrinkle', 'face.geom.nose', 'involuntary', (l, iod) => safeDiv(dL(l, FL.noseAlaL, FL.eyeInnerL) + dL(l, FL.noseAlaR, FL.eyeInnerR), 2 * iod), 'Nose-to-inner-eye compression / IOD'),
    // face.geom.cheek
    g('face.geom.cheek.raiseLeft', 'face.geom.cheek', 'moderate', (l, iod) => safeDiv(ly(l, FL.cheekR) - ly(l, FL.eyeLowerR), iod), 'Subject-left cheek raise toward eye / IOD'),
    g('face.geom.cheek.raiseRight', 'face.geom.cheek', 'moderate', (l, iod) => safeDiv(ly(l, FL.cheekL) - ly(l, FL.eyeLowerL), iod), 'Subject-right cheek raise toward eye / IOD'),
    // face.geom.jaw
    g('face.geom.jaw.lateralShift', 'face.geom.jaw', 'easy', (l, iod) => safeDiv(lx(l, FL.chin) - lx(l, FL.glabella), iod), 'Chin horizontal offset from face center / IOD'),
    g('face.geom.jaw.drop', 'face.geom.jaw', 'easy', (l, iod) => safeDiv(ly(l, FL.chin) - ly(l, FL.subnasale), iod), 'Chin drop below nose base / IOD'),
    g('face.geom.jaw.thrust', 'face.geom.jaw', 'moderate', (l, iod) => safeDiv(lz(l, FL.chin) - lz(l, FL.glabella), iod), 'Chin forward thrust (relative z) / IOD'),
  ];
}

// ---- Gaze (iris offset within the eye) -------------------------------------

function gazeFeatures(): FaceFeature[] {
  // Each returns NaN unless iris landmarks are present (division guarded).
  const gz = (id: string, controllability: Controllability, compute: (l: FaceLandmarks | undefined) => number, description: string): FaceFeature => ({
    id,
    group: 'face.gaze',
    source: 'face',
    controllability,
    description,
    compute: (ctx) => (ctx.hasLandmarks ? compute(ctx.landmarks) : NaN),
  });
  const xLeft = (l: FaceLandmarks | undefined) => safeDiv(lx(l, FL.irisR) - (lx(l, FL.eyeInnerR) + lx(l, FL.eyeOuterR)) / 2, dL(l, FL.eyeInnerR, FL.eyeOuterR) / 2);
  const xRight = (l: FaceLandmarks | undefined) => safeDiv(lx(l, FL.irisL) - (lx(l, FL.eyeOuterL) + lx(l, FL.eyeInnerL)) / 2, dL(l, FL.eyeOuterL, FL.eyeInnerL) / 2);
  const yLeft = (l: FaceLandmarks | undefined) => safeDiv(ly(l, FL.irisR) - (ly(l, FL.eyeUpperR) + ly(l, FL.eyeLowerR)) / 2, dL(l, FL.eyeUpperR, FL.eyeLowerR) / 2);
  const yRight = (l: FaceLandmarks | undefined) => safeDiv(ly(l, FL.irisL) - (ly(l, FL.eyeUpperL) + ly(l, FL.eyeLowerL)) / 2, dL(l, FL.eyeUpperL, FL.eyeLowerL) / 2);
  return [
    gz('face.gaze.xLeft', 'moderate', xLeft, 'Subject-left iris horizontal offset'),
    gz('face.gaze.xRight', 'moderate', xRight, 'Subject-right iris horizontal offset'),
    gz('face.gaze.x', 'moderate', (l) => (xLeft(l) + xRight(l)) / 2, 'Mean horizontal gaze'),
    gz('face.gaze.yLeft', 'moderate', yLeft, 'Subject-left iris vertical offset'),
    gz('face.gaze.yRight', 'moderate', yRight, 'Subject-right iris vertical offset'),
    gz('face.gaze.y', 'moderate', (l) => (yLeft(l) + yRight(l)) / 2, 'Mean vertical gaze'),
    gz('face.gaze.vergence', 'involuntary', (l) => safeDiv((lx(l, FL.eyeInnerL) - lx(l, FL.irisL)) - (lx(l, FL.irisR) - lx(l, FL.eyeInnerR)), iodOf(l)), 'Eye vergence (crossing) / IOD'),
  ];
}

// ---- Head pose + head position ---------------------------------------------

function headFeatures(): FaceFeature[] {
  const pose = (id: string, key: 'yaw' | 'pitch' | 'roll', description: string): FaceFeature => ({
    id,
    group: 'face.head',
    source: 'face',
    controllability: 'easy',
    description,
    compute: (ctx) => (ctx.headPose ? ctx.headPose[key] : NaN),
  });
  return [
    pose('face.head.yaw', 'yaw', 'Head turn left/right (degrees)'),
    pose('face.head.pitch', 'pitch', 'Head nod up/down (degrees)'),
    pose('face.head.roll', 'roll', 'Head tilt ear-to-shoulder (degrees)'),
    { id: 'face.head.x', group: 'face.head', source: 'face', controllability: 'easy', description: 'Nose-tip horizontal position', compute: (ctx) => (ctx.hasLandmarks ? lx(ctx.landmarks, FL.noseTip) : NaN) },
    { id: 'face.head.y', group: 'face.head', source: 'face', controllability: 'easy', description: 'Nose-tip vertical position', compute: (ctx) => (ctx.hasLandmarks ? ly(ctx.landmarks, FL.noseTip) : NaN) },
    { id: 'face.head.scale', group: 'face.head', source: 'face', controllability: 'easy', description: 'Face scale (IOD) — proxy for camera distance', compute: (ctx) => ctx.iod },
    {
      id: 'face.head.distanceProxy',
      group: 'face.head',
      source: 'face',
      controllability: 'easy',
      description: 'Inverse iris diameter — a monotone distance proxy',
      compute: (ctx) => {
        if (!ctx.hasLandmarks) return NaN;
        const dr = dL(ctx.landmarks, FL.irisRright, FL.irisRleft);
        const dl = dL(ctx.landmarks, FL.irisLright, FL.irisLleft);
        const a = safeDiv(1, dr);
        const b = safeDiv(1, dl);
        // Average the two irises when both present; else whichever is finite.
        if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) / 2;
        return Number.isFinite(a) ? a : b;
      },
    },
  ];
}

// ---- Left/right symmetry ---------------------------------------------------

function symmetryFeatures(): FaceFeature[] {
  return [
    { id: 'face.symmetry.smile', group: 'face.symmetry', source: 'face', controllability: 'moderate', description: 'Smile right - left (asymmetric grin)', compute: (ctx) => ctx.bs('mouthSmileRight') - ctx.bs('mouthSmileLeft') },
    { id: 'face.symmetry.browOuter', group: 'face.symmetry', source: 'face', controllability: 'moderate', description: 'Outer-brow raise right - left', compute: (ctx) => ctx.bs('browOuterUpRight') - ctx.bs('browOuterUpLeft') },
    { id: 'face.symmetry.eye', group: 'face.symmetry', source: 'face', controllability: 'moderate', description: 'EAR right - left (wink)', compute: (ctx) => (ctx.hasLandmarks ? ear(ctx.landmarks, 'right') - ear(ctx.landmarks, 'left') : NaN) },
    { id: 'face.symmetry.mouthCorner', group: 'face.symmetry', source: 'face', controllability: 'moderate', description: 'Mouth-corner height difference / IOD', compute: (ctx) => (ctx.hasLandmarks ? safeDiv(ly(ctx.landmarks, FL.mouthCornerL) - ly(ctx.landmarks, FL.mouthCornerR), ctx.iod) : NaN) },
    { id: 'face.symmetry.cheek', group: 'face.symmetry', source: 'face', controllability: 'involuntary', description: 'Cheek squint right - left', compute: (ctx) => ctx.bs('cheekSquintRight') - ctx.bs('cheekSquintLeft') },
    { id: 'face.symmetry.mouthSideShift', group: 'face.symmetry', source: 'face', controllability: 'easy', description: 'Mouth shift right - left', compute: (ctx) => ctx.bs('mouthRight') - ctx.bs('mouthLeft') },
  ];
}

// ---- FACS Action-Unit approximations (blendshape combinations) -------------
// One scalar per AU. The two "combined" AUs from the appendix (AU51-54 head turn,
// AU61-64 eyes-turn) are omitted: they are two-axis and duplicate face.head.* /
// face.gaze.*, which are already first-class features.

function auFeatures(): FaceFeature[] {
  const au = (id: string, controllability: Controllability, compute: (ctx: FaceCtx) => number, description: string): FaceFeature => ({
    id,
    group: 'face.au',
    source: 'face',
    range: [0, 1],
    controllability,
    description,
    compute,
  });
  const mean2 = (ctx: FaceCtx, a: string, b: string) => (ctx.bs(a) + ctx.bs(b)) / 2;
  return [
    au('face.au.au1_innerBrowRaiser', 'easy', (c) => c.bs('browInnerUp'), 'AU1 inner brow raiser'),
    au('face.au.au2_outerBrowRaiser', 'moderate', (c) => mean2(c, 'browOuterUpLeft', 'browOuterUpRight'), 'AU2 outer brow raiser'),
    au('face.au.au4_browLowerer', 'moderate', (c) => mean2(c, 'browDownLeft', 'browDownRight'), 'AU4 brow lowerer'),
    au('face.au.au5_upperLidRaiser', 'moderate', (c) => mean2(c, 'eyeWideLeft', 'eyeWideRight'), 'AU5 upper lid raiser'),
    au('face.au.au6_cheekRaiser', 'moderate', (c) => mean2(c, 'cheekSquintLeft', 'cheekSquintRight'), 'AU6 cheek raiser (Duchenne)'),
    au('face.au.au7_lidTightener', 'moderate', (c) => mean2(c, 'eyeSquintLeft', 'eyeSquintRight'), 'AU7 lid tightener'),
    au('face.au.au9_noseWrinkler', 'involuntary', (c) => mean2(c, 'noseSneerLeft', 'noseSneerRight'), 'AU9 nose wrinkler'),
    au('face.au.au10_upperLipRaiser', 'moderate', (c) => mean2(c, 'mouthUpperUpLeft', 'mouthUpperUpRight'), 'AU10 upper lip raiser'),
    au('face.au.au12_lipCornerPuller', 'easy', (c) => mean2(c, 'mouthSmileLeft', 'mouthSmileRight'), 'AU12 lip corner puller (smile)'),
    au('face.au.au14_dimpler', 'involuntary', (c) => mean2(c, 'mouthDimpleLeft', 'mouthDimpleRight'), 'AU14 dimpler'),
    au('face.au.au15_lipCornerDepressor', 'moderate', (c) => mean2(c, 'mouthFrownLeft', 'mouthFrownRight'), 'AU15 lip corner depressor (frown)'),
    au('face.au.au17_chinRaiser', 'moderate', (c) => c.bs('mouthShrugLower'), 'AU17 chin raiser'),
    au('face.au.au18_lipPucker', 'easy', (c) => c.bs('mouthPucker'), 'AU18 lip pucker'),
    au('face.au.au20_lipStretcher', 'moderate', (c) => mean2(c, 'mouthStretchLeft', 'mouthStretchRight'), 'AU20 lip stretcher'),
    au('face.au.au22_lipFunneler', 'moderate', (c) => c.bs('mouthFunnel'), 'AU22 lip funneler'),
    au('face.au.au23_lipTightener', 'moderate', (c) => mean2(c, 'mouthPressLeft', 'mouthPressRight'), 'AU23 lip tightener'),
    au('face.au.au25_lipsPart', 'easy', (c) => clamp01(1 - c.bs('mouthClose')), 'AU25 lips part'),
    au('face.au.au26_jawDrop', 'easy', (c) => c.bs('jawOpen'), 'AU26 jaw drop'),
    au('face.au.au28_lipSuck', 'moderate', (c) => mean2(c, 'mouthRollUpper', 'mouthRollLower'), 'AU28 lip suck'),
    au('face.au.au43_eyesClosed', 'easy', (c) => mean2(c, 'eyeBlinkLeft', 'eyeBlinkRight'), 'AU43 eyes closed'),
  ];
}

/** The complete face feature catalog (order = display order within the lab). */
export const FACE_FEATURES: readonly FaceFeature[] = [
  ...blendshapeFeatures(),
  ...geomFeatures(),
  ...gazeFeatures(),
  ...headFeatures(),
  ...symmetryFeatures(),
  ...auFeatures(),
];
