/**
 * The hand feature catalog: raw fingertip positions, per-finger flexion (joint
 * angles + curl), finger spread, palm orientation, whole-hand summaries, pinch/
 * gap/reach distances, and two-hand relational features — pure
 * {@link FeatureDef}s over a per-hand {@link HandCtx} (or {@link TwoHandCtx}).
 *
 * Features are authored SIDE-RELATIVE (id `index.curl`, group `hand.finger.flexion`);
 * the feature-vector node expands each over the detected hands into the final flat
 * ids `hand.left.index.curl` / `hand.right.index.curl`. Two-hand features are keyed
 * `hand.pair.*`.
 *
 * Load-bearing corrections from the #119 research appendix are implemented here:
 *  - Every angle is {@link angleAt}/{@link angleBetween} (acos of a dot product
 *    CLAMPED to [-1, 1]) so a float-epsilon overshoot can't NaN a meter.
 *  - `curl` is the RAW radian sum of three `(pi - jointAngle)` terms (theoretical
 *    range 0..3pi); it is NOT divided by a fixed 2pi — the online normalizer does
 *    the (per-user, open->0 / fist->1) ranging.
 *  - `spread.thumbIndex` uses the robust base-vector variant by default
 *    (thumb-CMC and index-MCP directions from the wrist), not tip vectors, so a
 *    curled index can't corrupt it.
 *  - `palm.pitch` uses `asin(clamp(-U.y, -1, 1))` (up-positive, MediaPipe world y
 *    points DOWN) to read the same direction as `tilt`/`dy`.
 *  - `palm.roll` is measured in the plane perpendicular to the pointing axis U
 *    against world-up, so it is decoupled from pitch/yaw (not `atan2(N.x, N.y)`).
 *  - `palm.normal*` signs flip with handedness/world-axis; per-hand sign
 *    calibration is left to the mapping layer (documented, not baked in).
 *  - Distances are RAW palm-span ratios (pinch/gap/reach/opposition): low = close.
 *    Direction/inversion is a display/mapping concern, so no magic thresholds here.
 */
import { LM } from '@/nodes/domain';
import { angleAt, angleBetween, centroid, cross, dist2, dist3, normalize, sub, type Vec3 } from './math';
import type { FeatureDef, HandCtx, TwoHandCtx } from './types';

type HandFeature = FeatureDef<HandCtx>;
type PairFeature = FeatureDef<TwoHandCtx>;

/** The active coordinate-set point for orientation/angle/distance features:
 *  world when present (pose-invariant), else image. */
const pt = (c: HandCtx, i: number): Vec3 | undefined => (c.useWorld ? c.W(i) : c.P(i));

/** Midpoint of two points, or undefined if either is missing. */
function mid(a: Vec3 | undefined, b: Vec3 | undefined): Vec3 | undefined {
  return a && b ? centroid([a, b]) : undefined;
}

/** The palm centroid (wrist + four MCP knuckles) in the active coordinate set. */
function palmCentroid(c: HandCtx): Vec3 | undefined {
  const pts = [LM.wrist, LM.index_mcp, LM.middle_mcp, LM.ring_mcp, LM.pinky_mcp]
    .map((i) => pt(c, i))
    .filter((p): p is Vec3 => !!p);
  return pts.length ? centroid(pts) : undefined;
}

// ---- Per-finger flexion ----------------------------------------------------

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
type Finger = (typeof FINGERS)[number];

/** MCP/PIP/DIP joint triplets per finger (thumb uses CMC/MCP/IP). Each is the
 *  (A, B, C) whose interior angle at B is the joint angle. */
const FLEX_TRIPLETS: Record<Finger, { mcp: [number, number, number]; pip: [number, number, number]; dip: [number, number, number] }> = {
  thumb: { mcp: [0, 1, 2], pip: [1, 2, 3], dip: [2, 3, 4] },
  index: { mcp: [0, 5, 6], pip: [5, 6, 7], dip: [6, 7, 8] },
  middle: { mcp: [0, 9, 10], pip: [9, 10, 11], dip: [10, 11, 12] },
  ring: { mcp: [0, 13, 14], pip: [13, 14, 15], dip: [14, 15, 16] },
  pinky: { mcp: [0, 17, 18], pip: [17, 18, 19], dip: [18, 19, 20] },
};

const jointAngle = (c: HandCtx, triplet: [number, number, number]): number =>
  angleAt(pt(c, triplet[0]), pt(c, triplet[1]), pt(c, triplet[2]));

/** Raw curl of one finger: sum of three `(pi - jointAngle)` terms (0..3pi). */
function fingerCurl(c: HandCtx, finger: Finger): number {
  const t = FLEX_TRIPLETS[finger];
  const a = jointAngle(c, t.mcp);
  const b = jointAngle(c, t.pip);
  const d = jointAngle(c, t.dip);
  return Math.PI - a + (Math.PI - b) + (Math.PI - d);
}

// ---- Finger spread ---------------------------------------------------------

/** Adjacent MCP->PIP direction of a finger (for the spread angles). */
const SPREAD_DIR: Record<'index' | 'middle' | 'ring' | 'pinky', [number, number]> = {
  index: [LM.index_mcp, LM.index_pip],
  middle: [LM.middle_mcp, LM.middle_pip],
  ring: [LM.ring_mcp, LM.ring_pip],
  pinky: [LM.pinky_mcp, LM.pinky_pip],
};

function proximalDir(c: HandCtx, finger: 'index' | 'middle' | 'ring' | 'pinky'): Vec3 | undefined {
  const [mcp, pip] = SPREAD_DIR[finger];
  const a = pt(c, mcp);
  const b = pt(c, pip);
  return a && b ? normalize(sub(b, a)) : undefined;
}

function adjacentSpread(c: HandCtx, a: 'index' | 'middle' | 'ring' | 'pinky', b: 'index' | 'middle' | 'ring' | 'pinky'): number {
  const da = proximalDir(c, a);
  const db = proximalDir(c, b);
  if (!da || !db) return NaN;
  return angleBetween(da, db);
}

// ---- Palm orientation basis ------------------------------------------------

/** The hand pointing axis U = norm(midpoint(index-MCP, pinky-MCP) - wrist). */
function pointingAxis(c: HandCtx): Vec3 | undefined {
  const m = mid(pt(c, LM.index_mcp), pt(c, LM.pinky_mcp));
  const w = pt(c, LM.wrist);
  return m && w ? normalize(sub(m, w)) : undefined;
}

/** The palm normal N = norm(cross(wrist->index-MCP, wrist->pinky-MCP)). Its sign
 *  flips with handedness / world-axis convention — calibrate per hand downstream. */
function palmNormal(c: HandCtx): Vec3 | undefined {
  const w = pt(c, LM.wrist);
  const i = pt(c, LM.index_mcp);
  const p = pt(c, LM.pinky_mcp);
  if (!w || !i || !p) return undefined;
  return normalize(cross(sub(i, w), sub(p, w)));
}

// ---- Distance helpers (raw palm-span ratios) -------------------------------

const TIP: Record<Finger, number> = {
  thumb: LM.thumb_tip,
  index: LM.index_tip,
  middle: LM.middle_tip,
  ring: LM.ring_tip,
  pinky: LM.pinky_tip,
};

/** dist3(a, b) / palmSpan in the active coordinate set, or NaN if degenerate. */
function spanRatio(c: HandCtx, a: number, b: number): number {
  const pa = pt(c, a);
  const pb = pt(c, b);
  if (!pa || !pb || !(c.palmSpan > 1e-9)) return NaN;
  return dist3(pa, pb) / c.palmSpan;
}

// ---- Side-relative feature templates ---------------------------------------

function positionFeatures(): HandFeature[] {
  const out: HandFeature[] = [];
  const imgX = (c: HandCtx, i: number): number => {
    const p = c.P(i);
    if (!p || !(c.width > 0)) return NaN;
    const x = p.x / c.width;
    return c.mirrorX ? 1 - x : x;
  };
  const imgY = (c: HandCtx, i: number): number => {
    const p = c.P(i);
    return p && c.height > 0 ? p.y / c.height : NaN;
  };
  out.push(
    { id: 'wrist.x', group: 'hand.position.raw', source: 'hand', range: [0, 1], controllability: 'easy', description: 'Wrist horizontal position', compute: (c) => imgX(c, LM.wrist) },
    { id: 'wrist.y', group: 'hand.position.raw', source: 'hand', range: [0, 1], controllability: 'easy', description: 'Wrist vertical position', compute: (c) => imgY(c, LM.wrist) },
    { id: 'palm.x', group: 'hand.position.raw', source: 'hand', range: [0, 1], controllability: 'easy', description: 'Palm-center horizontal position', compute: (c) => { const cen = palmCentroidImage(c); return cen && c.width > 0 ? (c.mirrorX ? 1 - cen.x / c.width : cen.x / c.width) : NaN; } },
    { id: 'palm.y', group: 'hand.position.raw', source: 'hand', range: [0, 1], controllability: 'easy', description: 'Palm-center vertical position', compute: (c) => { const cen = palmCentroidImage(c); return cen && c.height > 0 ? cen.y / c.height : NaN; } },
    { id: 'depthZ', group: 'hand.position.raw', source: 'hand', controllability: 'moderate', description: 'Wrist relative depth (uncalibrated sign/scale)', compute: (c) => c.P(LM.wrist)?.z ?? NaN },
  );
  for (const f of FINGERS) {
    out.push(
      { id: `${f}.tip.x`, group: 'hand.position.raw', source: 'hand', range: [0, 1], controllability: 'easy', description: `${f} fingertip horizontal position`, compute: (c) => imgX(c, TIP[f]) },
      { id: `${f}.tip.y`, group: 'hand.position.raw', source: 'hand', range: [0, 1], controllability: 'easy', description: `${f} fingertip vertical position`, compute: (c) => imgY(c, TIP[f]) },
    );
  }
  return out;
}

/** Palm centroid in IMAGE coordinates (for the raw-position features). */
function palmCentroidImage(c: HandCtx): Vec3 | undefined {
  const pts = [LM.wrist, LM.index_mcp, LM.middle_mcp, LM.ring_mcp, LM.pinky_mcp]
    .map((i) => c.P(i))
    .filter((p): p is Vec3 => !!p);
  return pts.length ? centroid(pts) : undefined;
}

function flexionFeatures(): HandFeature[] {
  const out: HandFeature[] = [];
  for (const f of FINGERS) {
    const t = FLEX_TRIPLETS[f];
    out.push(
      { id: `${f}.mcpAngle`, group: 'hand.finger.flexion', source: 'hand', range: [0, Math.PI], controllability: 'moderate', description: `${f} MCP joint angle (rad)`, compute: (c) => jointAngle(c, t.mcp) },
      { id: `${f}.pipAngle`, group: 'hand.finger.flexion', source: 'hand', range: [0, Math.PI], controllability: 'moderate', description: `${f} PIP joint angle (rad)`, compute: (c) => jointAngle(c, t.pip) },
      { id: `${f}.dipAngle`, group: 'hand.finger.flexion', source: 'hand', range: [0, Math.PI], controllability: 'involuntary', description: `${f} DIP joint angle (rad)`, compute: (c) => jointAngle(c, t.dip) },
      { id: `${f}.curl`, group: 'hand.finger.flexion', source: 'hand', range: [0, 3 * Math.PI], controllability: 'easy', description: `${f} total curl (rad sum, 0..3pi)`, compute: (c) => fingerCurl(c, f) },
    );
  }
  return out;
}

function spreadFeatures(): HandFeature[] {
  return [
    { id: 'spread.indexMiddle', group: 'hand.finger.spread', source: 'hand', range: [0, Math.PI], controllability: 'easy', description: 'Index-middle spread angle (rad)', compute: (c) => adjacentSpread(c, 'index', 'middle') },
    { id: 'spread.middleRing', group: 'hand.finger.spread', source: 'hand', range: [0, Math.PI], controllability: 'moderate', description: 'Middle-ring spread angle (rad)', compute: (c) => adjacentSpread(c, 'middle', 'ring') },
    { id: 'spread.ringPinky', group: 'hand.finger.spread', source: 'hand', range: [0, Math.PI], controllability: 'easy', description: 'Ring-pinky spread angle (rad)', compute: (c) => adjacentSpread(c, 'ring', 'pinky') },
    {
      id: 'spread.thumbIndex',
      group: 'hand.finger.spread',
      source: 'hand',
      range: [0, Math.PI],
      controllability: 'easy',
      description: 'Thumb-index spread (robust base-vector variant, rad)',
      compute: (c) => {
        const w = pt(c, LM.wrist);
        const thumbCmc = pt(c, LM.thumb_cmc);
        const indexMcp = pt(c, LM.index_mcp);
        if (!w || !thumbCmc || !indexMcp) return NaN;
        return angleBetween(sub(thumbCmc, w), sub(indexMcp, w));
      },
    },
    {
      id: 'thumb.opposition',
      group: 'hand.finger.spread',
      source: 'hand',
      controllability: 'moderate',
      description: 'Thumb-tip to pinky-MCP distance / palm span (low = opposed)',
      compute: (c) => spanRatio(c, LM.thumb_tip, LM.pinky_mcp),
    },
  ];
}

function orientationFeatures(): HandFeature[] {
  const normal = (axis: 'x' | 'y' | 'z'): HandFeature => ({
    id: `palm.normal${axis.toUpperCase()}`,
    group: 'hand.palm.orientation',
    source: 'hand',
    range: [-1, 1],
    controllability: 'easy',
    description: `Palm-normal ${axis} component (sign is handedness-dependent)`,
    compute: (c) => { const n = palmNormal(c); return n ? (axis === 'x' ? n.x : axis === 'y' ? n.y : n.z ?? 0) : NaN; },
  });
  return [
    normal('x'),
    normal('y'),
    normal('z'),
    {
      id: 'palm.pitch',
      group: 'hand.palm.orientation',
      source: 'hand',
      range: [-Math.PI / 2, Math.PI / 2],
      controllability: 'easy',
      description: 'Hand pointing pitch (up-positive, rad)',
      // asin(clamp(-U.y)): MediaPipe world y points DOWN, so negate for up-positive.
      compute: (c) => { const u = pointingAxis(c); return u ? Math.asin(Math.max(-1, Math.min(1, -u.y))) : NaN; },
    },
    {
      id: 'palm.yaw',
      group: 'hand.palm.orientation',
      source: 'hand',
      range: [-Math.PI, Math.PI],
      controllability: 'moderate',
      description: 'Hand pointing yaw (rad)',
      compute: (c) => { const u = pointingAxis(c); return u ? Math.atan2(u.x, u.z ?? 0) : NaN; },
    },
    {
      id: 'palm.roll',
      group: 'hand.palm.orientation',
      source: 'hand',
      range: [-Math.PI, Math.PI],
      controllability: 'easy',
      description: 'Hand roll about the pointing axis vs world-up (rad, decoupled from pitch/yaw)',
      compute: (c) => palmRoll(c),
    },
  ];
}

/**
 * Roll about the pointing axis U, measured against world-up in the plane
 * perpendicular to U — decoupled from pitch/yaw. `refPerp` is world-up projected
 * onto that plane; the hand's lateral (knuckle) axis is projected the same way;
 * the signed angle between them about U is the roll. (World-up = -Y since
 * MediaPipe world y points down.)
 */
function palmRoll(c: HandCtx): number {
  const u = pointingAxis(c);
  const iMcp = pt(c, LM.index_mcp);
  const pMcp = pt(c, LM.pinky_mcp);
  if (!u || !iMcp || !pMcp) return NaN;
  const lateral = normalize(sub(iMcp, pMcp)); // across the knuckles
  const worldUp: Vec3 = { x: 0, y: -1, z: 0 };
  const project = (v: Vec3): Vec3 => {
    const d = v.x * u.x + v.y * u.y + (v.z ?? 0) * (u.z ?? 0);
    return normalize({ x: v.x - d * u.x, y: v.y - d * u.y, z: (v.z ?? 0) - d * (u.z ?? 0) });
  };
  const refPerp = project(worldUp);
  const latPerp = project(lateral);
  const c1 = cross(refPerp, latPerp);
  const sinA = c1.x * u.x + c1.y * u.y + (c1.z ?? 0) * (u.z ?? 0);
  const cosA = refPerp.x * latPerp.x + refPerp.y * latPerp.y + (refPerp.z ?? 0) * (latPerp.z ?? 0);
  return Math.atan2(sinA, cosA);
}

function wholeFeatures(): HandFeature[] {
  return [
    {
      id: 'openness',
      group: 'hand.whole',
      source: 'hand',
      controllability: 'easy',
      description: 'Mean fingertip reach from wrist / palm span',
      compute: (c) => {
        const w = pt(c, LM.wrist);
        if (!w || !(c.palmSpan > 1e-9)) return NaN;
        const tips = [LM.index_tip, LM.middle_tip, LM.ring_tip, LM.pinky_tip].map((i) => pt(c, i)).filter((p): p is Vec3 => !!p);
        if (!tips.length) return NaN;
        return tips.reduce((s, t) => s + dist3(t, w), 0) / tips.length / c.palmSpan;
      },
    },
    {
      id: 'curlSum',
      group: 'hand.whole',
      source: 'hand',
      range: [0, 15 * Math.PI / 3],
      controllability: 'easy',
      description: 'Sum of all five finger curls (rad)',
      compute: (c) => FINGERS.reduce((s, f) => s + fingerCurl(c, f), 0),
    },
    {
      id: 'size',
      group: 'hand.whole',
      source: 'hand',
      controllability: 'easy',
      description: 'Wrist->middle-MCP image distance (px) — camera-distance proxy',
      compute: (c) => { const w = c.P(LM.wrist); const m = c.P(LM.middle_mcp); return w && m ? dist2(w, m) : NaN; },
    },
    {
      id: 'tilt',
      group: 'hand.whole',
      source: 'hand',
      range: [-Math.PI, Math.PI],
      controllability: 'easy',
      description: 'In-plane hand tilt (up-positive, rad)',
      compute: (c) => {
        const w = c.P(LM.wrist);
        const m = c.P(LM.middle_mcp);
        if (!w || !m) return NaN;
        // Negate y (image y points down) so "up" reads positive.
        return Math.atan2(-(m.y - w.y), (c.mirrorX ? -1 : 1) * (m.x - w.x));
      },
    },
    {
      id: 'wristFlexionProxy',
      group: 'hand.whole',
      source: 'hand',
      range: [-Math.PI / 2, Math.PI / 2],
      controllability: 'moderate',
      description: 'Pointing pitch as a wrist-flexion proxy (no forearm reference)',
      compute: (c) => { const u = pointingAxis(c); return u ? Math.asin(Math.max(-1, Math.min(1, -u.y))) : NaN; },
    },
    {
      id: 'aperture',
      group: 'hand.whole',
      source: 'hand',
      range: [0, Math.PI],
      controllability: 'moderate',
      description: 'Mean adjacent-finger spread (rad)',
      compute: (c) => {
        const a = adjacentSpread(c, 'index', 'middle');
        const b = adjacentSpread(c, 'middle', 'ring');
        const d = adjacentSpread(c, 'ring', 'pinky');
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(d)) return NaN;
        return (a + b + d) / 3;
      },
    },
  ];
}

function distanceFeatures(): HandFeature[] {
  const out: HandFeature[] = [];
  // Thumb->fingertip pinch distances.
  for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
    out.push({
      id: `pinch.thumb${f[0].toUpperCase()}${f.slice(1)}`,
      group: 'hand.distances.pinch',
      source: 'hand',
      controllability: f === 'index' || f === 'middle' ? 'easy' : 'moderate',
      description: `Thumb-tip to ${f}-tip distance / palm span (low = pinched)`,
      compute: (c) => spanRatio(c, LM.thumb_tip, TIP[f]),
    });
  }
  // Adjacent-tip gaps.
  const gaps: [string, number, number][] = [
    ['indexMiddle', LM.index_tip, LM.middle_tip],
    ['middleRing', LM.middle_tip, LM.ring_tip],
    ['ringPinky', LM.ring_tip, LM.pinky_tip],
  ];
  for (const [name, a, b] of gaps) {
    out.push({
      id: `gap.${name}`,
      group: 'hand.distances.pinch',
      source: 'hand',
      controllability: 'moderate',
      description: `${name} adjacent-tip gap / palm span`,
      compute: (c) => spanRatio(c, a, b),
    });
  }
  // Fingertip reach from the palm centroid.
  for (const f of FINGERS) {
    out.push({
      id: `reach.${f}`,
      group: 'hand.distances.pinch',
      source: 'hand',
      controllability: f === 'ring' || f === 'pinky' ? 'moderate' : 'easy',
      description: `${f}-tip distance from palm centroid / palm span`,
      compute: (c) => {
        const tip = pt(c, TIP[f]);
        const cen = palmCentroid(c);
        if (!tip || !cen || !(c.palmSpan > 1e-9)) return NaN;
        return dist3(tip, cen) / c.palmSpan;
      },
    });
  }
  return out;
}

// ---- Two-hand relational features ------------------------------------------

/** Image palm centroid + image size (wrist->middle-MCP) for a hand, or null. */
function imageFrame(c: HandCtx | undefined): { centroid: Vec3; size: number } | null {
  if (!c) return null;
  const cen = palmCentroidImage(c);
  const w = c.P(LM.wrist);
  const m = c.P(LM.middle_mcp);
  if (!cen || !w || !m) return null;
  const size = dist2(w, m);
  return size > 1e-9 ? { centroid: cen, size } : null;
}

function pairFeatures(): PairFeature[] {
  const both = (tc: TwoHandCtx): { L: { centroid: Vec3; size: number }; R: { centroid: Vec3; size: number }; meanSize: number } | null => {
    const L = imageFrame(tc.left);
    const R = imageFrame(tc.right);
    if (!L || !R) return null;
    return { L, R, meanSize: (L.size + R.size) / 2 };
  };
  const pf = (id: string, controllability: FeatureDef<TwoHandCtx>['controllability'], compute: (tc: TwoHandCtx) => number, description: string): PairFeature => ({
    id,
    group: 'hand.twohand.relational',
    source: 'hand',
    controllability,
    description,
    compute,
  });
  return [
    pf('pair.distance', 'easy', (tc) => { const b = both(tc); return b ? dist2(b.L.centroid, b.R.centroid) / b.meanSize : NaN; }, 'Inter-hand distance / mean hand size'),
    pf('pair.dx', 'easy', (tc) => { const b = both(tc); if (!b) return NaN; const dx = (b.R.centroid.x - b.L.centroid.x) / b.meanSize; return tc.mirrorX ? -dx : dx; }, 'Right-left horizontal offset / mean size'),
    pf('pair.dy', 'easy', (tc) => { const b = both(tc); return b ? -(b.R.centroid.y - b.L.centroid.y) / b.meanSize : NaN; }, 'Right-left vertical offset (up-positive) / mean size'),
    pf('pair.tilt', 'easy', (tc) => { const b = both(tc); if (!b) return NaN; return Math.atan2(-(b.R.centroid.y - b.L.centroid.y), (tc.mirrorX ? -1 : 1) * (b.R.centroid.x - b.L.centroid.x)); }, 'Two-hand line tilt (up-positive, rad)'),
    pf('pair.midX', 'easy', (tc) => { const b = both(tc); if (!b) return NaN; const w = tc.left?.width ?? tc.right?.width ?? 0; if (!(w > 0)) return NaN; const mx = (b.L.centroid.x + b.R.centroid.x) / 2 / w; return tc.mirrorX ? 1 - mx : mx; }, 'Midpoint horizontal position'),
    pf('pair.midY', 'easy', (tc) => { const b = both(tc); if (!b) return NaN; const h = tc.left?.height ?? tc.right?.height ?? 0; return h > 0 ? (b.L.centroid.y + b.R.centroid.y) / 2 / h : NaN; }, 'Midpoint vertical position'),
    pf('pair.sizeRatio', 'moderate', (tc) => { const b = both(tc); return b ? b.L.size / b.R.size : NaN; }, 'Left/right hand image-size ratio'),
  ];
}

/** Side-relative single-hand feature templates (expanded per detected hand). */
export const HAND_SIDE_FEATURES: readonly HandFeature[] = [
  ...positionFeatures(),
  ...flexionFeatures(),
  ...spreadFeatures(),
  ...orientationFeatures(),
  ...wholeFeatures(),
  ...distanceFeatures(),
];

/** Two-hand relational feature templates (keyed `hand.pair.*`). */
export const HAND_PAIR_FEATURES: readonly PairFeature[] = pairFeatures();
