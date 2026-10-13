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
 * - An **event** is what an anchor is: `decel` (a peak of deceleration, the dance
 *   literature's visual beat and the conductor's stroke), `accel` (a peak of the
 *   acceleration magnitude, where observers place a conductor's beat) or `extremum`
 *   (the turning point of the channel's own axis, e.g. the bottom of a bounce; its
 *   polarity is chosen per channel, since which end of the bounce lands on the beat
 *   differs between people).
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
/** An envelope peak must clear the envelope's median plus this many MADs. */
export const PEAK_MADS = 1;

export const EVENTS = ['decel', 'accel', 'extremum'] as const;
export type AnchorEvent = (typeof EVENTS)[number];

export interface Level {
  name: 'beat' | 'half-bar' | 'bar';
  /** Beats per cycle of this level. */
  beats: number;
}

export function levelsFor(beatsPerBar: number): Level[] {
  return [
    { name: 'beat', beats: 1 },
    { name: 'half-bar', beats: beatsPerBar / 2 },
    { name: 'bar', beats: beatsPerBar },
  ];
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

  // Torso rotation: the shoulder line's yaw from the world landmarks (x-z plane, degrees).
  const yaw = frames.map((f, i) => {
    if (!P(i, BLM.left_shoulder) || !P(i, BLM.right_shoulder) || !f.world) return NaN;
    const l = f.world[BLM.left_shoulder];
    const r = f.world[BLM.right_shoulder];
    return (Math.atan2(r.z - l.z, r.x - l.x) * 180) / Math.PI;
  });

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
    { id: 'sway.x', label: 'lateral sway (trunk over ankles)', y: norm(frames.map((_, i) => {
      const t = trunk(i);
      const a = ankleMid(i);
      // Without the feet, the trunk's own horizontal position (camera pans included).
      return t ? t.x - (a?.x ?? 0) : null;
    })) },
    { id: 'torso.yaw', label: 'torso rotation (shoulder yaw)', y: detrend(fillGaps(yaw, 3), Math.round(DETREND_S * fps)) },
  ];
  void n;
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
 *  turning point an `extremum` is (+1: the largest image y, the bottom). */
export function envelope(ch: Channel, event: AnchorEvent, dt: number, polarity: 1 | -1 = 1): number[] {
  if (event === 'extremum') return ch.y.map((v) => polarity * v);
  if (event === 'decel') return derivative(speedOf(ch, dt), dt).map((a) => (Number.isFinite(a) ? Math.max(0, -a) : NaN));
  const ay = derivative(derivative(ch.y, dt), dt);
  if (!ch.x) return ay.map(Math.abs);
  const ax = derivative(derivative(ch.x, dt), dt);
  return ay.map((a, i) => Math.hypot(a, ax[i]));
}

/** §3.3's multi-joint envelope: each joint's deceleration envelope over its own median
 *  (so a big arm does not drown a small bounce), weighted by `weights` (the joint's
 *  periodicity at the followed level; equal weights if omitted), averaged over the
 *  joints observed at each frame. */
export function multiJointEnvelope(chans: readonly Channel[], dt: number, weights?: Readonly<Record<string, number>>): number[] {
  const parts = chans
    .filter((c) => (ENVELOPE_JOINTS as readonly string[]).includes(c.id))
    .map((c) => {
      const e = envelope(c, 'decel', dt);
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
  /** Anchors per cycle of the level (1 is one per cycle). */
  rate: number;
  f: number;
  /** F after shifting the anchors by their circular-mean lag. */
  fLag: number;
  /** The anchors' circular-mean lag behind the level's grid, seconds (negative: ahead). */
  lagS: number;
  r: number;
  bas: number;
  cemgil: number;
}

/** Score anchors at a level: references are every `beats`-th grid beat at the best of
 *  the downbeat phases, restricted to the span the anchors could cover. */
export function scoreLevel(anchors: readonly number[], grid: readonly number[], beats: number, span: readonly [number, number]): LevelScore {
  const inSpan = (x: number) => x >= span[0] && x <= span[1];
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
    rate: A.length / cycles,
    f: best.f,
    fLag,
    lagS,
    r,
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
export function measureClip(frames: readonly BodyFrame[], fps: number, grid: readonly number[], beatsPerBar: number): CellResult[] {
  const dt = 1 / fps;
  const t = frames.map((_, i) => i * dt);
  const chans = extractChannels(frames, fps);
  const beatS = median(grid.slice(1).map((g, i) => g - grid[i]));
  const span: [number, number] = [Math.max(grid[0], t[0]) - F_WINDOW_S, Math.min(grid[grid.length - 1], t[t.length - 1]) + F_WINDOW_S];
  const out: CellResult[] = [];
  for (const level of levelsFor(beatsPerBar)) {
    const sep = MIN_SEPARATION * level.beats * beatS;
    for (const ch of chans) {
      for (const event of EVENTS) {
        // An extremum is scored at both polarities and the better R kept (the phase of
        // a bounce is the player's own).
        const pols: Array<1 | -1> = event === 'extremum' ? [1, -1] : [1];
        let best: CellResult | null = null;
        for (const pol of pols) {
          const anchors = pickAnchors(envelope(ch, event, dt, pol), t, sep);
          const score = scoreLevel(anchors, grid, level.beats, span);
          if (!best || score.r > best.score.r) best = { channel: ch.id, event, polarity: pol, level: level.name, score };
        }
        out.push(best!);
      }
    }
    // The multi-joint envelope: equal weights, and weights from each joint's own
    // pulse strength (the matched weighting of §3.3 step 3).
    for (const weighted of [false, true]) {
      const weights = weighted
        ? Object.fromEntries(chans.filter((c) => (ENVELOPE_JOINTS as readonly string[]).includes(c.id)).map((c) => [c.id, pulseStrengthOf(c, t, beatS)]))
        : undefined;
      const anchors = pickAnchors(multiJointEnvelope(chans, dt, weights), t, sep);
      out.push({ channel: weighted ? 'multi.weighted' : 'multi', event: 'multi', polarity: 1, level: level.name, score: scoreLevel(anchors, grid, level.beats, span) });
    }
  }
  return out;
}

/** A point's periodicity for the envelope weights: the pulse strength of its vertical. */
function pulseStrengthOf(ch: Channel, t: readonly number[], beatS: number): number {
  const s = pulseSummary(ch.y, t, beatS);
  return Number.isFinite(s.strength) ? s.strength * s.trusted : 0;
}
