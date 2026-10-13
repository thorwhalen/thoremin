/**
 * The body's visual-impact detector (#374, body-movement A2): beat candidates from
 * several tracked joints at once, behind the {@link AnchorDetector} seam.
 *
 * Design §3.3 of the body-movement plan, as A1's measurement corrected it
 * (`docs/research/body-conducting-and-pose-categories.md` §4-5):
 *
 * 1. **Body units.** Each joint's position is divided by the running median of the
 *    frame's `scale` (the image torso length) and a trailing mean over `detrendS` is
 *    subtracted (a camera tilt, a player stepping toward the camera).
 * 2. **One event envelope per joint.** The default event is the joint's own TURNING
 *    POINT (`extremum`: the bottom of its vertical travel, the stroke detector's
 *    ictus), which won 31 of 32 significant cells on the real clips. `deceleration`
 *    (the dance literature's visual beat: braking of the speed, three-sample
 *    derivatives), `acceleration` (where observers place a conductor's beat) and
 *    `impact` (directional braking into the bottom) are the options; the speed-only
 *    events read the image plane, or the vertical alone with `axis: 'vertical'` (the
 *    bounce), since a plane deceleration fires at both ends of a bounce.
 * 3. **Peaks in noise units.** Each envelope is counted in multiples of its own
 *    median absolute deviation over the last `noiseWindowS`, so a wrist and a trunk
 *    compare; a peak must clear `peakMads` and a refractory of a quarter period.
 * 4. **Weights: visibility times periodicity.** A joint's periodicity is the
 *    regularity of its own peaks (one minus the spread of its recent intervals over
 *    their median, in units of `regularityTolerance`) times how near its interval sits
 *    to the follower's period (a Gaussian in octaves; no octave is equivalent, so an
 *    arm at the half-bar loses to a trunk at the beat). Before any joint has shown a
 *    rhythm, the stated `weight`s order them.
 * 5. **Select, do not sum (by default).** A1 found the summed envelope below the best
 *    single channel on every clip: joints in one body move at different levels and
 *    lags, so a sum mixes them. `combine: 'select'` follows the joint with the best
 *    weight (switching only past `switchMargin`, or when it is lost) and emits ITS
 *    peaks; `combine: 'weighted'` is §3.3's envelope, `Σ w·v·z / Σ w·v` over the
 *    joints' noise-unit envelopes, with the weights raised to `lockExponent` so it
 *    leans toward selection.
 * 6. **The anchor** is refined below the frame by the three-point parabola
 *    (`parabolicOffset`) and filled as the stroke detector fills it: `strength` is the
 *    dominant joint's excursion over the last period against its decaying recent
 *    maximum, `sharpness` its peak deceleration over its mean speed in the approach
 *    (half a period), `lateral` its horizontal travel since its previous anchor in body
 *    units (mirrored with `mirrorX`); `confidence` is the strength, halved for a joint
 *    that has not yet shown a rhythm.
 *
 * Pure, causal, clock-free: every number comes from frames already pushed.
 */
import { median } from '@thoremin/stats';
import { parabolicOffset } from './detector';
import { MIN_VISIBILITY } from './anchor';
import type { Anchor, AnchorDetector } from './types';

export const IMPACT_EVENTS = ['extremum', 'deceleration', 'impact', 'acceleration'] as const;
export type ImpactEventKind = (typeof IMPACT_EVENTS)[number];

/** One joint the detector reads: a channel of the frame and its stated weight (the
 *  order of preference before any joint has shown a rhythm). */
export interface ImpactJoint {
  channel: string;
  weight?: number;
}

/**
 * A1's default set for the body conductor (`docs/research/body-conducting-and-pose-
 * categories.md` §5), as channel names the caller fills: `wrist` is the BEATING wrist,
 * `elbow` its elbow (the fallback when the wrist is lost), `trunk` the trunk centroid
 * (the midpoint of the shoulders' and the hips' midpoints, `com.y` in A1's tables: the
 * body's own beat, R 0.77 and 0.68 on two of three conductor clips). The head is not in
 * the set (weaker than the trunk on every clip), nor the torso's rotation (the bar, not
 * the beat).
 */
export const BODY_IMPACT_JOINTS: readonly ImpactJoint[] = [
  { channel: 'wrist', weight: 1 },
  { channel: 'trunk', weight: 0.8 },
  { channel: 'elbow', weight: 0.6 },
];

export interface ImpactDetectorOptions {
  /** The joints to read (names, or names with weights). Default {@link BODY_IMPACT_JOINTS}. */
  joints?: ReadonlyArray<string | ImpactJoint>;
  /** What an anchor is; see the module doc. Default `extremum`. */
  event?: ImpactEventKind;
  /** The speed-only events (`deceleration`, `acceleration`) over the image plane or
   *  the vertical alone (the bounce). `extremum` and `impact` are vertical by
   *  definition. Default `plane`. */
  axis?: 'plane' | 'vertical';
  /** Follow the best joint (`select`) or sum them (`weighted`). Default `select`. */
  combine?: 'select' | 'weighted';
  /** Image coordinates (`y` down), as {@link Sample}. Default true. */
  yDown?: boolean;
  /** Which end of the vertical travel is the beat. Default `bottom` (the ictus at the
   *  bottom; which end a body lands on differs between people, A1 §2.2). */
  polarity?: 'bottom' | 'top';
  /** Mirror `x` so `lateral` is positive toward the player's right. Default false. */
  mirrorX?: boolean;
  /** A joint below this visibility is not seen. Default {@link MIN_VISIBILITY}. */
  minVisibility?: number;
  /** The period (seconds) until {@link AnchorDetector.setPeriod} supplies one; the
   *  stroke detector's default. */
  initialPeriod?: number;
  /** Refractory window after a peak, as a fraction of the period. */
  refractoryFraction?: number;
  /** A peak must rise this many median absolute deviations of the envelope above the
   *  lowest value since the previous peak (its prominence; A1's offline picker used a
   *  level, median plus `PEAK_MADS`, which misses a 4-pattern's small strokes). */
  peakMads?: number;
  /** A peak is confirmed once the envelope has fallen this many MADs below it. */
  confirmMads?: number;
  /** ... and at least this many multiples of the envelope's own frame-to-frame jitter
   *  (a sigma from the median third difference), so tracker noise on a small bounce
   *  cannot confirm a peak early. */
  confirmJitter?: number;
  /** Seconds of envelope the median and MAD are taken over. */
  noiseWindowS?: number;
  /** Seconds of the trailing mean subtracted from each position (A1's `DETREND_S`),
   *  rounded to a whole number of periods. */
  detrendS?: number;
  /** Seconds of `scale` the body unit is the running median of (A1's `TORSO_SPAN_S`). */
  scaleSpanS?: number;
  /** A joint unseen for longer than this (seconds) restarts its derivatives and its
   *  peak triple; a shorter gap is bridged. */
  maxGapS?: number;
  /** A joint's regularity is read over its last this many peak intervals. */
  regularityIntervals?: number;
  /** Fewer intervals than this and the joint has shown no rhythm (regularity 0). */
  minRegularityIntervals?: number;
  /** The spread of the intervals (MAD over median) at which regularity reaches 0. */
  regularityTolerance?: number;
  /** A joint whose last peak is older than this many of its own intervals has stopped. */
  staleIntervals?: number;
  /** Width (one sigma, in octaves) of the match between a joint's interval and the
   *  follower's period. */
  levelWidthOctaves?: number;
  /** Added to every joint's periodicity before weighting, so the stated weights order
   *  the joints while none has a rhythm. */
  lockFloor?: number;
  /** The weighted envelope's weights are `(lockFloor + periodicity) ^ lockExponent`. */
  lockExponent?: number;
  /** `select` switches joints only when another's weight exceeds the current one's by
   *  this factor (or the current one is lost). */
  switchMargin?: number;
  /** The amplitude envelope (the `strength` reference) decays by this factor per
   *  second, as the stroke detector's. */
  envelopeDecayPerSecond?: number;
  /** Refine anchor times below the frame period. Default true. */
  subframe?: boolean;
}

export const IMPACT_DEFAULTS: Required<Omit<ImpactDetectorOptions, 'joints'>> = {
  event: 'extremum',
  axis: 'plane',
  combine: 'select',
  yDown: true,
  polarity: 'bottom',
  mirrorX: false,
  minVisibility: MIN_VISIBILITY,
  initialPeriod: 0.6,
  refractoryFraction: 0.25,
  peakMads: 1,
  confirmMads: 0.25,
  confirmJitter: 2,
  noiseWindowS: 4,
  detrendS: 2,
  scaleSpanS: 1,
  maxGapS: 0.25,
  regularityIntervals: 8,
  minRegularityIntervals: 3,
  regularityTolerance: 0.25,
  staleIntervals: 3,
  levelWidthOctaves: 0.35,
  lockFloor: 0.1,
  lockExponent: 4,
  switchMargin: 1.25,
  envelopeDecayPerSecond: 0.9,
  subframe: true,
};

/** The impact detector, with readouts for tests and display. */
export interface ImpactDetector extends AnchorDetector {
  /** Each joint's current weight (visibility times stated weight times
   *  `(lockFloor + periodicity) ^ lockExponent`). */
  weights(): Record<string, number>;
  /** Each joint's periodicity, 0..1 (regularity times level match). */
  periodicity(): Record<string, number>;
  /** The joint `select` follows (null before any is seen). */
  selected(): string | null;
}

interface TimedValue {
  t: number;
  v: number;
}

interface Peak {
  t: number;
  /** Height in noise units. */
  z: number;
}

/**
 * A causal peak picker over one envelope: a peak is the highest value of an excursion
 * that has RISEN `peakMads` MADs (of the trailing window) above the lowest value since
 * the previous peak (a prominence, not a level, so the small strokes of a beat pattern
 * count as well as the big one), CONFIRMED
 * once the envelope has fallen below it by `confirmMads` MADs and by `confirmJitter`
 * times its own jitter. Tracking the excursion's
 * maximum until the fall is decisive is what keeps tracker noise near a sharp bottom
 * from firing twice (A1 saw false doubles at the bottom of slow strokes); the cost is
 * a frame or two of latency, which the prior's prediction absorbs. The refractory gap
 * is counted from the last peak emitted.
 */
function createPeakPicker(windowS: number, peakMads: number, confirmMads: number, confirmJitter: number, subframe: boolean) {
  let window: TimedValue[] = [];
  /** |third difference| of consecutive values over the window: the jitter estimate. */
  let d3: TimedValue[] = [];
  let jitter = NaN;
  let prev: TimedValue | null = null;
  /** The excursion's running maximum, its neighbours for the parabola. */
  let top: { before: TimedValue | null; at: TimedValue; after: TimedValue | null } | null = null;
  let lastPeakT = -Infinity;
  /** The lowest value since the last peak confirmed: what a rise is measured from. */
  let valley = Infinity;
  let med = NaN;
  let mad = NaN;

  const restat = () => {
    const vs = window.map((p) => p.v);
    med = median(vs);
    mad = median(vs.map((v) => Math.abs(v - med)));
    jitter = d3.length ? median(d3.map((p) => p.v)) / JITTER_FROM_THIRD_DIFFERENCE : NaN;
  };
  /** The last four values, for the third difference. */
  let last4: number[] = [];

  return {
    /** The value in noise units against the current window (NaN while unknown). */
    noise(v: number): number {
      return mad > 0 ? (v - med) / mad : NaN;
    },
    push(t: number, v: number, minGapS: number): Peak | null {
      window.push({ t, v });
      while (window.length && window[0].t < t - windowS) window.shift();
      last4.push(v);
      if (last4.length > 4) last4.shift();
      if (last4.length === 4) d3.push({ t, v: Math.abs(last4[3] - 3 * last4[2] + 3 * last4[1] - last4[0]) });
      while (d3.length && d3[0].t < t - windowS) d3.shift();
      restat();
      const c = { t, v };
      let peak: Peak | null = null;
      if (top && top.after === null) top.after = c;
      if (top === null) valley = Math.min(valley, v);
      if (mad > 0) {
        const noise = Number.isFinite(jitter) ? confirmJitter * jitter : 0;
        if (top === null) {
          if (v - valley >= Math.max(peakMads * mad, noise)) top = { before: prev, at: c, after: null };
        } else if (v > top.at.v) {
          top = { before: prev, at: c, after: null };
        } else if (v <= top.at.v - Math.max(confirmMads * mad, noise)) {
          const { before, at, after } = top;
          top = null;
          valley = v;
          if (at.t - lastPeakT >= minGapS) {
            let tp = at.t;
            if (subframe && before && after) {
              const off = parabolicOffset(before.v, at.v, after.v);
              tp += off * (off < 0 ? at.t - before.t : after.t - at.t);
            }
            peak = { t: tp, z: (at.v - med) / mad };
            lastPeakT = at.t;
          }
        }
      }
      prev = c;
      return peak;
    },
    /** Forget the excursion in progress (a gap), keep the noise window. */
    break(): void {
      prev = null;
      top = null;
      last4 = [];
      valley = Infinity;
    },
    reset(): void {
      window = [];
      d3 = [];
      last4 = [];
      jitter = NaN;
      prev = null;
      top = null;
      lastPeakT = -Infinity;
      med = NaN;
      mad = NaN;
    },
  };
}

/** A white-noise sigma from the median |third difference|: the difference has variance
 *  20 sigma^2, and a normal's median absolute value is 0.6745 sigma. */
const JITTER_FROM_THIRD_DIFFERENCE = 0.6745 * Math.sqrt(20);

interface Kin {
  t: number;
  x: number;
  y: number;
}

interface HistoryPoint {
  t: number;
  /** Body units, NOT detrended (lateral travel). */
  x: number;
  /** Detrended vertical, beat end positive. */
  y: number;
  /** Detrended horizontal. */
  dx: number;
  speed: number;
  decel: number;
}

export function createImpactDetector(options: ImpactDetectorOptions = {}): ImpactDetector {
  const { joints: jointsOpt, ...rest } = options;
  const o = { ...IMPACT_DEFAULTS, ...rest };
  const joints = (jointsOpt ?? BODY_IMPACT_JOINTS).map((j) => (typeof j === 'string' ? { channel: j, weight: 1 } : { channel: j.channel, weight: j.weight ?? 1 }));
  if (joints.length === 0) throw new Error('createImpactDetector: no joints');
  const ySign = (o.yDown ? 1 : -1) * (o.polarity === 'bottom' ? 1 : -1);
  const xSign = o.mirrorX ? -1 : 1;
  const derivativeEvent = o.event !== 'extremum';
  const planeSpeed = o.axis === 'plane' && (o.event === 'deceleration' || o.event === 'acceleration');

  let period = o.initialPeriod;
  let scales: TimedValue[] = [];
  let envelope = 0;
  let envelopeT = NaN;
  let lastAnchorT = -Infinity;
  let selected: number | null = null;
  const combined = createPeakPicker(o.noiseWindowS, o.peakMads, o.confirmMads, o.confirmJitter, o.subframe);

  const newJoint = (j: { channel: string; weight: number }) => ({
    ...j,
    lastSeenT: -Infinity,
    vis: 0,
    trail: [] as Kin[],
    trailX: 0,
    trailY: 0,
    pts: [] as Kin[],
    vels: [] as Array<{ t: number; vx: number; vy: number; speed: number }>,
    history: [] as HistoryPoint[],
    picker: createPeakPicker(o.noiseWindowS, o.peakMads, o.confirmMads, o.confirmJitter, o.subframe),
    peaks: [] as number[],
    lastAnchorX: NaN,
  });
  type Joint = ReturnType<typeof newJoint>;
  let state: Joint[] = joints.map(newJoint);

  const bodyUnit = (): number => {
    const m = median(scales.map((s) => s.v));
    return m > 0 ? m : 1;
  };

  const periodicity = (j: Joint, t: number): number => {
    const n = j.peaks.length - 1;
    if (n < o.minRegularityIntervals) return 0;
    const iv: number[] = [];
    for (let i = 1; i < j.peaks.length; i++) iv.push(j.peaks[i] - j.peaks[i - 1]);
    const med = median(iv);
    if (!(med > 0)) return 0;
    if (t - j.peaks[j.peaks.length - 1] > o.staleIntervals * med) return 0;
    const spread = median(iv.map((d) => Math.abs(d - med))) / med;
    const regularity = Math.max(0, 1 - spread / o.regularityTolerance);
    const octaves = Math.log2(med / period) / o.levelWidthOctaves;
    return regularity * Math.exp(-0.5 * octaves * octaves);
  };

  const weightOf = (j: Joint, t: number): number => j.vis * j.weight * Math.pow(o.lockFloor + periodicity(j, t), o.lockExponent);

  /** Feed one joint's point; returns its envelope sample (time, value), if any. */
  const ingest = (j: Joint, t: number, px: number, py: number, unit: number): TimedValue | null => {
    if (t - j.lastSeenT > o.maxGapS) {
      j.pts = [];
      j.vels = [];
      j.picker.break();
    }
    j.lastSeenT = t;
    const x = px / unit;
    const y = (py / unit) * ySign;
    j.trail.push({ t, x, y });
    j.trailX += x;
    j.trailY += y;
    // The trailing mean spans a whole number of periods, so the beat's own movement
    // averages out of it instead of rippling into every turning point.
    const span = Math.max(1, Math.round(o.detrendS / period)) * period;
    while (j.trail.length > 1 && j.trail[0].t < t - span) {
      const old = j.trail.shift()!;
      j.trailX -= old.x;
      j.trailY -= old.y;
    }
    const dx = x - j.trailX / j.trail.length;
    const dy = y - j.trailY / j.trail.length;
    j.pts.push({ t, x: dx, y: dy });
    if (j.pts.length > 3) j.pts.shift();

    let speed = NaN;
    let decel = NaN;
    let env: TimedValue | null = derivativeEvent ? null : { t, v: dy };
    if (j.pts.length === 3) {
      const [p0, p1, p2] = j.pts;
      const dt = p2.t - p0.t;
      if (dt > 0) {
        const vx = (p2.x - p0.x) / dt;
        const vy = (p2.y - p0.y) / dt;
        speed = planeSpeed ? Math.hypot(vx, vy) : Math.abs(vy);
        j.vels.push({ t: p1.t, vx, vy, speed });
        if (j.vels.length > 3) j.vels.shift();
      }
    }
    if (j.vels.length === 3) {
      const [v0, v1, v2] = j.vels;
      const dt = v2.t - v0.t;
      if (dt > 0) {
        const ax = (v2.vx - v0.vx) / dt;
        const ay = (v2.vy - v0.vy) / dt;
        decel = Math.max(0, -(v2.speed - v0.speed) / dt);
        if (derivativeEvent) {
          const v =
            o.event === 'deceleration'
              ? decel
              : o.event === 'acceleration'
                ? planeSpeed
                  ? Math.hypot(ax, ay)
                  : Math.abs(ay)
                : Math.max(0, -ay);
          env = { t: v1.t, v: v };
        }
      }
    }
    j.history.push({ t, x, y: dy, dx, speed, decel });
    while (j.history.length > 1 && j.history[0].t < t - Math.max(2 * period, o.detrendS)) j.history.shift();
    return env;
  };

  /** Fill the anchor from the dominant joint's recent history. */
  const emit = (t: number, j: Joint, lock: number): Anchor => {
    const span = j.history.filter((h) => h.t >= t - period && h.t <= t + 1e-9);
    const approach = span.filter((h) => h.t >= t - period / 2);
    let amplitude = 0;
    if (span.length) {
      const ys = span.map((h) => h.y);
      const yr = Math.max(...ys) - Math.min(...ys);
      if (planeSpeed) {
        const xs = span.map((h) => h.dx);
        amplitude = Math.hypot(Math.max(...xs) - Math.min(...xs), yr);
      } else amplitude = yr;
    }
    if (Number.isFinite(envelopeT)) envelope *= Math.pow(o.envelopeDecayPerSecond, Math.max(0, t - envelopeT));
    envelopeT = t;
    const ref = envelope > 0 ? envelope : amplitude;
    const strength = ref > 0 ? amplitude / ref : 0;
    envelope = Math.max(envelope, amplitude);
    const speeds = approach.map((h) => h.speed).filter(Number.isFinite);
    const decels = approach.map((h) => h.decel).filter(Number.isFinite);
    const meanSpeed = speeds.length ? speeds.reduce((s, v) => s + v, 0) / speeds.length : NaN;
    const peakDecel = decels.length ? Math.max(...decels) : NaN;
    const sharpness = meanSpeed > 0 && Number.isFinite(peakDecel) ? peakDecel / meanSpeed : NaN;
    let nearest = j.history[j.history.length - 1];
    for (const h of j.history) if (Math.abs(h.t - t) < Math.abs(nearest.t - t)) nearest = h;
    const x = nearest?.x ?? NaN;
    const lateral = Number.isFinite(j.lastAnchorX) && Number.isFinite(x) ? xSign * (x - j.lastAnchorX) : 0;
    j.lastAnchorX = x;
    lastAnchorT = t;
    const confidence = Math.min(1, Math.max(0, strength)) * (0.5 + 0.5 * lock);
    return { t, confidence, strength, sharpness, lateral };
  };

  return {
    push(frame) {
      const { t } = frame;
      if (frame.scale !== undefined && frame.scale > 0 && Number.isFinite(frame.scale)) scales.push({ t, v: frame.scale });
      while (scales.length && scales[0].t < t - o.scaleSpanS) scales.shift();
      const unit = bodyUnit();
      const gap = o.refractoryFraction * period;

      const envs: Array<TimedValue | null> = [];
      const peaks: Array<Peak | null> = [];
      for (const j of state) {
        const p = frame.channels[j.channel];
        const vis = p ? (p.visibility ?? 1) : 0;
        if (!p || vis < o.minVisibility || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          j.vis = 0;
          envs.push(null);
          peaks.push(null);
          continue;
        }
        j.vis = vis;
        const env = ingest(j, t, p.x, p.y, unit);
        envs.push(env);
        const pk = env ? j.picker.push(env.t, env.v, gap) : null;
        if (pk) {
          j.peaks.push(pk.t);
          if (j.peaks.length > o.regularityIntervals + 1) j.peaks.shift();
        }
        peaks.push(pk);
      }

      const w = state.map((j) => weightOf(j, t));
      if (o.combine === 'select') {
        let best = -1;
        for (let i = 0; i < w.length; i++) if (w[i] > 0 && (best < 0 || w[i] > w[best])) best = i;
        if (selected === null || state[selected].vis === 0) selected = best >= 0 ? best : selected;
        else if (best >= 0 && best !== selected && w[best] > o.switchMargin * w[selected]) selected = best;
        if (selected === null) return null;
        const pk = peaks[selected];
        if (!pk || pk.t - lastAnchorT < gap) return null;
        return emit(pk.t, state[selected], periodicity(state[selected], t));
      }

      // Weighted: Σ w·z / Σ w over the joints with an envelope sample this frame.
      let num = 0;
      let den = 0;
      let envT = NaN;
      let dominant = -1;
      let dominantShare = -Infinity;
      for (let i = 0; i < state.length; i++) {
        const e = envs[i];
        if (!e || !(w[i] > 0)) continue;
        const z = state[i].picker.noise(e.v);
        if (!Number.isFinite(z)) continue;
        num += w[i] * z;
        den += w[i];
        envT = e.t;
        if (w[i] * z > dominantShare) {
          dominantShare = w[i] * z;
          dominant = i;
        }
      }
      if (!(den > 0)) {
        combined.break();
        return null;
      }
      const pk = combined.push(envT, num / den, gap);
      if (!pk || pk.t - lastAnchorT < gap || dominant < 0) return null;
      return emit(pk.t, state[dominant], periodicity(state[dominant], t));
    },
    setPeriod(p) {
      if (Number.isFinite(p) && p > 0) period = p;
    },
    reset() {
      period = o.initialPeriod;
      scales = [];
      envelope = 0;
      envelopeT = NaN;
      lastAnchorT = -Infinity;
      selected = null;
      combined.reset();
      state = joints.map(newJoint);
    },
    weights() {
      const t = state.reduce((m, j) => Math.max(m, j.lastSeenT), -Infinity);
      return Object.fromEntries(state.map((j) => [j.channel, weightOf(j, t)]));
    },
    periodicity() {
      const t = state.reduce((m, j) => Math.max(m, j.lastSeenT), -Infinity);
      return Object.fromEntries(state.map((j) => [j.channel, periodicity(j, t)]));
    },
    selected: () => (selected === null ? null : state[selected].channel),
  };
}
