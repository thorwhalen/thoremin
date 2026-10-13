/**
 * Which body channel carries the beat, and at which level (#373, body-movement A1).
 *
 * The measurement behind `docs/research/body-conducting-and-pose-categories.md`: a pose
 * stream (`BodyFrame` per frame, as `scripts/video_to_pose.py` writes it) and a
 * reference beat grid (the clip's music, beat-tracked offline) go in; for every
 * channel, anchor event and metrical level, the beat-tracking scores come out.
 *
 * - A **channel** is one thing a body can mark a beat with: a height (head, hips, the
 *   trunk's centroid), a point moving in the image plane (wrists, elbows), the stride,
 *   the lateral sway, the torso's rotation, or the multi-joint deceleration envelope
 *   the design proposes for the visual-impact detector (§3.3). Positions are image
 *   coordinates over a running torso length, as the kinematic features and `body-pulse`
 *   measure them (the world set is re-centred on the hips and cannot see a bounce).
 * - An **event** is what an anchor is: `decel` (a peak of deceleration of the speed,
 *   the dance literature's visual beat; it has no direction, so a bounce fires it at
 *   both ends), `accel` (a peak of the acceleration magnitude, where observers place a
 *   conductor's beat), `impact` (the DIRECTIONAL deceleration of §3.3's vertical
 *   option: acceleration along the channel's axis toward one end, peaking as the
 *   movement brakes into the bottom, or the top) or `extremum` (the turning point of the
 *   channel's own axis). `impact` and `extremum` are scored at both polarities and the
 *   better kept, since which end of a bounce lands on the beat differs between people.
 * - A **level** is the beat, the half-bar or the bar. Anchors are picked once per level
 *   (at most one per half a level period, the impact detector told the level), and
 *   scored against every L-th grid beat at the best of the L downbeat phases.
 *
 * Scores per cell: the F-measure (±70 ms, `fMeasure`), the same F after removing the
 * anchors' mean lag (what a calibrated per-player offset could reach; one fitted
 * constant, so slightly optimistic), the circular resultant R of the anchors' phase in
 * the level's cycle (phase locking regardless of lag), the AIST++ beat-alignment score
 * (σ = 50 ms, anchors to grid) and Cemgil's accuracy. R alone rewards a channel that
 * fires rarely but in phase, so the anchor rate per cycle is reported beside it.
 *
 * Pure functions over arrays: no DAG, no React. The CLI is `measure_channels.ts`.
 */
import { BLM, type BodyFrame } from '@thoremin/sdk/nodes/domain';
import { fMeasure, cemgil, createPulseFollower, PULSE_TRUSTED_CONFIDENCE } from '@thoremin/ictus';

/** Seconds; the F-measure window of the MIR convention (`metrics.ts`). */
export const F_WINDOW_S = 0.07;
/** The AIST++ beat-alignment score's σ: 3 frames at 60 fps. */
export const BAS_SIGMA_S = 0.05;
/** A landmark below this visibility is not observed (the `body-pulse` rule). */
export const MIN_VISIBILITY = 0.5;
/** The running torso length is a centred median over this many seconds (a per-frame
 *  torso would put its own jitter into every height). */
export const TORSO_SPAN_S = 1;
/** Slow drift (a camera tilt, a dancer walking toward the camera) is removed by a
 *  centred moving average over this many seconds before any position is used. */
export const DETREND_S = 2;
/** At most one anchor per this fraction of the level's period. */
export const MIN_SEPARATION = 0.5;
/** Sway is measured over the ankles only when both are seen in at least this fraction
 *  of the clip's frames; otherwise it is the trunk's own horizontal position. */
export const FEET_SEEN_FOR_SWAY = 0.8;
/** An envelope peak must clear the envelope's median plus this many MADs. */
export const PEAK_MADS = 1;

export const EVENTS = ['decel', 'accel', 'impact', 'extremum'] as const;
export type AnchorEvent = (typeof EVENTS)[number];

export interface Level {
  name: 'beat' | 'half-bar' | 'bar';
  /** Beats per cycle of this level. */
  beats: number;
}

/** The levels of a meter. A bar of an odd number of beats has no half-bar (1.5 beats
 *  of a 3-pattern is not a level anyone marks), and a 2-beat bar's half-bar is its beat. */
export function levelsFor(beatsPerBar: number): Level[] {
  const half: Level[] = beatsPerBar % 2 === 0 && beatsPerBar > 2 ? [{ name: 'half-bar', beats: beatsPerBar / 2 }] : [];
  return [{ name: 'beat', beats: 1 }, ...half, { name: 'bar', beats: beatsPerBar }];
}

/** One channel: per-frame samples, either a scalar (`y` only) or a point (`x`, `y`),
 *  NaN where unobserved. `extremumAxis` names the axis whose turning point an
 *  `extremum` anchor is (a point's vertical, by default). */
export interface Channel {
  id: string;
  label: string;
  x?: number[];
  y: number[];
}

// ---------------------------------------------------------------- signal helpers

function median(xs: readonly number[]): number {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mad(xs: readonly number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Centred running median over `span` samples, NaN-aware. */
function runningMedian(xs: readonly number[], span: number): number[] {
  const half = Math.max(1, span >> 1);
  return xs.map((_, i) => median(xs.slice(Math.max(0, i - half), i + half + 1)));
}

/** Linear interpolation across NaN gaps of at most `maxGap` samples; longer gaps stay NaN. */
function fillGaps(xs: readonly number[], maxGap: number): number[] {
  const out = [...xs];
  let i = 0;
  while (i < out.length) {
    if (Number.isFinite(out[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && !Number.isFinite(out[j])) j++;
    if (i > 0 && j < out.length && j - i <= maxGap) {
      for (let k = i; k < j; k++) out[k] = out[i - 1] + ((out[j] - out[i - 1]) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
  return out;
}

/** Subtract a centred moving average of `span` samples (NaN-aware). */
function detrend(xs: readonly number[], span: number): number[] {
  const half = Math.max(1, span >> 1);
  return xs.map((x, i) => {
    if (!Number.isFinite(x)) return NaN;
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(xs.length - 1, i + half); k++) {
      if (Number.isFinite(xs[k])) {
        s += xs[k];
        n++;
      }
    }
    return x - s / n;
  });
}

/** Remove the 360-degree jumps of an angle series (NaN-aware: a jump is measured from
 *  the last observed sample). */
export function unwrapDegrees(xs: readonly number[]): number[] {
  let offset = 0;
  let last = NaN;
  return xs.map((x) => {
    if (!Number.isFinite(x)) return NaN;
    if (Number.isFinite(last)) {
      const d = x + offset - last;
      if (d > 180) offset -= 360 * Math.round(d / 360);
      else if (d < -180) offset += 360 * Math.round(-d / 360);
    }
    last = x + offset;
    return last;
  });
}

/** Central difference over `dt`, NaN where a neighbour is missing. */
function derivative(xs: readonly number[], dt: number): number[] {
  return xs.map((_, i) => (i === 0 || i === xs.length - 1 ? NaN : (xs[i + 1] - xs[i - 1]) / (2 * dt)));
}

// ---------------------------------------------------------------- channels

/** The channels of a pose stream, in running torso lengths, gaps up to 3 frames filled
 *  and slow drift removed. */
export function extractChannels(frames: readonly BodyFrame[], fps: number): Channel[] {
  const n = frames.length;
  const P = (i: number, j: number): { x: number; y: number } | null => {
    const f = frames[i];
    if (!f.present || !f.landmarks[j] || (f.visibility[j] ?? 1) < MIN_VISIBILITY) return null;
    return f.landmarks[j];
  };
  const mid = (i: number, a: number, b: number): { x: number; y: number } | null => {
    const p = P(i, a);
    const q = P(i, b);
    return p && q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : null;
  };
  const torsoRaw = frames.map((_, i) => {
    const s = mid(i, BLM.left_shoulder, BLM.right_shoulder);
    const h = mid(i, BLM.left_hip, BLM.right_hip);
    return s && h ? Math.hypot(s.x - h.x, s.y - h.y) : NaN;
  });
  const torso = runningMedian(torsoRaw, Math.round(TORSO_SPAN_S * fps));
  const norm = (vals: Array<number | null>): number[] =>
    detrend(
      fillGaps(
        vals.map((v, i) => (v === null || !Number.isFinite(torso[i]) || torso[i] <= 0 ? NaN : v / torso[i])),
        3,
      ),
      Math.round(DETREND_S * fps),
    );
  const coord = (f: (i: number) => { x: number; y: number } | null, axis: 'x' | 'y'): number[] =>
    norm(frames.map((_, i) => f(i)?.[axis] ?? null));
  const joint = (j: number) => (i: number) => P(i, j);

  const hipMid = (i: number) => mid(i, BLM.left_hip, BLM.right_hip);
  const shoulderMid = (i: number) => mid(i, BLM.left_shoulder, BLM.right_shoulder);
  const trunk = (i: number) => {
    const s = shoulderMid(i);
    const h = hipMid(i);
    return s && h ? { x: (s.x + h.x) / 2, y: (s.y + h.y) / 2 } : null;
  };
  const ankleMid = (i: number) => mid(i, BLM.left_ankle, BLM.right_ankle);

  // Torso rotation: a body line's yaw from the world landmarks (x-z plane, degrees),
  // UNWRAPPED (atan2 jumps by 360 degrees when the line turns past side-on, which a
  // dancer's does). The shoulder line is the torso; the hip line is the control that
  // says how much of the shoulders' rotation is the beating arm pulling one shoulder.
  const lineYaw = (a: number, b: number): number[] =>
    unwrapDegrees(
      frames.map((f, i) => {
        if (!P(i, a) || !P(i, b) || !f.world) return NaN;
        const l = f.world[a];
        const r = f.world[b];
        if (l.z === undefined || r.z === undefined) return NaN;
        return (Math.atan2(r.z - l.z, r.x - l.x) * 180) / Math.PI;
      }),
    );
  // Sway: the trunk over the ankles when the feet are in view for most of the clip,
  // else the trunk alone, ONE mode per clip (mixing the two per frame makes steps of
  // several torso lengths wherever the ankles flicker in and out of view).
  const feetSeen = frames.filter((_, i) => ankleMid(i) !== null).length / Math.max(1, n);
  const swayOverFeet = feetSeen >= FEET_SEEN_FOR_SWAY;

  const chans: Channel[] = [
    { id: 'head.y', label: 'head height (nose)', y: coord(joint(BLM.nose), 'y') },
    { id: 'hips.y', label: 'hips height', y: coord(hipMid, 'y') },
    { id: 'com.y', label: 'trunk centroid height', y: coord(trunk, 'y') },
    { id: 'hipsOverAnkles.y', label: 'hips over ankles (knee bounce)', y: norm(frames.map((_, i) => {
      const h = hipMid(i);
      const a = ankleMid(i);
      return h && a ? h.y - a.y : null;
    })) },
    { id: 'wrist.l', label: 'left wrist', x: coord(joint(BLM.left_wrist), 'x'), y: coord(joint(BLM.left_wrist), 'y') },
    { id: 'wrist.r', label: 'right wrist', x: coord(joint(BLM.right_wrist), 'x'), y: coord(joint(BLM.right_wrist), 'y') },
    { id: 'elbow.l', label: 'left elbow', x: coord(joint(BLM.left_elbow), 'x'), y: coord(joint(BLM.left_elbow), 'y') },
    { id: 'elbow.r', label: 'right elbow', x: coord(joint(BLM.right_elbow), 'x'), y: coord(joint(BLM.right_elbow), 'y') },
    { id: 'stride', label: 'stride (ankles apart)', y: norm(frames.map((_, i) => {
      const l = P(i, BLM.left_ankle);
      const r = P(i, BLM.right_ankle);
      return l && r ? l.x - r.x : null;
    })) },
    { id: 'sway.x', label: swayOverFeet ? 'lateral sway (trunk over ankles)' : 'lateral sway (trunk alone, feet out of view)', y: norm(frames.map((_, i) => {
      const t = trunk(i);
      if (!swayOverFeet) return t ? t.x : null;
      const a = ankleMid(i);
      return t && a ? t.x - a.x : null;
    })) },
    { id: 'torso.yaw', label: 'torso rotation (shoulder yaw)', y: detrend(fillGaps(lineYaw(BLM.left_shoulder, BLM.right_shoulder), 3), Math.round(DETREND_S * fps)) },
    { id: 'hips.yaw', label: 'pelvis rotation (hip yaw, the control for torso.yaw)', y: detrend(fillGaps(lineYaw(BLM.left_hip, BLM.right_hip), 3), Math.round(DETREND_S * fps)) },
  ];
  return chans;
}

/** The point channels the multi-joint envelope sums (§3.3's default joint set: both
 *  wrists, both elbows, the head, the hips; the ankles join only through the stride,
 *  which the envelope's 2-D speed does not see). */
export const ENVELOPE_JOINTS = ['wrist.l', 'wrist.r', 'elbow.l', 'elbow.r', 'head.y', 'hips.y'] as const;

// ---------------------------------------------------------------- envelopes and anchors

/** Speed of a channel (2-D for a point, |dy/dt| for a scalar). */
function speedOf(ch: Channel, dt: number): number[] {
  const vy = derivative(ch.y, dt);
  if (!ch.x) return vy.map(Math.abs);
  const vx = derivative(ch.x, dt);
  return vy.map((v, i) => Math.hypot(v, vx[i]));
}

/** The envelope whose peaks are the anchors of `event` on `ch`; `polarity` picks which
 *  end an `extremum` or an `impact` is (+1: toward the largest value, for a height the
 *  bottom of the travel, image y growing downward). */
export function envelope(ch: Channel, event: AnchorEvent, dt: number, polarity: 1 | -1 = 1): number[] {
  if (event === 'extremum') return ch.y.map((v) => polarity * v);
  // Braking into the +polarity end is acceleration toward the -polarity side.
  if (event === 'impact') return derivative(derivative(ch.y, dt), dt).map((a) => (Number.isFinite(a) ? Math.max(0, -polarity * a) : NaN));
  if (event === 'decel') return derivative(speedOf(ch, dt), dt).map((a) => (Number.isFinite(a) ? Math.max(0, -a) : NaN));
  const ay = derivative(derivative(ch.y, dt), dt);
  if (!ch.x) return ay.map(Math.abs);
  const ax = derivative(derivative(ch.x, dt), dt);
  return ay.map((a, i) => Math.hypot(a, ax[i]));
}

/** §3.3's multi-joint envelope: each joint's vertical impact envelope (braking into the
 *  bottom; the speed-only deceleration fires at both ends of a bounce) over its own median
 *  (so a big arm does not drown a small bounce), weighted by `weights` (the joint's
 *  periodicity at the followed level; equal weights if omitted), averaged over the
 *  joints observed at each frame. */
export function multiJointEnvelope(chans: readonly Channel[], dt: number, weights?: Readonly<Record<string, number>>): number[] {
  const parts = chans
    .filter((c) => (ENVELOPE_JOINTS as readonly string[]).includes(c.id))
    .map((c) => {
      const e = envelope({ id: c.id, label: c.label, y: c.y }, 'impact', dt, 1);
      const scale = median(e.filter((v) => v > 0)) || 1;
      return { w: weights?.[c.id] ?? 1, e: e.map((v) => v / scale) };
    });
  const n = parts[0]?.e.length ?? 0;
  return Array.from({ length: n }, (_, i) => {
    let s = 0;
    let w = 0;
    for (const p of parts) {
      if (Number.isFinite(p.e[i]) && p.w > 0) {
        s += p.w * p.e[i];
        w += p.w;
      }
    }
    return w > 0 ? s / w : NaN;
  });
}

/** Anchors: local maxima of `env`, kept greedily by height with at least `minSepS`
 *  between them, above the envelope's median + `PEAK_MADS` MADs; each refined to a
 *  sub-frame time by a parabola through its neighbours. Times in seconds from `t[0]`. */
export function pickAnchors(env: readonly number[], t: readonly number[], minSepS: number): number[] {
  const floor = median(env) + PEAK_MADS * mad(env);
  const cands: Array<{ i: number; h: number }> = [];
  for (let i = 1; i < env.length - 1; i++) {
    const h = env[i];
    if (Number.isFinite(h) && h >= floor && h >= env[i - 1] && h > env[i + 1]) cands.push({ i, h });
  }
  cands.sort((a, b) => b.h - a.h);
  const kept: number[] = [];
  for (const c of cands) if (kept.every((k) => Math.abs(t[k] - t[c.i]) >= minSepS)) kept.push(c.i);
  return kept
    .map((i) => {
      const a = env[i - 1];
      const b = env[i];
      const c = env[i + 1];
      const den = a - 2 * b + c;
      const off = Number.isFinite(den) && den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      return t[i] + off * (t[i + 1] - t[i]);
    })
    .sort((x, y) => x - y);
}

// ---------------------------------------------------------------- scoring against a grid

/** The fractional beat index of `time` on a grid (linear between beats, extrapolated by
 *  the nearest interval outside it). */
export function beatPosition(grid: readonly number[], time: number): number {
  const n = grid.length;
  if (time <= grid[0]) return (time - grid[0]) / (grid[1] - grid[0]);
  if (time >= grid[n - 1]) return n - 1 + (time - grid[n - 1]) / (grid[n - 1] - grid[n - 2]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (grid[m] <= time) lo = m;
    else hi = m;
  }
  return lo + (time - grid[lo]) / (grid[hi] - grid[lo]);
}

/** Time at a fractional beat index (the inverse of {@link beatPosition}). */
function timeAt(grid: readonly number[], pos: number): number {
  const n = grid.length;
  const i = Math.max(0, Math.min(n - 2, Math.floor(pos)));
  return grid[i] + (pos - i) * (grid[i + 1] - grid[i]);
}

function bas(anchors: readonly number[], ref: readonly number[]): number {
  if (anchors.length === 0 || ref.length === 0) return 0;
  let s = 0;
  for (const a of anchors) {
    let d = Infinity;
    for (const r of ref) d = Math.min(d, Math.abs(a - r));
    s += Math.exp(-(d * d) / (2 * BAS_SIGMA_S * BAS_SIGMA_S));
  }
  return s / anchors.length;
}

export interface LevelScore {
  /** Anchors scored. */
  n: number;
  /** Anchors per cycle of the level (1 is one per cycle). */
  rate: number;
  f: number;
  /** F after shifting the anchors by their circular-mean lag. */
  fLag: number;
  /** The anchors' circular-mean lag behind the level's grid, seconds (negative: ahead). */
  lagS: number;
  r: number;
  /** Rayleigh test p-value of R (Zar's approximation): the chance of an R this large
   *  from as many anchors at random phases. */
  p: number;
  /** Its natural log: what cells are ranked by (a strong lock's p underflows to 0). */
  logP: number;
  bas: number;
  cemgil: number;
}

/** The natural log of the Rayleigh p for a resultant length `r` of `n` unit vectors
 *  (Zar, Biostatistical Analysis, eq. 27.4). */
export function rayleighLogP(r: number, n: number): number {
  if (n < 2) return 0;
  const R = n * r;
  return Math.min(0, Math.sqrt(1 + 4 * n + 4 * (n * n - R * R)) - (1 + 2 * n));
}

/** The Rayleigh p itself. */
export function rayleighP(r: number, n: number): number {
  return Math.exp(rayleighLogP(r, n));
}

/** A grid interval longer than this many median intervals is a hold (a conductor
 *  between verses), not a beat: the grid's continuous runs are scored, holds are not. */
export const GRID_GAP = 1.6;

/** The grid's continuous runs as [start, end] spans, each padded by the F window. */
export function gridRuns(grid: readonly number[]): Array<[number, number]> {
  const ibis = grid.slice(1).map((g, i) => g - grid[i]);
  const limit = GRID_GAP * median(ibis);
  const runs: Array<[number, number]> = [];
  let start = grid[0];
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] - grid[i - 1] > limit) {
      runs.push([start - F_WINDOW_S, grid[i - 1] + F_WINDOW_S]);
      start = grid[i];
    }
  }
  runs.push([start - F_WINDOW_S, grid[grid.length - 1] + F_WINDOW_S]);
  return runs;
}

/** Score anchors at a level: references are every `beats`-th grid beat at the best of
 *  the downbeat phases, restricted to the spans (the grid's runs) the anchors could cover. */
export function scoreLevel(anchors: readonly number[], grid: readonly number[], beats: number, spans: ReadonlyArray<readonly [number, number]>): LevelScore {
  const inSpan = (x: number) => spans.some(([a, b]) => x >= a && x <= b);
  const A = anchors.filter(inSpan);
  const G = grid.filter(inSpan);
  const cycles = Math.max(1, G.length / beats);
  // Phase of each anchor in the level's cycle, from the grid's beat index.
  let cs = 0;
  let sn = 0;
  for (const a of A) {
    const ph = (2 * Math.PI * beatPosition(grid, a)) / beats;
    cs += Math.cos(ph);
    sn += Math.sin(ph);
  }
  const r = A.length ? Math.hypot(cs, sn) / A.length : 0;
  const meanPh = Math.atan2(sn, cs);
  const refsFor = (k: number) => G.filter((g) => {
    const idx = Math.round(beatPosition(grid, g));
    return (((idx - k) % beats) + beats) % beats === 0;
  });
  // The best downbeat phase k for raw F; the lag relative to the nearest reference set.
  let best = { f: -1, k: 0 };
  for (let k = 0; k < Math.max(1, Math.round(beats)); k++) {
    const f = fMeasure(refsFor(k), A, F_WINDOW_S);
    if (f > best.f) best = { f, k };
  }
  // Lag: the mean phase's offset from the nearest grid beat, in beats (-0.5..0.5). Which
  // beat of the level it sits nearest is the downbeat phase, unknown here and searched.
  const meanBeats = (meanPh / (2 * Math.PI)) * beats;
  const lagBeats = A.length ? meanBeats - Math.round(meanBeats) : 0;
  // Convert the lag in beats to seconds at the clip's median beat period.
  const ibis = grid.slice(1).map((g, i) => g - grid[i]);
  const lagS = lagBeats * median(ibis);
  // F after removing the lag: shift each anchor by the lag measured in beats on the grid.
  const shifted = A.map((a) => timeAt(grid, beatPosition(grid, a) - lagBeats));
  let fLag = 0;
  for (let k = 0; k < Math.max(1, Math.round(beats)); k++) fLag = Math.max(fLag, fMeasure(refsFor(k), shifted, F_WINDOW_S));
  const ref = refsFor(best.k);
  return {
    n: A.length,
    rate: A.length / cycles,
    f: best.f,
    fLag,
    lagS,
    r,
    p: rayleighP(r, A.length),
    logP: rayleighLogP(r, A.length),
    bas: bas(A, ref),
    cemgil: cemgil(ref, A),
  };
}

// ---------------------------------------------------------------- periodicity (the auto channel)

export interface PulseSummary {
  /** Fraction of ticks (after the follower's warm-up) with a trusted pulse. */
  trusted: number;
  /** Median ACF strength over the trusted ticks (NaN if none). */
  strength: number;
  /** The level the follower held most often, in grid beats (rounded to 0.25). */
  levelBeats: number;
  /** Fraction of trusted ticks on that level. */
  levelShare: number;
}

/** Run ictus's pulse follower (the `body-pulse` defaults) over a scalar channel. */
export function pulseSummary(y: readonly number[], t: readonly number[], beatS: number): PulseSummary {
  const follower = createPulseFollower({ windowS: 8, minPeriodS: 0.3, maxPeriodS: 3, prior: 'oscillator' });
  const levels: number[] = [];
  const strengths: number[] = [];
  let ticks = 0;
  for (let i = 0; i < y.length; i++) {
    const s = follower.feed(t[i], y[i]);
    if (t[i] - t[0] < 4) continue;
    ticks++;
    if (s.confidence >= PULSE_TRUSTED_CONFIDENCE && Number.isFinite(s.level)) {
      levels.push(Math.round((s.level / beatS) * 4) / 4);
      strengths.push(s.strength);
    }
  }
  const counts = new Map<number, number>();
  for (const l of levels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let mode = NaN;
  let modeN = 0;
  for (const [l, c] of counts) if (c > modeN) [mode, modeN] = [l, c];
  return {
    trusted: ticks ? levels.length / ticks : 0,
    strength: median(strengths),
    levelBeats: mode,
    levelShare: levels.length ? modeN / levels.length : 0,
  };
}

// ---------------------------------------------------------------- the whole measurement

export interface CellResult {
  channel: string;
  event: AnchorEvent | 'multi';
  polarity: 1 | -1;
  level: Level['name'];
  score: LevelScore;
}

/** Every channel x event x level for one clip. `span` limits scoring to where the
 *  grid is (the clip's music) and the body was tracked. */
export function measureClip(frames: readonly BodyFrame[], fps: number, grid: readonly number[], beatsPerBar: number, only?: { channels?: readonly string[]; levels?: ReadonlyArray<Level['name']> }): CellResult[] {
  const dt = 1 / fps;
  const t = frames.map((_, i) => i * dt);
  const chans = extractChannels(frames, fps);
  const beatS = medianBeatS(grid);
  const span = scoringSpans(grid, t[0], t[t.length - 1]);
  const wanted = (id: string) => !only?.channels || only.channels.includes(id);
  const out: CellResult[] = [];
  for (const level of levelsFor(beatsPerBar).filter((l) => !only?.levels || only.levels.includes(l.name))) {
    const sep = MIN_SEPARATION * level.beats * beatS;
    for (const ch of chans.filter((c) => wanted(c.id))) {
      for (const event of EVENTS) {
        // An extremum or an impact is scored at both polarities and the more
        // significant lock (Rayleigh p) kept: the phase of a bounce is the player's own.
        const pols: Array<1 | -1> = event === 'extremum' || event === 'impact' ? [1, -1] : [1];
        let best: CellResult | null = null;
        for (const pol of pols) {
          const anchors = pickAnchors(envelope(ch, event, dt, pol), t, sep);
          const score = scoreLevel(anchors, grid, level.beats, span);
          if (!best || score.logP < best.score.logP) best = { channel: ch.id, event, polarity: pol, level: level.name, score };
        }
        out.push(best!);
      }
    }
    // The multi-joint envelope: equal weights, and the matched weighting of §3.3 step 3
    // (each joint's own periodicity AT THIS LEVEL: its autocorrelation at the level's
    // period, which needs a tempo but no grid phase, as the impact detector will have).
    const lag = Math.round((level.beats * beatS) / dt);
    for (const weighted of [false, true]) {
      const id = weighted ? 'multi.weighted' : 'multi';
      if (!wanted(id)) continue;
      const weights = weighted
        ? Object.fromEntries(chans.filter((c) => (ENVELOPE_JOINTS as readonly string[]).includes(c.id)).map((c) => [c.id, Math.max(0, acfAt(c.y, lag))]))
        : undefined;
      const anchors = pickAnchors(multiJointEnvelope(chans, dt, weights), t, sep);
      out.push({ channel: id, event: 'multi', polarity: 1, level: level.name, score: scoreLevel(anchors, grid, level.beats, span) });
    }
  }
  return out;
}

/** The grid's median beat interval, seconds (a hold between verses does not stretch it). */
export function medianBeatS(grid: readonly number[]): number {
  return median(grid.slice(1).map((g, i) => g - grid[i]));
}

/** The spans scored: the grid's runs, inside the clip. */
export function scoringSpans(grid: readonly number[], t0: number, t1: number): Array<[number, number]> {
  return gridRuns(grid).map(([a, b]): [number, number] => [Math.max(a, t0), Math.min(b, t1)]).filter(([a, b]) => b > a);
}

/** What F after the lag reaches by chance: `trials` sets of random anchors (uniform in
 *  the scored spans, one per beat), scored like a channel; the median and the 95th
 *  percentile. A channel's F is worth quoting only above the latter. */
export function chanceFLag(grid: readonly number[], t0: number, t1: number, beats = 1, trials = 200, seed = 373): { median: number; p95: number } {
  const spans = scoringSpans(grid, t0, t1);
  const total = spans.reduce((a, [x, y]) => a + (y - x), 0);
  const n = Math.max(2, Math.round(total / (beats * medianBeatS(grid))));
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const at = (u: number): number => {
    let r = u * total;
    for (const [x, y] of spans) {
      if (r <= y - x) return x + r;
      r -= y - x;
    }
    return spans[spans.length - 1][1];
  };
  const fs: number[] = [];
  for (let k = 0; k < trials; k++) {
    const anchors = Array.from({ length: n }, () => at(rand())).sort((p, q) => p - q);
    fs.push(scoreLevel(anchors, grid, beats, spans).fLag);
  }
  fs.sort((p, q) => p - q);
  return { median: fs[Math.floor(trials / 2)], p95: fs[Math.floor(trials * 0.95)] };
}

/** The most significant event of one channel at one level (the tables' cell). */
export function bestCell(cells: readonly CellResult[], channel: string, level: Level['name']): CellResult {
  const mine = cells.filter((c) => c.channel === channel && c.level === level);
  if (mine.length === 0) throw new Error(`no cell for ${channel} at ${level}`);
  return mine.reduce((a, b) => (b.score.logP < a.score.logP ? b : a));
}

/** Normalised autocorrelation of `y` at a lag of `lag` samples, over the pairs both
 *  observed (each side's mean removed). */
export function acfAt(y: readonly number[], lag: number): number {
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i + lag < y.length; i++) {
    if (Number.isFinite(y[i]) && Number.isFinite(y[i + lag])) {
      a.push(y[i]);
      b.push(y[i + lag]);
    }
  }
  if (a.length < 3) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

// ---------------------------------------------------------------- two levels at once: the meter

/** The strongest autocorrelation peak of a channel with a lag inside [minS, maxS]. */
export function acfPeak(y: readonly number[], fps: number, minS: number, maxS: number): { lagS: number; r: number } {
  let best = { lagS: NaN, r: -Infinity };
  const lo = Math.max(1, Math.round(minS * fps));
  const hi = Math.round(maxS * fps);
  const r = (k: number) => acfAt(y, k);
  for (let k = lo; k <= hi; k++) {
    const v = r(k);
    // A local maximum (the edges of the window are not peaks).
    if (k > lo && k < hi && v > best.r && v >= r(k - 1) && v >= r(k + 1)) best = { lagS: k / fps, r: v };
  }
  return best;
}

export interface MeterReading {
  /** The beat-level (vertical) channel and its period, seconds. */
  beatChannel: string;
  beatS: number;
  beatR: number;
  /** The bar-level (lateral or rotational) channel and its period, seconds. */
  barChannel: string;
  barS: number;
  barR: number;
  /** barS / beatS: the meter the body writes, if both are real. */
  ratio: number;
}

/**
 * §3.4's "two levels at once give the meter": the period of the strongest vertical
 * channel near the beat and of the strongest lateral or rotational channel at a slower
 * level, each from its own autocorrelation, and their ratio. Grid-free except for the
 * search windows, which are stated in the clip's beat period (a tempo, not a phase): the
 * vertical within 0.6..1.6 beats, the lateral within 1.6..6 beats.
 */
export function meterReading(frames: readonly BodyFrame[], fps: number, beatS: number): MeterReading {
  const chans = extractChannels(frames, fps);
  const pick = (ids: readonly string[], lo: number, hi: number) =>
    ids
      .map((id) => ({ id, ...acfPeak(chans.find((c) => c.id === id)!.y, fps, lo * beatS, hi * beatS) }))
      .filter((x) => Number.isFinite(x.lagS))
      .reduce((a, b) => (b.r > a.r ? b : a), { id: '-', lagS: NaN, r: -Infinity });
  const v = pick(['com.y', 'hips.y', 'head.y'], 0.6, 1.6);
  const h = pick(['sway.x', 'torso.yaw', 'stride'], 1.6, 6);
  return { beatChannel: v.id, beatS: v.lagS, beatR: v.r, barChannel: h.id, barS: h.lagS, barR: h.r, ratio: h.lagS / v.lagS };
}
