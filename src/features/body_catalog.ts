/**
 * The body feature catalog (#186): joint angles, torso-normalised positions,
 * kinematics (speeds, accelerations, quantity of motion), shape (extension,
 * openness, stance, centre of mass, sway), the four Laban Effort factors over a
 * one-second window, and boolean relational features — pure {@link FeatureDef}s
 * over a per-frame {@link BodyCtx}.
 *
 * Where the numbers come from (docs/research/body-and-pace-research-map.md §3):
 *  - Every length is divided by the **torso length** (shoulder-mid to hip-mid), so a
 *    dancer walking toward the camera does not read as more energetic — the one
 *    omission paces flagged in kodokan's energy. Angles and shape read the world
 *    set when present (hip-centred metres, view-invariant); **every kinematic and
 *    effort feature reads the IMAGE set** divided by the image torso, because the
 *    world set is re-centred on the hips each frame and would be blind to walking,
 *    stepping and jumping — the motion a Quantity of Motion exists to see.
 *  - **Quantity of motion** is Camurri's: visibility-weighted mean landmark
 *    displacement per second, over the present-landmark mass (kodokan's
 *    `pose_motion_energy`, ported, plus the torso normalisation).
 *  - **Laban Effort** follows the computable definitions in Larboulette & Gibet
 *    and the SMPL-skeleton formulation: Weight = mean kinetic energy ½|v|²,
 *    Time = mean |a|, Space (directness) = path length / net displacement,
 *    Flow = mean jerk — each over the window the node keeps (~1 s), on the six
 *    key joints (head, wrists, ankles, hip-mid).
 *  - **Relational** features are Müller's boolean geometric relations (hand above
 *    head, feet apart, knee bent, leaning), thresholded on body-relative lengths
 *    so they hold at any camera distance. They are emitted as 0/1 so the trainer's
 *    noise-unit machinery and the Lab meters treat them like any other scalar.
 *
 * Angles use {@link angleAt} (acos of a clamped dot product) so a float overshoot
 * can never NaN a meter. A degenerate frame (no torso, missing landmark) yields
 * NaN, which the vector node drops.
 */
import { BLM } from '@/nodes/domain';
import { angleAt, centroid, dist3, sub, type Vec3 } from './math';
import type { BodyCtx, FeatureDef, Invariance } from './types';

type BodyFeature = FeatureDef<BodyCtx>;

/** Radians → degrees, so angle meters read like the head-pose ones. */
const DEG = 180 / Math.PI;

/** The active-coordinate point (world when present, else image). */
const pt = (c: BodyCtx, i: number): Vec3 | undefined => (c.useWorld ? c.W(i) : c.P(i));

function mid(a: Vec3 | undefined, b: Vec3 | undefined): Vec3 | undefined {
  return a && b ? centroid([a, b]) : undefined;
}

/** `angleAt` in degrees, NaN when a point is missing. */
const jointDeg = (c: BodyCtx, a: number, b: number, d: number): number => {
  const v = angleAt(pt(c, a), pt(c, b), pt(c, d));
  return Number.isFinite(v) ? v * DEG : NaN;
};

/** A length in the active set divided by the torso length (NaN when degenerate). */
function torsoRatio(c: BodyCtx, a: Vec3 | undefined, b: Vec3 | undefined): number {
  if (!a || !b || !(c.torso > 1e-9)) return NaN;
  return dist3(a, b) / c.torso;
}

/** Image x normalised 0..1, mirrored for the selfie view; image y normalised 0..1. */
const imgX = (c: BodyCtx, i: number): number => {
  const p = c.P(i);
  if (!p || !(c.width > 0)) return NaN;
  const x = p.x / c.width;
  return c.mirrorX ? 1 - x : x;
};
const imgY = (c: BodyCtx, i: number): number => {
  const p = c.P(i);
  return p && c.height > 0 ? p.y / c.height : NaN;
};

/** Signed in-plane lean of the torso from vertical, degrees (image coordinates, y
 *  down): positive = shoulders displaced toward the subject's left. */
function torsoLeanDeg(c: BodyCtx): number {
  const s = mid(pt(c, BLM.left_shoulder), pt(c, BLM.right_shoulder));
  const h = mid(pt(c, BLM.left_hip), pt(c, BLM.right_hip));
  if (!s || !h) return NaN;
  const d = sub(s, h); // points up: d.y < 0 for an upright torso (y down)
  return Math.atan2(d.x, -d.y) * DEG;
}

/** Head tilt: the ear-to-ear line's angle from horizontal, degrees, signed. */
function headTiltDeg(c: BodyCtx): number {
  const l = pt(c, BLM.left_ear);
  const r = pt(c, BLM.right_ear);
  if (!l || !r) return NaN;
  const d = sub(l, r);
  return Math.atan2(d.y, d.x) * DEG;
}

// ---- Kinematics over the history the node keeps ----------------------------

/** The joints the kinematic and effort features track. */
const KEY_JOINTS = [BLM.nose, BLM.left_wrist, BLM.right_wrist, BLM.left_ankle, BLM.right_ankle] as const;

/** A sample as the kinematics read it: image points, image torso, and the gap to the
 *  next sample. The current frame is one of these too (its gap is irrelevant). */
interface KinSample {
  pt: (i: number) => Vec3 | undefined;
  torso: number;
  dtS: number;
}

/** The history plus the current frame, oldest first, all in IMAGE coordinates. */
function kinSamples(c: BodyCtx): KinSample[] {
  return [...c.history, { pt: c.P, torso: c.torsoImg, dtS: NaN }];
}

/** Speed of joint `i` across two consecutive samples, in torso lengths per second:
 *  the displacement over the OLDER sample's gap (its `dtS` is the seconds to the next
 *  sample — exactly the interval the displacement was measured over). */
function sampleSpeed(older: KinSample, newer: KinSample, i: number): number {
  const a = older.pt(i);
  const b = newer.pt(i);
  if (!a || !b || !(older.torso > 1e-9) || !(older.dtS > 0)) return NaN;
  return dist3(a, b) / older.torso / older.dtS;
}

/** Displacement of landmark `i` between the previous frame and this one, in torso
 *  units per second (NaN without a previous frame or a torso). */
function speedOf(c: BodyCtx, i: number): number {
  const prev = c.history[c.history.length - 1];
  if (!prev) return NaN;
  return sampleSpeed(prev, { pt: c.P, torso: c.torsoImg, dtS: NaN }, i);
}

/** A value with the time span it was measured over, so a derivative across samples of
 *  unequal spacing divides by the right interval (one late frame must not rescale a
 *  whole window). */
interface Timed {
  v: number;
  gap: number;
}

/** Per-gap speeds of joint `i` over the whole window (current frame included). */
function speedSeries(c: BodyCtx, i: number): Timed[] {
  const samples = kinSamples(c);
  const out: Timed[] = [];
  for (let k = 1; k < samples.length; k++) {
    const v = sampleSpeed(samples[k - 1], samples[k], i);
    if (Number.isFinite(v)) out.push({ v, gap: samples[k - 1].dtS });
  }
  return out;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** First difference of a timed series, each divided by the mean of its two adjacent
 *  spans (the interval between the two measurements' midpoints). */
function derivative(xs: Timed[]): Timed[] {
  const out: Timed[] = [];
  for (let k = 1; k < xs.length; k++) {
    const gap = (xs[k].gap + xs[k - 1].gap) / 2;
    if (!(gap > 0)) continue;
    out.push({ v: (xs[k].v - xs[k - 1].v) / gap, gap });
  }
  return out;
}

const values = (xs: Timed[]): number[] => xs.map((x) => x.v);

/** Acceleration magnitude of joint `i` (torso units / s²) at the latest gap. */
function accelOf(c: BodyCtx, i: number): number {
  const a = derivative(speedSeries(c, i));
  return a.length ? Math.abs(a[a.length - 1].v) : NaN;
}

/** Quantity of motion this frame: visibility-weighted mean landmark displacement,
 *  torso units per second, over the present-landmark mass (kodokan's formula), in
 *  image coordinates so a step or a jump counts. */
function quantityOfMotion(c: BodyCtx): number {
  const prev = c.history[c.history.length - 1];
  if (!prev || !(prev.torso > 1e-9) || !(prev.dtS > 0)) return NaN;
  let num = 0;
  let den = 0;
  for (let i = 0; i < 33; i++) {
    const a = prev.pt(i);
    const b = c.P(i);
    if (!a || !b) continue;
    const w = Math.min(c.vis(i), prev.vis(i));
    if (w < 0.2) continue;
    num += dist3(a, b) * w;
    den += w;
  }
  if (den <= 0) return NaN;
  return num / den / prev.torso / prev.dtS;
}

// ---- Laban Effort over the window ------------------------------------------

/** Mean over the key joints of a per-joint window statistic. */
function overKeyJoints(f: (i: number) => number): number {
  const vals = KEY_JOINTS.map(f).filter((v) => Number.isFinite(v));
  return vals.length ? mean(vals) : NaN;
}

const effortWeight = (c: BodyCtx): number => overKeyJoints((i) => {
  const s = values(speedSeries(c, i));
  return s.length ? mean(s.map((v) => 0.5 * v * v)) : NaN;
});
const effortTime = (c: BodyCtx): number => overKeyJoints((i) => {
  const a = values(derivative(speedSeries(c, i))).map(Math.abs);
  return a.length ? mean(a) : NaN;
});
const effortFlow = (c: BodyCtx): number => overKeyJoints((i) => {
  const j = values(derivative(derivative(speedSeries(c, i)))).map(Math.abs);
  return j.length ? mean(j) : NaN;
});
/** Directness: path length over net displacement of the two wrists' midpoint across
 *  the window (1 = a straight path; large = wandering). NaN when the net move is
 *  under a hundredth of a torso — a still body has no direction. */
function effortSpace(c: BodyCtx): number {
  const pts: Vec3[] = [];
  for (const s of kinSamples(c)) {
    const m = mid(s.pt(BLM.left_wrist), s.pt(BLM.right_wrist));
    if (m) pts.push(m);
  }
  if (pts.length < 3 || !(c.torsoImg > 1e-9)) return NaN;
  let path = 0;
  for (let k = 1; k < pts.length; k++) path += dist3(pts[k - 1], pts[k]);
  const net = dist3(pts[0], pts[pts.length - 1]);
  if (net < 0.01 * c.torsoImg) return NaN;
  return path / net;
}

// ---- Shape ------------------------------------------------------------------

function hipMid(c: BodyCtx): Vec3 | undefined {
  return mid(pt(c, BLM.left_hip), pt(c, BLM.right_hip));
}

/** Mean torso-ratio distance of the five extremities from the hip midpoint. */
function extension(c: BodyCtx): number {
  const h = hipMid(c);
  if (!h) return NaN;
  const ds = KEY_JOINTS.map((i) => torsoRatio(c, pt(c, i), h)).filter((v) => Number.isFinite(v));
  return ds.length ? mean(ds) : NaN;
}

/** Centroid of the visible image landmarks, normalised 0..1 (x mirrored). */
function centreOfMass(c: BodyCtx): { x: number; y: number } | undefined {
  const pts: Vec3[] = [];
  for (let i = 0; i < 33; i++) {
    const p = c.P(i);
    if (p && c.vis(i) >= 0.5) pts.push(p);
  }
  if (!pts.length || !(c.width > 0) || !(c.height > 0)) return undefined;
  const cen = centroid(pts);
  const x = cen.x / c.width;
  return { x: c.mirrorX ? 1 - x : x, y: cen.y / c.height };
}

/** Lateral velocity of the centre of mass, frame widths per second (mirrored). */
function sway(c: BodyCtx): number {
  const prev = c.history[c.history.length - 1];
  const now = centreOfMass(c);
  if (!prev || !now || !prev.com || !(prev.dtS > 0)) return NaN;
  return (now.x - prev.com.x) / prev.dtS;
}

// ---- Relations ---------------------------------------------------------------

const bool = (v: boolean): number => (v ? 1 : 0);

function shoulderWidth(c: BodyCtx): number {
  const a = pt(c, BLM.left_shoulder);
  const b = pt(c, BLM.right_shoulder);
  return a && b ? dist3(a, b) : NaN;
}

/** Is landmark `i` above landmark `j` in the image (smaller y)? NaN if either is missing. */
function above(c: BodyCtx, i: number, j: number): number {
  const a = c.P(i);
  const b = c.P(j);
  return a && b ? bool(a.y < b.y) : NaN;
}

// ---- Invariance labels ---------------------------------------------------------

const WORLD_GEOMETRY: readonly Invariance[] = ['scale', 'position', 'yaw', 'pitch', 'roll'];
const BODY_RELATIVE: readonly Invariance[] = ['scale', 'position'];

const GROUP_INVARIANCE: Record<string, readonly Invariance[]> = {
  'body.angle': WORLD_GEOMETRY,
  'body.pos': [],
  'body.kin': BODY_RELATIVE,
  'body.shape': BODY_RELATIVE,
  'body.effort': BODY_RELATIVE,
  'body.rel': BODY_RELATIVE,
  'body.rhythm': WORLD_GEOMETRY,
};

function withGroupInvariance(f: BodyFeature): BodyFeature {
  if (f.invariantTo !== undefined || GROUP_INVARIANCE[f.group] === undefined) return f;
  return { ...f, invariantTo: GROUP_INVARIANCE[f.group] };
}

// ---- The catalog -----------------------------------------------------------------

const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];
const J = (side: Side, name: 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'ear'): number =>
  BLM[`${side}_${name}` as keyof typeof BLM];

function angleFeatures(): BodyFeature[] {
  const out: BodyFeature[] = [];
  for (const s of SIDES) {
    out.push(
      { id: `body.angle.elbow.${s}`, group: 'body.angle', source: 'body', range: [0, 180], controllability: 'easy', description: `${s} elbow angle (degrees; 180 = straight)`, compute: (c) => jointDeg(c, J(s, 'shoulder'), J(s, 'elbow'), J(s, 'wrist')) },
      { id: `body.angle.knee.${s}`, group: 'body.angle', source: 'body', range: [0, 180], controllability: 'easy', description: `${s} knee angle (degrees; 180 = straight)`, compute: (c) => jointDeg(c, J(s, 'hip'), J(s, 'knee'), J(s, 'ankle')) },
      { id: `body.angle.hip.${s}`, group: 'body.angle', source: 'body', range: [0, 180], controllability: 'easy', description: `${s} hip angle: torso to thigh (degrees; 180 = upright)`, compute: (c) => jointDeg(c, J(s, 'shoulder'), J(s, 'hip'), J(s, 'knee')) },
      { id: `body.angle.shoulder.${s}`, group: 'body.angle', source: 'body', range: [0, 180], controllability: 'easy', description: `${s} arm raise: hip–shoulder–elbow angle (degrees; 0 = arm down, 180 = straight up)`, compute: (c) => jointDeg(c, J(s, 'hip'), J(s, 'shoulder'), J(s, 'elbow')) },
    );
  }
  out.push(
    { id: 'body.angle.torso.lean', group: 'body.angle', source: 'body', range: [-90, 90], invariantTo: BODY_RELATIVE, controllability: 'easy', description: 'Sideways lean of the torso from vertical (degrees, signed)', compute: torsoLeanDeg },
    { id: 'body.angle.head.tilt', group: 'body.angle', source: 'body', range: [-90, 90], invariantTo: BODY_RELATIVE, controllability: 'easy', description: 'Head tilt: ear-to-ear line from horizontal (degrees, signed)', compute: headTiltDeg },
  );
  return out;
}

function positionFeatures(): BodyFeature[] {
  const out: BodyFeature[] = [];
  for (const s of SIDES) {
    out.push(
      { id: `body.pos.wrist.${s}.x`, group: 'body.pos', source: 'body', range: [0, 1], controllability: 'easy', description: `${s} wrist horizontal position (0..1, mirrored)`, compute: (c) => imgX(c, J(s, 'wrist')) },
      { id: `body.pos.wrist.${s}.y`, group: 'body.pos', source: 'body', range: [0, 1], controllability: 'easy', description: `${s} wrist vertical position (0 = top)`, compute: (c) => imgY(c, J(s, 'wrist')) },
      { id: `body.pos.wrist.${s}.rise`, group: 'body.pos', source: 'body', invariantTo: BODY_RELATIVE, controllability: 'easy', description: `${s} wrist height above the shoulder, in torso lengths (negative = below)`, compute: (c) => { const w = pt(c, J(s, 'wrist')); const sh = pt(c, J(s, 'shoulder')); return w && sh && c.torso > 1e-9 ? (sh.y - w.y) / c.torso : NaN; } },
      { id: `body.pos.ankle.${s}.y`, group: 'body.pos', source: 'body', range: [0, 1], controllability: 'easy', description: `${s} ankle vertical position (0 = top)`, compute: (c) => imgY(c, J(s, 'ankle')) },
    );
  }
  out.push(
    { id: 'body.pos.hip.y', group: 'body.pos', source: 'body', range: [0, 1], controllability: 'easy', description: 'Hip-midpoint vertical position (bounce)', compute: (c) => { const l = imgY(c, BLM.left_hip); const r = imgY(c, BLM.right_hip); return Number.isFinite(l) && Number.isFinite(r) ? (l + r) / 2 : NaN; } },
    { id: 'body.pos.hip.x', group: 'body.pos', source: 'body', range: [0, 1], controllability: 'easy', description: 'Hip-midpoint horizontal position (mirrored)', compute: (c) => { const l = imgX(c, BLM.left_hip); const r = imgX(c, BLM.right_hip); return Number.isFinite(l) && Number.isFinite(r) ? (l + r) / 2 : NaN; } },
    { id: 'body.pos.head.y', group: 'body.pos', source: 'body', range: [0, 1], controllability: 'easy', description: 'Head (nose) vertical position', compute: (c) => imgY(c, BLM.nose) },
  );
  return out;
}

function kinematicFeatures(): BodyFeature[] {
  const out: BodyFeature[] = [];
  for (const s of SIDES) {
    out.push(
      { id: `body.kin.speed.wrist.${s}`, group: 'body.kin', source: 'body', controllability: 'easy', description: `${s} wrist speed (torso lengths per second)`, compute: (c) => speedOf(c, J(s, 'wrist')) },
      { id: `body.kin.speed.ankle.${s}`, group: 'body.kin', source: 'body', controllability: 'easy', description: `${s} ankle speed (torso lengths per second)`, compute: (c) => speedOf(c, J(s, 'ankle')) },
      { id: `body.kin.accel.wrist.${s}`, group: 'body.kin', source: 'body', controllability: 'moderate', description: `${s} wrist acceleration magnitude (torso lengths per second squared)`, compute: (c) => accelOf(c, J(s, 'wrist')) },
    );
  }
  out.push(
    { id: 'body.kin.speed.head', group: 'body.kin', source: 'body', controllability: 'easy', description: 'Head speed (torso lengths per second)', compute: (c) => speedOf(c, BLM.nose) },
    { id: 'body.kin.qom', group: 'body.kin', source: 'body', controllability: 'easy', description: 'Quantity of motion: visibility-weighted mean landmark speed (torso lengths per second)', compute: quantityOfMotion },
  );
  return out;
}

function shapeFeatures(): BodyFeature[] {
  return [
    { id: 'body.shape.extension', group: 'body.shape', source: 'body', controllability: 'easy', description: 'Mean reach of head, hands and feet from the hips, in torso lengths (small = contracted, large = extended)', compute: extension },
    { id: 'body.shape.openness', group: 'body.shape', source: 'body', controllability: 'easy', description: 'Wrist-to-wrist distance over shoulder width', compute: (c) => { const a = pt(c, BLM.left_wrist); const b = pt(c, BLM.right_wrist); const sw = shoulderWidth(c); return a && b && sw > 1e-9 ? dist3(a, b) / sw : NaN; } },
    { id: 'body.shape.stance', group: 'body.shape', source: 'body', controllability: 'easy', description: 'Ankle-to-ankle distance over shoulder width', compute: (c) => { const a = pt(c, BLM.left_ankle); const b = pt(c, BLM.right_ankle); const sw = shoulderWidth(c); return a && b && sw > 1e-9 ? dist3(a, b) / sw : NaN; } },
    { id: 'body.shape.height', group: 'body.shape', source: 'body', controllability: 'easy', description: 'Head-to-ankle height in torso lengths (drops in a crouch)', compute: (c) => { const n = pt(c, BLM.nose); const am = mid(pt(c, BLM.left_ankle), pt(c, BLM.right_ankle)); return n && am && c.torso > 1e-9 ? (am.y - n.y) / c.torso : NaN; } },
    { id: 'body.shape.com.x', group: 'body.shape', source: 'body', range: [0, 1], invariantTo: [], controllability: 'easy', description: 'Centre of mass, horizontal (0..1, mirrored)', compute: (c) => centreOfMass(c)?.x ?? NaN },
    { id: 'body.shape.com.y', group: 'body.shape', source: 'body', range: [0, 1], invariantTo: [], controllability: 'easy', description: 'Centre of mass, vertical (0 = top)', compute: (c) => centreOfMass(c)?.y ?? NaN },
    { id: 'body.shape.sway', group: 'body.shape', source: 'body', invariantTo: ['scale'], controllability: 'easy', description: 'Lateral velocity of the centre of mass (frame widths per second, mirrored)', compute: sway },
  ];
}

function effortFeatures(): BodyFeature[] {
  return [
    { id: 'body.effort.weight', group: 'body.effort', source: 'body', controllability: 'moderate', description: 'Laban Weight: mean kinetic energy of the key joints over the window (light .. strong)', compute: effortWeight },
    { id: 'body.effort.time', group: 'body.effort', source: 'body', controllability: 'moderate', description: 'Laban Time: mean acceleration magnitude over the window (sustained .. sudden)', compute: effortTime },
    { id: 'body.effort.space', group: 'body.effort', source: 'body', controllability: 'moderate', description: 'Laban Space: path length over net displacement of the hands (1 = direct, large = indirect)', compute: effortSpace },
    { id: 'body.effort.flow', group: 'body.effort', source: 'body', controllability: 'moderate', description: 'Laban Flow: mean jerk magnitude over the window (free .. bound)', compute: effortFlow },
  ];
}

function relationFeatures(): BodyFeature[] {
  const out: BodyFeature[] = [];
  for (const s of SIDES) {
    out.push(
      { id: `body.rel.handAboveHead.${s}`, group: 'body.rel', source: 'body', range: [0, 1], controllability: 'easy', description: `${s} wrist above the head (1/0)`, compute: (c) => above(c, J(s, 'wrist'), BLM.nose) },
      { id: `body.rel.kneeBent.${s}`, group: 'body.rel', source: 'body', range: [0, 1], controllability: 'easy', description: `${s} knee bent past 40 degrees (1/0)`, compute: (c) => { const a = jointDeg(c, J(s, 'hip'), J(s, 'knee'), J(s, 'ankle')); return Number.isFinite(a) ? bool(a < 140) : NaN; } },
    );
  }
  out.push(
    { id: 'body.rel.handsCrossed', group: 'body.rel', source: 'body', range: [0, 1], controllability: 'easy', description: 'Wrists crossed over the midline (1/0)', compute: (c) => { const l = pt(c, BLM.left_wrist); const r = pt(c, BLM.right_wrist); return l && r ? bool(l.x < r.x) : NaN; } },
    { id: 'body.rel.feetApart', group: 'body.rel', source: 'body', range: [0, 1], controllability: 'easy', description: 'Feet wider than the shoulders (1/0)', compute: (c) => { const a = pt(c, BLM.left_ankle); const b = pt(c, BLM.right_ankle); const sw = shoulderWidth(c); return a && b && sw > 1e-9 ? bool(dist3(a, b) > sw) : NaN; } },
    { id: 'body.rel.leaningLeft', group: 'body.rel', source: 'body', range: [0, 1], controllability: 'easy', description: 'Torso leaning to the left by more than 10 degrees (1/0)', compute: (c) => { const l = torsoLeanDeg(c); return Number.isFinite(l) ? bool(l > 10) : NaN; } },
    { id: 'body.rel.leaningRight', group: 'body.rel', source: 'body', range: [0, 1], controllability: 'easy', description: 'Torso leaning to the right by more than 10 degrees (1/0)', compute: (c) => { const l = torsoLeanDeg(c); return Number.isFinite(l) ? bool(l < -10) : NaN; } },
    { id: 'body.rel.armsRaised', group: 'body.rel', source: 'body', range: [0, 1], controllability: 'easy', description: 'Both wrists above the shoulders (1/0)', compute: (c) => { const l = above(c, BLM.left_wrist, BLM.left_shoulder); const r = above(c, BLM.right_wrist, BLM.right_shoulder); return Number.isFinite(l) && Number.isFinite(r) ? bool(l === 1 && r === 1) : NaN; } },
  );
  return out;
}

/** Within this fraction of a period after an anchor the `beat` flag is 1. */
const BEAT_WINDOW = 0.15;

function rhythmFeatures(): BodyFeature[] {
  const p = (c: BodyCtx) => c.pulse;
  return [
    { id: 'body.rhythm.period', group: 'body.rhythm', source: 'body', invariantTo: WORLD_GEOMETRY, controllability: 'easy', description: 'The dance pulse period (seconds), from body-pulse', compute: (c) => p(c)?.periodS ?? NaN },
    { id: 'body.rhythm.bpm', group: 'body.rhythm', source: 'body', invariantTo: WORLD_GEOMETRY, controllability: 'easy', description: 'The dance pulse tempo (beats per minute)', compute: (c) => p(c)?.bpm ?? NaN },
    { id: 'body.rhythm.phase', group: 'body.rhythm', source: 'body', range: [0, 1], circular: true, invariantTo: WORLD_GEOMETRY, controllability: 'easy', description: 'Position within the current pulse, 0 at the anchor .. 1', compute: (c) => p(c)?.phase ?? NaN },
    { id: 'body.rhythm.confidence', group: 'body.rhythm', source: 'body', range: [0, 1], invariantTo: WORLD_GEOMETRY, controllability: 'involuntary', description: 'How much to trust the pulse (autocorrelation strength × anchor regularity)', compute: (c) => p(c)?.confidence ?? NaN },
    { id: 'body.rhythm.beat', group: 'body.rhythm', source: 'body', range: [0, 1], invariantTo: WORLD_GEOMETRY, controllability: 'easy', description: 'A pulse-synchronous gate: 1 just after each anchor, else 0', compute: (c) => { const ph = p(c)?.phase; return Number.isFinite(ph) ? ((ph as number) < BEAT_WINDOW ? 1 : 0) : NaN; } },
  ];
}

/** The body catalog, in display order; ids are final (no per-side expansion). */
export const BODY_FEATURES: readonly BodyFeature[] = [
  ...angleFeatures(),
  ...positionFeatures(),
  ...kinematicFeatures(),
  ...shapeFeatures(),
  ...effortFeatures(),
  ...relationFeatures(),
  ...rhythmFeatures(),
].map(withGroupInvariance);
