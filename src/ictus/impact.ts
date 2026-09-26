/**
 * The impact predictor — samples of one striking point in, impact events out, BEFORE
 * the frame that shows the impact has been captured.
 *
 * The problem (`docs/research/intent-and-subframe-timing.md` §5.2, §5.3): a camera at
 * 24-60 fps observes a strike only after it happened, up to a frame late, and the
 * reactive chain behind it adds 50-100 ms more. A drum hit has to sound *at* the hit.
 * So the sound must be committed from the approach, which is prediction under a
 * movement model — the same thing a player does when they anticipate a beat.
 *
 * The movement model is the stereotyped stroke: the approach to an impact is, to a
 * good approximation, constant acceleration (a stick or a hand falling, a wrist
 * snapping down: a quadratic in time), and a surface impact happens where that
 * trajectory reaches a PLANE. The plane is the constraint that makes the surface case
 * well-posed: a least-squares quadratic through the last few approach samples,
 * extrapolated to the plane, gives the impact time while the stick is still tens of
 * milliseconds above the table, and every new sample sharpens it. An "air" impact
 * (a stroke that reverses in mid-air, the air-drum critique) has no plane. What it
 * has instead is the player's own repetition: the depth the strokes turn at is
 * consistent, so the plane can be LEARNED from confirmed reversals, and the time
 * between the extrapolated crossing and the observed turning point (the braking the
 * extrapolation cannot see) is a per-player constant that is learned with it.
 *
 * The two kinds differ in what the frames show after the bottom, and the predictor
 * uses that to learn under the right rule (`mode: 'auto'`): a surface stroke rebounds
 * at about its approach speed (a kink: the plane is where the approach and departure
 * fits intersect, and the kink time is the unbiased post-hoc impact time); an air
 * stroke leaves slowly (a smooth turn: the three-sample parabola's vertex is the
 * turning point, and its depth the floor). A known plane (`level`) skips the
 * learning for a calibrated surface.
 *
 * One stroke, two events:
 *
 * 1. **`predict`** — emitted ONCE per stroke, as late as it can be while still at
 *    least `minLead` seconds ahead of the predicted impact (the lead the consumer
 *    needs to schedule sound: audio output latency plus a margin), given the sample
 *    period: at the first sample where waiting for the next one would leave too
 *    little lead. Requires enough approach samples, a stroke big enough to be a
 *    stroke, and a prediction that agrees with the previous sample's. Committed
 *    events are never moved (the scheduler's rule): a better estimate corrects the
 *    NEXT stroke, not the sound already scheduled.
 * 2. **`confirm`** — at the first sample on the far side of the bottom, carrying the
 *    refined post-hoc time (`t`: the approach crossing of the floor plus the learned
 *    lag), the prediction it confirms and the correction between them. A stroke too
 *    fast to predict is confirmed without a prediction: the reactive, always-late
 *    case. Then, two samples later, the departure is fitted and the floor and lag are
 *    updated for the next stroke.
 *
 * What it does NOT do: decide where the beat is, or snap anything to a grid. Those
 * are the rhythm prior's job (`oscillator.ts`) and the magnet's (`magnet.ts`); a
 * confirmation is an {@link Anchor} for the prior, a prediction is what the magnet
 * pulls toward the grid.
 *
 * Coordinates: the "depth" `d` grows toward the impact (image `y` grows downward, so
 * a downward strike has increasing `d`; `yDown: false` for a y-up frame). Units are
 * the caller's: every gate is relative to the player's own recent strokes and to the
 * online jitter estimate, as in `detector.ts`. Pure, causal, no clock.
 */
import type { Sample } from './types';

export type ImpactMode = 'surface' | 'air' | 'auto';

export interface ImpactPredictorOptions {
  /** Image coordinates: depth grows with `y`. False for a y-up frame. */
  yDown?: boolean;
  /** A KNOWN impact plane (depth, caller's units). When absent the floor is learned. */
  level?: number;
  /** How the floor and lag are learned from a confirmed stroke: `surface` (the kink
   *  of approach and departure), `air` (the turning parabola's vertex), or `auto`
   *  (per stroke, by the rebound ratio). */
  mode?: ImpactMode;
  /** A stroke whose rebound — the speed over the first sample past the bottom, over
   *  the approach speed at the crossing — is below this fraction is an air stroke
   *  (`auto`). A surface stroke leaves at about its arrival speed; an air stroke,
   *  from rest. The kind in force is the majority of the last three strokes. */
  airBelowRebound?: number;
  /** The post-hoc reference an air stroke's floor and lag are learned from: the
   *  vertex of the quadratic through the DEPARTURE samples (its velocity is zero at
   *  the turn, so its vertex IS the turn; `departure`, default) or the vertex of the
   *  three-sample parabola around the bottom (`vertex`, the shipped ictus detector's
   *  estimate, biased late on a sharp-arrival slow-departure turn). */
  airReference?: 'departure' | 'vertex';
  /** The lead the consumer needs, seconds, measured from the SAMPLE's time: a
   *  prediction is committed at the last sample that still leaves at least this
   *  much, given the sample period. 0 = as late as possible. A consumer that sees a
   *  sample later than it was captured (a camera pipeline) adds that age through
   *  {@link ImpactPredictor.setMinLead} before each push, so the lead is real at the
   *  moment of the decision. */
  minLead?: number;
  /** The slowest approach that is a stroke, in the caller's depth units per second
   *  (0 = no gate): a slow drift down and up spans as much depth as a stroke but
   *  never at a stroke's speed. */
  minApproachSpeed?: number;
  /** Approach samples needed before a prediction is trusted (3 = an exact quadratic). */
  minApproachSamples?: number;
  /** The approach fit uses the samples of the last this many seconds before the
   *  impact (at most `maxApproachSamples`): long enough to average tracker noise at
   *  60 fps, short enough that the early stroke, which is not yet a quadratic, stays
   *  out. */
  approachWindow?: number;
  /** A cap on the approach samples the fit uses. */
  maxApproachSamples?: number;
  /** A prediction is trusted once consecutive samples agree within this (seconds);
   *  NaN disables the check. */
  stabilityTolerance?: number;
  /** A prediction needs the point to have come down from its top by at least this
   *  fraction of the predicted stroke — and by the noise-unit and absolute floors —
   *  because the observed descent, not the predicted amplitude, is what says a stroke
   *  is under way (a fit through a few noise samples at rest can "reach" a floor a
   *  stroke away). It caps the achievable lead: a quadratic fall covers fraction f of
   *  its extent (1 − √f) of its duration before the impact, so 0.15 leaves about
   *  60 % of the fall (110 ms of a 180 ms stroke) for the prediction. */
  minDescentFraction?: number;
  /** Departure samples the kink fit uses (after the bottom). */
  departureSamples?: number;
  /** A stroke smaller than this fraction of the recent envelope is not a stroke. */
  minAmplitudeFraction?: number;
  /** A stroke must also exceed this many noise units (multiples of the online jitter). */
  minAmplitudeNoiseUnits?: number;
  /** An absolute amplitude floor in the caller's units (0 = relative gates only). A
   *  consumer that knows its units (pixels of a frame) sets it, because a clean,
   *  tiny oscillation before any real stroke has no envelope and no jitter to be
   *  small against. */
  minAmplitude?: number;
  /** Envelope decay per second (a player who starts beating smaller re-normalises). */
  envelopeDecayPerSecond?: number;
  /** How fast the learned floor follows, 0..1 per stroke (ignored with `level`). */
  levelGain?: number;
  /** How fast the learned lag follows, 0..1 per stroke. 0 = the crossing IS the estimate. */
  lagGain?: number;
  /** The reversal is confirmed when depth comes back from the running maximum by more
   *  than this many noise units (0 = any decrease). */
  reversalNoiseUnits?: number;
  /** A gap between samples longer than this restarts the history (the point was lost). */
  maxGap?: number;
  /** Initial period guess for the refractory window, seconds (`setPeriod` updates it). */
  initialPeriod?: number;
  /** Refractory window after a confirmation, as a fraction of the period. */
  refractoryFraction?: number;
}

const DEFAULTS: Required<Omit<ImpactPredictorOptions, 'level'>> = {
  yDown: true,
  mode: 'auto',
  airBelowRebound: 0.5,
  airReference: 'departure',
  minLead: 0.03,
  minApproachSpeed: 0,
  minApproachSamples: 3,
  approachWindow: 0.15,
  maxApproachSamples: 12,
  stabilityTolerance: 0.012,
  minDescentFraction: 0.15,
  departureSamples: 3,
  minAmplitudeFraction: 0.2,
  minAmplitudeNoiseUnits: 20,
  minAmplitude: 0,
  envelopeDecayPerSecond: 0.9,
  levelGain: 0.5,
  lagGain: 0.3,
  reversalNoiseUnits: 2,
  maxGap: 0.5,
  initialPeriod: 0.6,
  refractoryFraction: 0.25,
};

export interface ImpactPrediction {
  kind: 'predict';
  /** The predicted impact time, seconds. */
  t: number;
  /** The sample time at which the prediction was committed. */
  at: number;
  /** `t - at`: how early the commitment came (negative = the stroke was already past). */
  lead: number;
  /** The predicted stroke amplitude relative to the recent envelope, 0..1+ (Dahl: the
   *  preparatory height predicts the dynamic). */
  strength: number;
  /** 0..1. */
  confidence: number;
  /** The extrapolated crossing before the learned lag was added. */
  crossing: number;
}

export interface ImpactConfirmation {
  kind: 'confirm';
  /** The refined post-hoc impact time, seconds. */
  t: number;
  /** The sample time that confirmed it (the first sample past the bottom). */
  at: number;
  /** The prediction this confirms, or null when the stroke was confirmed unpredicted. */
  predicted: number | null;
  /** `t - predicted` (null without a prediction): what a scheduler would have absorbed. */
  correction: number | null;
  strength: number;
  confidence: number;
  /** The three-sample parabola's vertex time (the existing ictus detector's estimate). */
  vertex: number;
  /** The approach's extrapolated crossing of the floor (NaN without a usable approach). */
  crossing: number;
  /** The depth the stroke reached (the vertex depth, caller's units). */
  depth: number;
  /** Diagnostics of the approach fit at confirmation: how many samples it used, the
   *  velocity it extrapolated at the bottom, and the crossing offset it found (τ from
   *  the bottom sample; `reaches` false = it turned above the floor). Null when
   *  there were too few approach samples. */
  fit: { samples: number; b: number; tau: number; reaches: boolean } | null;
}

export type ImpactEvent = ImpactPrediction | ImpactConfirmation;

export interface ImpactPredictor {
  /** Feed one sample; returns the events this sample produced (usually none). */
  push(sample: Sample): ImpactEvent[];
  /** The current period estimate for the refractory window (the prior calls this). */
  setPeriod(period: number): void;
  /** The lead the next prediction must leave from its sample's time, seconds (see
   *  the option): a consumer whose samples are older than "now" adds their age. */
  setMinLead(lead: number): void;
  /** The learned floor (depth, caller's units); NaN until learned. */
  level(): number;
  /** The learned lag (seconds). */
  lag(): number;
  /** The amplitude envelope (caller's units). */
  envelope(): number;
  /** The kind the last learned stroke was classified as (`auto`). */
  lastKind(): 'surface' | 'air' | null;
  reset(): void;
}

export interface Quadratic {
  a: number;
  b: number;
  c: number;
  /** Root-mean-square residual of the fit. */
  rms: number;
}

/**
 * Least-squares quadratic `d(τ) = a + b τ + c τ²`, `τ = t - t0` (the origin is the
 * caller's choice, for conditioning). Null for fewer than three points or a
 * singular system.
 */
export function fitQuadratic(ts: readonly number[], ds: readonly number[], t0: number): Quadratic | null {
  const n = ts.length;
  if (n < 3 || ds.length !== n) return null;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, r0 = 0, r1 = 0, r2 = 0;
  for (let i = 0; i < n; i++) {
    const x = ts[i] - t0;
    const x2 = x * x;
    const y = ds[i];
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    r0 += y;
    r1 += x * y;
    r2 += x2 * y;
  }
  const s0 = n;
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  const a = (r0 * (s2 * s4 - s3 * s3) - s1 * (r1 * s4 - s3 * r2) + s2 * (r1 * s3 - s2 * r2)) / det;
  const b = (s0 * (r1 * s4 - s3 * r2) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2)) / det;
  const c = (s0 * (s2 * r2 - r1 * s3) - s1 * (s1 * r2 - r1 * s2) + r0 * (s1 * s3 - s2 * s2)) / det;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const x = ts[i] - t0;
    const e = ds[i] - (a + b * x + c * x * x);
    ss += e * e;
  }
  return { a, b, c, rms: Math.sqrt(ss / n) };
}

/** Least-squares line `d(τ) = a + b τ` (as a degenerate {@link Quadratic}, c = 0). */
export function fitLine(ts: readonly number[], ds: readonly number[], t0: number): Quadratic | null {
  const n = ts.length;
  if (n < 2 || ds.length !== n) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = ts[i] - t0;
    sx += x;
    sy += ds[i];
    sxx += x * x;
    sxy += x * ds[i];
  }
  const det = n * sxx - sx * sx;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  const b = (n * sxy - sx * sy) / det;
  const a = (sy - b * sx) / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const e = ds[i] - (a + b * (ts[i] - t0));
    ss += e * e;
  }
  return { a, b, c: 0, rms: Math.sqrt(ss / n) };
}

const evalQ = (f: Quadratic, tau: number) => f.a + f.b * tau + f.c * tau * tau;

/**
 * When a quadratic (τ from its origin) reaches `level`, or turns before reaching it.
 * Looking AHEAD (`past` false, the prediction): the first root at or after τ = 0,
 * else the vertex if the trajectory is decelerating (it turns above the level;
 * `reaches` false). Looking AROUND (`past` true, the post-hoc refinement, where the
 * origin is the deepest SAMPLE and the true crossing may lie a little before it):
 * the root nearest τ = 0 on either side. `tau` is NaN when there is neither.
 */
export function crossingTau(fit: { a: number; b: number; c: number }, level: number, past = false): { tau: number; reaches: boolean } {
  const { a, b, c } = fit;
  const k = a - level;
  if (Math.abs(c) < 1e-12) {
    if (Math.abs(b) < 1e-12) return { tau: NaN, reaches: false };
    const tau = -k / b;
    if (past || (b > 0 && tau >= 0)) return { tau, reaches: true };
    return { tau: NaN, reaches: false };
  }
  // Looking ahead from at or below the level while still heading toward it: the
  // crossing was a moment ago — the backward root (never the exit root of a
  // decelerating trajectory, never "now" when it was earlier).
  if (!past && k >= 0 && b > 0) {
    const back = crossingTau(fit, level, true);
    return { tau: Number.isFinite(back.tau) ? Math.min(0, back.tau) : 0, reaches: true };
  }
  const disc = b * b - 4 * c * k;
  if (disc >= 0) {
    const sq = Math.sqrt(disc);
    const r1 = (-b - sq) / (2 * c);
    const r2 = (-b + sq) / (2 * c);
    if (past) return { tau: Math.abs(r1) <= Math.abs(r2) ? r1 : r2, reaches: true };
    const lo = Math.min(r1, r2);
    const hi = Math.max(r1, r2);
    if (lo >= -1e-9) return { tau: Math.max(0, lo), reaches: true };
    if (hi >= -1e-9) return { tau: Math.max(0, hi), reaches: true };
  }
  if (c < 0) {
    const tv = -b / (2 * c);
    if (past || tv >= 0) return { tau: tv, reaches: false };
  }
  return { tau: NaN, reaches: false };
}

/** The τ (both fits share an origin) where two quadratics meet, nearest `near`; NaN if none. */
export function intersectionTau(f: Quadratic, g: Quadratic, near: number): number {
  const A = f.c - g.c;
  const B = f.b - g.b;
  const C = f.a - g.a;
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) < 1e-12) return NaN;
    return -C / B;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return NaN;
  const sq = Math.sqrt(disc);
  const r1 = (-B - sq) / (2 * A);
  const r2 = (-B + sq) / (2 * A);
  return Math.abs(r1 - near) <= Math.abs(r2 - near) ? r1 : r2;
}

/** The vertex of the exact parabola through three points (τ from t1), clamped to
 *  [t0, t2]; the middle point when the three are not a cap. */
function vertexOf(t0: number, d0: number, t1: number, d1: number, t2: number, d2: number): { t: number; d: number } {
  const f = fitQuadratic([t0, t1, t2], [d0, d1, d2], t1);
  if (!f || !(f.c < 0)) return { t: t1, d: d1 };
  const tau = Math.max(t0 - t1, Math.min(t2 - t1, -f.b / (2 * f.c)));
  return { t: t1 + tau, d: evalQ(f, tau) };
}

const median3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Residuals kept for the jitter estimate. */
const JITTER_WINDOW = 16;

/**
 * The online jitter estimate: the MEDIAN of the last few residuals of a sample against
 * the median of its neighbours. The residual is zero on any monotone run and non-zero
 * only at a local extremum, so on a clean stroke it is non-zero exactly twice per
 * stroke — at the top and at the bottom, where a sharp surface impact makes it as
 * large as a frame's travel — while tracker noise makes it non-zero on most samples.
 * A mean (the detector's convention) is pulled up by the two kinks; the median of a
 * window that mostly holds the monotone run between them is not, so a clean V is not
 * mistaken for a noisy signal (which would gate every stroke out as tremor).
 */
class JitterEstimator {
  private readonly ring: number[] = [];
  private i = 0;
  push(resid: number): void {
    if (this.ring.length < JITTER_WINDOW) this.ring.push(resid);
    else this.ring[this.i] = resid;
    this.i = (this.i + 1) % JITTER_WINDOW;
  }
  /** How many residuals have been seen (the warm-up gate reads it). */
  count(): number {
    return this.ring.length === JITTER_WINDOW ? JITTER_WINDOW : this.ring.length;
  }
  /** NaN until the first residual. */
  value(): number {
    if (!this.ring.length) return NaN;
    const s = [...this.ring].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
  }
  reset(): void {
    this.ring.length = 0;
    this.i = 0;
  }
}

/** A confirmed stroke waiting for its departure samples so the floor can be learned. */
interface Learning {
  /** Approach fit with origin at the bottom sample's time. */
  approach: Quadratic | null;
  bottomT: number;
  bottomD: number;
  vertexT: number;
  vertexD: number;
  /** The approach crossing of the floor in effect at confirmation (absolute). */
  crossing: number;
  /** Approach speed at the crossing (depth units / s). */
  approachSpeed: number;
  departT: number[];
  departD: number[];
}

export function createImpactPredictor(options: ImpactPredictorOptions = {}): ImpactPredictor {
  const o = { ...DEFAULTS, ...options };
  const sign = o.yDown ? 1 : -1;
  let minLead = o.minLead;
  const levelKnown = typeof options.level === 'number' && Number.isFinite(options.level);

  // The stroke in progress: samples since the top (the least depth since the last
  // confirmation), bounded.
  const ts: number[] = [];
  const ds: number[] = [];
  let prevD = NaN;
  let prev2D = NaN;
  let prevT = NaN;
  let lastT = -Infinity;
  let topD = Infinity;
  let maxD = -Infinity;
  let maxT = NaN;
  /** The fastest downward step of the stroke in progress (depth units per second). */
  let peakSpeed = 0;
  let level = levelKnown ? (options.level as number) : NaN;
  let lag = 0;
  let lagN = 0;
  let envelope = 0;
  let envelopeT = NaN;
  const jitterEst = new JitterEstimator();
  let period = o.initialPeriod;
  let lastConfirmT = -Infinity;
  let committed: ImpactPrediction | null = null;
  let tentative = NaN;
  let learning: Learning | null = null;
  let lastKind: 'surface' | 'air' | null = null;
  const votes: ('surface' | 'air')[] = [];

  const clearStroke = () => {
    ts.length = 0;
    ds.length = 0;
    topD = Infinity;
    maxD = -Infinity;
    maxT = NaN;
    peakSpeed = 0;
    committed = null;
    tentative = NaN;
  };
  const clearHistory = () => {
    clearStroke();
    prevD = NaN;
    prev2D = NaN;
    prevT = NaN;
    learning = null;
  };

  const decayEnvelope = (t: number) => {
    if (Number.isFinite(envelopeT) && t > envelopeT) envelope *= Math.pow(o.envelopeDecayPerSecond, t - envelopeT);
    envelopeT = t;
  };

  const passesAmplitude = (amplitude: number): boolean => {
    if (!(amplitude > 0)) return false;
    if (amplitude < o.minAmplitude) return false;
    // Warm-up: until the jitter estimate has enough residuals to mean anything, a
    // stroke must be big against something — the envelope or the absolute floor.
    if (jitterEst.count() < JITTER_WINDOW / 2 && envelope <= 0 && !(o.minAmplitude > 0)) return false;
    const jitter = jitterEst.value();
    if (Number.isFinite(jitter) && amplitude < o.minAmplitudeNoiseUnits * jitter) return false;
    if (envelope > 0 && amplitude < o.minAmplitudeFraction * envelope) return false;
    return true;
  };
  const strengthOf = (amplitude: number) => (envelope > 0 ? amplitude / envelope : 1);

  /** The first history index of the approach fit ending just before `end`: the samples
   *  within `approachWindow` of the last one, at least `minApproachSamples` when the
   *  history has them, at most `maxApproachSamples`. */
  const approachStart = (end: number): number => {
    const last = ts[end - 1];
    let from = end;
    while (from > 0 && end - from < o.maxApproachSamples && (last - ts[from - 1] <= o.approachWindow || end - from < o.minApproachSamples)) from--;
    return from;
  };

  const learnLag = (observed: number) => {
    if (!(o.lagGain > 0) || !Number.isFinite(observed)) return;
    lag = lagN === 0 ? observed : lag + o.lagGain * (observed - lag);
    lagN++;
  };
  const learnLevel = (observed: number) => {
    if (levelKnown || !Number.isFinite(observed)) return;
    level = Number.isFinite(level) ? level + o.levelGain * (observed - level) : observed;
  };

  /** The departure is in: classify the stroke and learn the floor and lag. */
  const finishLearning = (L: Learning) => {
    learning = null;
    const { approach } = L;
    if (!approach) {
      // No usable approach: learn what the vertex says, under the air rule.
      learnLevel(L.vertexD);
      return;
    }
    const departure = L.departT.length >= 3 ? fitQuadratic(L.departT, L.departD, L.bottomT) : fitLine(L.departT, L.departD, L.bottomT);
    let kind: 'surface' | 'air' = o.mode === 'auto' ? 'air' : o.mode;
    let kinkTau = NaN;
    if (departure) kinkTau = intersectionTau(approach, departure, 0);
    if (o.mode === 'auto') {
      // The rebound: the speed over the first step past the bottom, over the approach
      // speed at the crossing. Voted over the last three strokes.
      const step = (L.bottomD - L.departD[0]) / Math.max(1e-6, L.departT[0] - L.bottomT);
      const ratio = L.approachSpeed > 0 ? Math.abs(step) / L.approachSpeed : 0;
      votes.push(ratio < o.airBelowRebound ? 'air' : 'surface');
      if (votes.length > 3) votes.shift();
      const airVotes = votes.filter((v) => v === 'air').length;
      kind = airVotes * 2 > votes.length ? 'air' : airVotes * 2 === votes.length ? votes[votes.length - 1] : 'surface';
    }
    lastKind = kind;
    const dtDep = L.departT[0] - L.bottomT;
    if (kind === 'surface' && Number.isFinite(kinkTau) && Math.abs(kinkTau) < 2 * dtDep) {
      const kinkT = L.bottomT + kinkTau;
      learnLevel(evalQ(approach, kinkTau));
      learnLag(kinkT - L.crossing);
      return;
    }
    // Air: the turn is where the departure's velocity is zero — its quadratic's
    // vertex, when the fit is a cap with its vertex near the bottom sample.
    let refT = L.vertexT;
    let refD = L.vertexD;
    if (o.airReference === 'departure' && departure && departure.c < 0) {
      const tv = -departure.b / (2 * departure.c);
      const dt = L.departT[0] - L.bottomT;
      if (tv > -2 * dt && tv < 2 * dt) {
        refT = L.bottomT + tv;
        refD = evalQ(departure, tv);
      }
    }
    learnLevel(refD);
    learnLag(refT - L.crossing);
  };

  return {
    push(s) {
      const events: ImpactEvent[] = [];
      const t = s.t;
      const d = sign * s.y;
      if (t < lastT || t - lastT > o.maxGap) clearHistory();
      const dt = Number.isFinite(prevT) ? t - prevT : NaN;
      lastT = t;
      decayEnvelope(t);

      // Online jitter: the residual of the previous sample against the median of its
      // neighbours (the `enroll/noise.ts` convention), in the caller's units.
      if (Number.isFinite(prev2D) && Number.isFinite(prevD)) jitterEst.push(Math.abs(prevD - median3(prev2D, prevD, d)));
      const jitter = jitterEst.value();
      const margin = Number.isFinite(jitter) ? o.reversalNoiseUnits * jitter : 0;

      // 0. A stroke waiting for its departure: collect samples while moving away from
      //    the floor; a new descent before enough arrived abandons the learning.
      if (learning) {
        const L = learning;
        const lastDep = L.departD.length ? L.departD[L.departD.length - 1] : L.bottomD;
        if (d < lastDep + margin) {
          L.departT.push(t);
          L.departD.push(d);
          if (L.departT.length >= o.departureSamples) finishLearning(L);
        } else {
          learning = null;
        }
      }

      // 1. The reversal: depth came back up from the running maximum by more than the
      //    noise margin, and the stroke was big enough. Confirm at THIS sample.
      // A stroke whose fastest step never reached the speed floor is a drift (a slow
      // sweep spans a stroke's depth but never at a stroke's speed): no event; the
      // history simply carries on, and nothing here delays the next real stroke.
      const fastEnough = !(o.minApproachSpeed > 0) || peakSpeed >= o.minApproachSpeed;
      if (ts.length >= 1 && d < maxD - margin && fastEnough && t - lastConfirmT >= o.refractoryFraction * period) {
        const amplitude = maxD - topD;
        if (passesAmplitude(amplitude)) {
          const iMax = ts.lastIndexOf(maxT);
          const aT = iMax > 0 ? ts[iMax - 1] : NaN;
          const aD = iMax > 0 ? ds[iMax - 1] : NaN;
          const v = Number.isFinite(aT) ? vertexOf(aT, aD, maxT, maxD, t, d) : { t: maxT, d: maxD };
          // The approach fit over the samples BEFORE the bottom (the bottom sample may
          // sit on the surface or be blurred across it), origin at the bottom.
          const from = approachStart(iMax);
          const approach = iMax - from >= o.minApproachSamples ? fitQuadratic(ts.slice(from, iMax), ds.slice(from, iMax), maxT) : null;
          const floor = Number.isFinite(level) ? level : v.d;
          let crossing = NaN;
          let approachSpeed = NaN;
          let fit: ImpactConfirmation['fit'] = null;
          if (approach) {
            const x = crossingTau(approach, floor, true);
            fit = { samples: iMax - from, b: approach.b, tau: x.tau, reaches: x.reaches };
            // Only a crossing near the bottom is the impact (the fit is local).
            if (approach.b > 0 && Number.isFinite(x.tau) && Math.abs(x.tau) < 2 * (Number.isFinite(dt) ? dt : 0.05)) {
              crossing = maxT + x.tau;
              approachSpeed = Math.abs(approach.b + 2 * approach.c * x.tau);
            }
          }
          // The post-hoc estimate: for a surface stroke the approach crossing plus
          // the learned lag (the crossing is exact where the plane is); for an air
          // stroke the three-sample vertex (the smooth turn is what a parabola fits,
          // and the crossing sits a brake's length early). The kind is the last
          // learned one — strokes repeat — until this stroke's departure is seen.
          const airLike = o.mode === 'air' || (o.mode === 'auto' && lastKind === 'air');
          const refined = Number.isFinite(crossing) && !airLike ? crossing + lag : v.t;
          const strength = strengthOf(amplitude);
          events.push({
            kind: 'confirm',
            t: refined,
            at: t,
            predicted: committed ? committed.t : null,
            correction: committed ? refined - committed.t : null,
            strength,
            confidence: clamp01(strength),
            vertex: v.t,
            crossing,
            depth: v.d,
            fit,
          });
          learning = {
            approach: Number.isFinite(crossing) ? approach : null,
            bottomT: maxT,
            bottomD: maxD,
            vertexT: v.t,
            vertexD: v.d,
            crossing,
            approachSpeed,
            departT: [t],
            departD: [d],
          };
          envelope = Math.max(envelope, amplitude);
          lastConfirmT = t;
          clearStroke();
        }
      }

      // 2. Track the stroke: at (or within noise of) the least depth since the last
      //    confirmation, the approach has not started — the history begins here.
      if (d <= topD + margin) {
        ts.length = 0;
        ds.length = 0;
        topD = Math.min(topD, d);
        maxD = -Infinity;
        maxT = NaN;
        peakSpeed = 0;
        committed = null;
        tentative = NaN;
      }
      ts.push(t);
      ds.push(d);
      if (Number.isFinite(prevD) && Number.isFinite(dt) && dt > 0 && d > prevD) peakSpeed = Math.max(peakSpeed, (d - prevD) / dt);
      if (d > maxD) {
        maxD = d;
        maxT = t;
      }
      const keep = o.maxApproachSamples + 3;
      if (ts.length > keep) {
        ts.splice(0, ts.length - keep);
        ds.splice(0, ds.length - keep);
      }

      // 3. Predict, while descending toward a known or learned floor and not yet
      //    committed for this stroke.
      if (!committed && Number.isFinite(level) && d > prevD && ts.length >= o.minApproachSamples) {
        const from = approachStart(ts.length);
        const f = ts.length - from >= o.minApproachSamples ? fitQuadratic(ts.slice(from), ds.slice(from), t) : null;
        if (f && f.b > 0 && Math.max(f.b, peakSpeed) >= o.minApproachSpeed) {
          const x = crossingTau(f, level);
          if (Number.isFinite(x.tau)) {
            const crossing = t + x.tau;
            const tPred = crossing + lag;
            const amplitude = level - topD;
            // The point must have actually come part of the way down: a fit through a
            // few noise samples at rest can "reach" a floor a stroke away. The
            // tentative prediction only starts counting once it has (a fit from before
            // is not one this one has to agree with).
            const jit = jitterEst.value();
            const descent = d - topD;
            const descended =
              descent >= o.minDescentFraction * amplitude &&
              descent >= o.minAmplitude * 0.5 &&
              (!Number.isFinite(jit) || descent >= o.minAmplitudeNoiseUnits * jit);
            const agrees = descended && Number.isFinite(tentative) && Math.abs(tPred - tentative) <= o.stabilityTolerance;
            const first = descended && !Number.isFinite(tentative);
            if (descended) tentative = tPred;
            const lead = tPred - t;
            // As late as possible: commit now if the next sample would leave less than
            // the needed lead, allowing for the prediction still moving by its
            // tolerance; a stroke whose first usable fit is already the last chance
            // commits on it rather than a frame late.
            const lastChance = !Number.isFinite(dt) || lead - dt - o.stabilityTolerance < minLead;
            const stable = !Number.isFinite(o.stabilityTolerance) || agrees || (first && lastChance);
            if (stable && lastChance && descended && passesAmplitude(amplitude) && t - lastConfirmT >= o.refractoryFraction * period) {
              const strength = strengthOf(amplitude);
              committed = { kind: 'predict', t: tPred, at: t, lead, strength, confidence: clamp01(strength), crossing };
              events.push(committed);
            }
          }
        }
      }

      prev2D = prevD;
      prevD = d;
      prevT = t;
      return events;
    },
    setPeriod(p) {
      if (Number.isFinite(p) && p > 0) period = p;
    },
    setMinLead(lead) {
      if (Number.isFinite(lead)) minLead = Math.max(0, lead);
    },
    level: () => level,
    lag: () => lag,
    envelope: () => envelope,
    lastKind: () => lastKind,
    reset() {
      clearHistory();
      lastT = -Infinity;
      level = levelKnown ? (options.level as number) : NaN;
      lag = 0;
      lagN = 0;
      envelope = 0;
      envelopeT = NaN;
      jitterEst.reset();
      period = o.initialPeriod;
      lastConfirmT = -Infinity;
      lastKind = null;
      votes.length = 0;
    },
  };
}
