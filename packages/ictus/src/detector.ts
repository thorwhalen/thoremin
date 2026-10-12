/**
 * The ictus detector — samples of one tracked point in, {@link Anchor}s out.
 *
 * Where the beat is in a conducting stroke has an engineering answer and a perceptual
 * one (research map §1.3, §1.4, §3). Every rule-based follower since the Radio Baton
 * fired on the vertical turning point at the bottom of the stroke; ensemble musicians,
 * measured, synchronise to the moment of maximal DECELERATION as the hand brakes into
 * that turning point, and the sharper the braking the clearer the beat. This detector
 * fires on the turning point and measures the braking:
 *
 * - `turning` (default): the bottom of the stroke — a local maximum of the vertical
 *   position — with the anchor time refined below the frame period by a parabolic fit
 *   through the three position samples around it, and the peak deceleration of the
 *   approach measured as the articulation signal. This is a deliberate v1 departure
 *   from the research map's "peak deceleration, parabolic fit of the speed minimum":
 *   at 30 Hz the speed near a turning point is V-shaped (|v| crosses zero linearly),
 *   so a parabola fitted to it is biased by half a frame, whereas the position is
 *   smooth and parabolic there and the fit is exact to a few milliseconds (the
 *   synthetic test pins < 8 ms). The braking sharpness is still measured, as the
 *   articulation axis; it is not the timing reference.
 * - `zeroCrossing`: conga's bounce detector — the vertical-velocity sign change,
 *   interpolated linearly. Kept for comparison on the fixtures.
 *
 * Both fire ONE frame after the turning point (the sample on the far side is what
 * confirms it), which is the irreducible latency of a causal extremum detector; the
 * oscillator downstream is what predicts ahead of it.
 *
 * Landmark streams are not clean: MediaPipe emits single-frame spikes, and a detector
 * that trusts every sample fires on them. Until #231 the input was median-of-three
 * filtered, which costs a frame of latency on every anchor and, worse, 5 ms of timing:
 * the median replaces the extremum sample by a neighbour exactly where the parabola
 * needs it, so on the sub-frame bench the filtered detector timed a sharp turn worse
 * than the frame-snapped baseline it refines (sd 12.4 ms against 10.8) and missed
 * strokes, while the unfiltered one was the best post-hoc estimator on the set (7.3).
 * So now the raw samples time, and three things stand in for the filter:
 *
 * - **A spike is a sample no hand could have reached.** A settled sample that departs
 *   from BOTH its neighbours, with the velocity reversing across it, faster than a
 *   human-hand speed ceiling (in the hand's own units: the caller's, or multiples of
 *   the player's amplitude envelope; never noise units, because at 15 fps a real ictus
 *   is itself a single sample hundreds of noise units from its neighbours, extremal on
 *   both axes on the side beats of 4/4) is bridged by the line between its
 *   neighbours. Read as an implied acceleration, `|2·mid − prev − next| / dt²`, the
 *   rule fires above `2 · ceiling / dt`: a reversal's implied acceleration is at most
 *   twice its speed over a frame, so the ceiling is the one quantity that is the same
 *   rule at every frame rate. The velocity-reversal test keeps a sample-and-hold
 *   stream (a 30 fps camera polled at 60 Hz: every position twice, then a jump) from
 *   reading as a spike on every duplicate-then-jump. The bridge is an interpolation
 *   rather than the median because on a monotone run the median of a spike and its
 *   neighbours IS a neighbour, which makes a flat, and a flat is a bottom. The newest
 *   sample has no far neighbour yet, so it is only ever deferred: if it left the last
 *   settled point faster than the ceiling it confirms nothing until it has settled.
 * - **The bottom is confirmed by a return, not by a neighbour.** The deepest settled
 *   point of the stroke is the bottom; the first sample that has come back from it by
 *   more than a margin (a few noise units, and a few hundredths of the envelope)
 *   confirms it, through the three points around it. A sharp stroke comes back by a
 *   third of itself in a frame, so it is confirmed on the first sample past its
 *   bottom; a one-frame wobble on the way down (the tracker pausing before it loses
 *   the hand, seen on the conducting fixtures) comes back by a hundredth and is not
 *   a bottom; a soft turn whose first return is within the margin is confirmed on its
 *   second sample, where the median always confirmed, and still timed exactly.
 * - **The stroke's top** stays the running highest point since the last anchor rather
 *   than a state a glitch can reset.
 *
 * The limit this leaves is physical: with three samples a one-frame spike and a sharp
 * V differ only in scale, so a spike smaller than the ceiling that lands exactly as
 * the sample after a descent can still read as a bottom; the amplitude gates are what
 * stand against it. The old behaviour is `prefilter: 'median'`, kept for the ablation.
 *
 * Gates, in the order they are applied: a refractory window (a fraction of the current
 * period, so the rebound's secondary dip cannot fire) and a stroke-amplitude floor
 * relative to the player's own recent envelope (side-to-side wiggle and tremor do not
 * beat). Everything relative, nothing in absolute units: the envelope is a slowly
 * decaying maximum of recent stroke amplitudes, so a conductor beating small and a
 * conductor beating large are both at "1".
 *
 * Pure state, no allocation per sample beyond the emitted anchor, no clock.
 */
import type { Anchor, Sample } from './types';

/** What is done to the samples before the turning point is looked for. */
export type Prefilter =
  /** Spikes (jumps faster than a hand can move) are bridged by their neighbours, so
   *  they cannot be a turning point; every other sample is trusted and times the
   *  anchor. No latency. */
  | 'spikes'
  /** Median-of-three on every sample: the pre-#231 detector, one frame of latency and
   *  a biased fit at a sharp turn. Kept for the ablation (`scripts/subframe/score.ts`). */
  | 'median'
  /** Every sample trusted, no jitter estimate, the immediate three-point rule (a
   *  bottom is the sample above both its neighbours): the frame-snapped baseline's
   *  input, kept exactly so the bench's `lowest` and `parabolaRaw` rows stay the
   *  published ones. */
  | 'none';

export interface DetectorOptions {
  /** `turning` (position maximum, parabolic refinement) or `zeroCrossing` (vertical
   *  velocity sign change, linear refinement). */
  mode?: 'turning' | 'zeroCrossing';
  /** Image coordinates: `y` grows downward, so the ictus is a maximum of `y`. Set false
   *  for a y-up world frame. */
  yDown?: boolean;
  /** Mirror `x` so that `lateral` is positive toward the PLAYER's right (a selfie view
   *  is mirrored; a recorded third-person video is not). */
  mirrorX?: boolean;
  /** See {@link Prefilter}. Default `spikes`. */
  prefilter?: Prefilter;
  /** @deprecated The pre-#231 switch: `true` is `prefilter: 'median'`, `false` is
   *  `prefilter: 'none'`. `prefilter` wins when both are given. */
  medianFilter?: boolean;
  /** The spike ceiling: a hand speed in the caller's units per second. A settled
   *  sample that departs from both its neighbours faster than this, with the velocity
   *  reversing across it, is a spike; the newest sample, rising from the last settled
   *  point faster than this, is deferred until it has settled. 0 = use the relative
   *  ceiling only. */
  maxSpeed?: number;
  /** The relative spike ceiling, in multiples of the amplitude envelope per second
   *  (unit-free, scaling with the player's strokes). The fastest human stroke covers
   *  its amplitude in under 100 ms, about 12 envelopes per second; the default is well
   *  above it, so a real turn is never a spike at any frame rate, and a jump of more
   *  than `ceiling · dt` envelopes is: the whole stroke at 30 fps, a third of it at
   *  120. Inactive until an envelope exists. 0 = off. */
  maxSpeedEnvelopes?: number;
  /** The turn is confirmed when the position has come back from the stroke's deepest
   *  point by more than this many noise units (multiples of the online jitter) AND
   *  more than `reversalFraction` of the envelope (0 = any strict rise). A sharp
   *  stroke rebounds by a good part of itself in one frame, so the margin costs it
   *  nothing; a one-frame wobble on the way down (a landmark pausing as the tracker
   *  loses the hand) comes back by a hundredth of the stroke and must not be the
   *  bottom; a soft, slow turn that comes back by less than the margin on its first
   *  frame is confirmed on the next, still timed through the right three points. */
  reversalNoiseUnits?: number;
  /** See `reversalNoiseUnits`: the reversal margin as a fraction of the amplitude
   *  envelope. Calibrated on the conducting fixtures: the tracker's wobbles there
   *  come back by 1 to 2 % of the envelope, a sharp stroke by a third or more of it
   *  in one frame at 30 fps, and a smooth 70 bpm turn by about 3 % in its first
   *  30 fps frame and 12 % in its second — so the soft turn is confirmed on its
   *  first or second frame (as the median prefilter always did on its second), the
   *  sharp one always on its first. */
  reversalFraction?: number;
  /** Refractory window after an anchor, as a fraction of the current period. */
  refractoryFraction?: number;
  /** Initial period estimate (seconds) used for the refractory window until the caller
   *  supplies a better one via {@link IctusDetector.setPeriod}. */
  initialPeriod?: number;
  /** A stroke whose vertical amplitude is below this fraction of the envelope is not a
   *  beat. */
  minAmplitudeFraction?: number;
  /** Absolute amplitude floor in the caller's units (0 = relative gate only). */
  minAmplitude?: number;
  /** A stroke must also exceed this many NOISE UNITS — multiples of the point's own
   *  frame-to-frame jitter, estimated online as the residual of each sample against the
   *  median of its neighbours (the same convention as `packages/sdk/src/enroll/noise.ts`). This is
   *  what keeps a still hand's tremor, or the small bounce of hands being raised into
   *  position, from beating before the envelope exists, in any units. A real stroke is
   *  hundreds of jitter units even from a small conductor at 30 fps. */
  minAmplitudeNoiseUnits?: number;
  /** Envelope decay per second: the recent-maximum amplitude shrinks by this factor
   *  each second, so a player who starts beating smaller is re-normalised within
   *  several seconds. */
  envelopeDecayPerSecond?: number;
  /** A gap between consecutive samples longer than this (seconds) restarts the
   *  detector's history: the point was lost, not still. */
  maxGap?: number;
  /** Refine the anchor time below the sample period (the parabolic fit in `turning`
   *  mode, the linear interpolation in `zeroCrossing`). Off = the frame-snapped
   *  detector: the sample's own time. Exists for the ablation that scores what the
   *  refinement buys (`scripts/subframe/score.ts`); on in every shipped use. */
  refine?: boolean;
}

/** The relative spike ceiling's default; the option's doc derives it. */
const SPIKE_SPEED_ENVELOPES = 30;

const DEFAULTS: Required<Omit<DetectorOptions, 'medianFilter'>> = {
  mode: 'turning',
  yDown: true,
  mirrorX: false,
  prefilter: 'spikes',
  maxSpeed: 0,
  maxSpeedEnvelopes: SPIKE_SPEED_ENVELOPES,
  reversalNoiseUnits: 2,
  reversalFraction: 0.03,
  refractoryFraction: 0.25,
  initialPeriod: 0.6,
  minAmplitudeFraction: 0.2,
  minAmplitude: 0,
  minAmplitudeNoiseUnits: 20,
  envelopeDecayPerSecond: 0.9,
  maxGap: 0.5,
  refine: true,
};

/** The deprecated `medianFilter` switch, resolved to a {@link Prefilter}. */
function resolvePrefilter(options: DetectorOptions): Prefilter {
  if (options.prefilter) return options.prefilter;
  if (options.medianFilter === true) return 'median';
  if (options.medianFilter === false) return 'none';
  return DEFAULTS.prefilter;
}

interface Point {
  t: number;
  x: number;
  /** Vertical position with DOWN positive (so the ictus is a maximum). */
  y: number;
  /** Vertical velocity, down positive, backward difference. */
  vy: number;
  /** A spike bridged by its neighbours (a point on the line between them). */
  bridged: boolean;
}

/** Parabolic peak interpolation: the offset (in samples, -0.5..0.5) of the extremum of a
 *  parabola through three equally spaced values. The standard three-point fit
 *  (Smith, "Quadratic Interpolation of Spectral Peaks"). 0 when the points are collinear. */
export function parabolicOffset(a: number, b: number, c: number): number {
  const denom = a - 2 * b + c;
  if (denom === 0 || !Number.isFinite(denom)) return 0;
  const p = (0.5 * (a - c)) / denom;
  return Math.max(-0.5, Math.min(0.5, p));
}

function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/**
 * The excursion of the middle of three samples: its speed away from the previous one,
 * its speed toward the next, and whether the velocity reverses across it (a
 * duplicate-then-jump has a zero velocity on one side, so it never reverses). The
 * two speeds are each over their own gap, so a dropped frame is handled. Reversing
 * with both speeds above a ceiling `V` is the same test as the implied acceleration
 * `|2·mid − prev − next| / dt²` exceeding `2 · V / dt`.
 */
export function excursion(prev: Sample, mid: Sample, next: Sample): { inSpeed: number; outSpeed: number; reverses: boolean } {
  const dt1 = mid.t - prev.t;
  const dt2 = next.t - mid.t;
  if (!(dt1 > 0) || !(dt2 > 0)) return { inSpeed: 0, outSpeed: 0, reverses: false };
  const v1x = (mid.x - prev.x) / dt1;
  const v1y = (mid.y - prev.y) / dt1;
  const v2x = (next.x - mid.x) / dt2;
  const v2y = (next.y - mid.y) / dt2;
  return { inSpeed: Math.hypot(v1x, v1y), outSpeed: Math.hypot(v2x, v2y), reverses: v1x * v2x + v1y * v2y < 0 };
}

export interface IctusDetector {
  /** Feed one sample. Returns an anchor when a beat candidate was confirmed by this
   *  sample, else null. Samples must arrive in time order. */
  push(sample: Sample): Anchor | null;
  /** Tell the detector the current period estimate (seconds) so the refractory window
   *  tracks the tempo. The oscillator calls this back. */
  setPeriod(period: number): void;
  /** The current amplitude envelope (caller's units) — for display and tests. */
  envelope(): number;
  /** The online jitter estimate (caller's units; NaN until estimated) — the noise unit
   *  the amplitude and reversal gates are counted in. For display and tests. */
  jitter(): number;
  reset(): void;
}

export function createIctusDetector(options: DetectorOptions = {}): IctusDetector {
  const o = { ...DEFAULTS, ...options, prefilter: resolvePrefilter(options) };
  const sign = o.yDown ? 1 : -1;
  const xSign = o.mirrorX ? -1 : 1;

  // The last three raw samples. A sample is SETTLED once the one after it has arrived
  // (its spike test needs both neighbours); the newest is provisional. The window the
  // turning point is looked for in is [p0, p1, p2] with p1 the candidate: with the
  // median prefilter all three are filtered points (p2 settles when the raw sample
  // after it arrives, hence that mode's extra frame); otherwise p0 and p1 are settled
  // and p2 is the provisional newest sample, so a turn at p1 is confirmed by the very
  // next sample.
  const raw: Sample[] = [];
  /** The settled points, newest last (at most three). */
  const settled: Point[] = [];
  /** The running bottom of the stroke in progress (`turning` on raw samples): the
   *  deepest settled point since the last anchor, with its neighbours for the fit. */
  let deepest: Point | null = null;
  let beforeDeepest: Point | null = null;
  let afterDeepest: Point | null = null;
  let period = o.initialPeriod;
  let envelope = 0;
  let envelopeT = NaN;
  let lastAnchorT = -Infinity;
  let lastAnchorX = NaN;
  /** Highest point (smallest down-positive y) seen since the last anchor. */
  let strokeTop = Infinity;
  /** Online jitter estimate: EW mean of |raw − median3| (the noise floor, caller's units). */
  let jitter = NaN;
  let jitterN = 0;
  /** Approach statistics for the stroke in progress (while moving down). */
  let peakDecel = 0;
  let speedSum = 0;
  let speedCount = 0;

  const clearHistory = () => {
    raw.length = 0;
    settled.length = 0;
    deepest = beforeDeepest = afterDeepest = null;
    strokeTop = Infinity;
    peakDecel = 0;
    speedSum = 0;
    speedCount = 0;
  };

  const decayEnvelope = (t: number) => {
    if (Number.isFinite(envelopeT) && t > envelopeT) {
      envelope *= Math.pow(o.envelopeDecayPerSecond, t - envelopeT);
    }
    envelopeT = t;
  };

  const passesAmplitude = (amplitude: number): boolean => {
    if (!(amplitude > 0)) return false;
    if (amplitude < o.minAmplitude) return false;
    if (Number.isFinite(jitter) && amplitude < o.minAmplitudeNoiseUnits * jitter) return false;
    if (envelope > 0 && amplitude < o.minAmplitudeFraction * envelope) return false;
    return true;
  };

  const noteJitter = (resid: number) => {
    jitterN++;
    jitter = jitterN === 1 ? resid : jitter + Math.max(1 / jitterN, 0.02) * (resid - jitter);
  };

  /** The spike ceiling in force: the absolute one, else the envelope-relative one. */
  const spikeCeiling = (): number => {
    if (o.maxSpeed > 0) return o.maxSpeed;
    if (o.maxSpeedEnvelopes > 0 && envelope > 0) return o.maxSpeedEnvelopes * envelope;
    return Infinity;
  };

  const emit = (t: number, x: number, amplitude: number): Anchor => {
    // Relative strength against the envelope BEFORE this stroke updates it, so the
    // first big stroke after quiet ones reads > 1 (a crescendo), then the envelope
    // catches up.
    const ref = envelope > 0 ? envelope : amplitude;
    const strength = ref > 0 ? amplitude / ref : 0;
    envelope = Math.max(envelope, amplitude);
    const meanSpeed = speedCount > 0 ? speedSum / speedCount : NaN;
    const sharpness = meanSpeed > 0 ? peakDecel / meanSpeed : NaN;
    const lateral = Number.isFinite(lastAnchorX) ? xSign * (x - lastAnchorX) : 0;
    lastAnchorT = t;
    lastAnchorX = x;
    strokeTop = Infinity;
    peakDecel = 0;
    speedSum = 0;
    speedCount = 0;
    return { t, confidence: Math.max(0, Math.min(1, strength)), strength, sharpness, lateral };
  };

  /** A settled point from the middle raw sample, under the prefilter in force. */
  const settle = (): Point | null => {
    const last = settled[settled.length - 1];
    const vyOf = (t: number, y: number) => (last && t > last.t ? (y - last.y) / (t - last.t) : 0);
    if (o.prefilter === 'median') {
      if (raw.length < 3) return null;
      const [a, b, c] = raw;
      const my = sign * median3(sign * a.y, sign * b.y, sign * c.y);
      // The residual of the middle sample against the median of its neighbours is the
      // frame-to-frame jitter, whether the hand is still or sweeping smoothly.
      noteJitter(Math.abs(sign * b.y - my));
      return { t: b.t, x: median3(a.x, b.x, c.x), y: my, vy: vyOf(b.t, my), bridged: false };
    }
    // The sample before the newest settles now; the first sample settles with the
    // second (it has no earlier neighbour to be a spike against).
    if (raw.length < 2) return null;
    const b = raw[raw.length - 2];
    let x = b.x;
    let y = sign * b.y;
    let bridged = false;
    if (raw.length === 3 && o.prefilter === 'spikes') {
      const [a, , c] = raw;
      const e = excursion(a, b, c);
      const ceiling = spikeCeiling();
      if (e.reverses && e.inSpeed > ceiling && e.outSpeed > ceiling) {
        const w = (b.t - a.t) / (c.t - a.t);
        x = a.x + w * (c.x - a.x);
        y = sign * (a.y + w * (c.y - a.y));
        bridged = true;
      } else {
        // A spike is not jitter: it would drag the noise floor (and every gate counted
        // in it) up by its whole size over the next hundred samples.
        noteJitter(Math.abs(y - median3(sign * a.y, y, sign * c.y)));
      }
    }
    return { t: b.t, x, y, vy: vyOf(b.t, y), bridged };
  };

  /** The fitted turning point through the three points around the bottom. */
  const emitTurn = (p0: Point, p1: Point, p2: Point, amplitude: number): Anchor => {
    const off = o.refine ? parabolicOffset(p0.y, p1.y, p2.y) : 0;
    const step = off >= 0 ? p2.t - p1.t : p1.t - p0.t;
    const x = p1.x + off * (off >= 0 ? p2.x - p1.x : p1.x - p0.x);
    return emit(p1.t + off * step, x, amplitude);
  };

  /** The turning point at p1, confirmed by p2, if there is one past the gates: the
   *  three-point window rule (`zeroCrossing`; `turning` under the median prefilter,
   *  where every point is already filtered, and under none, the ablation). */
  const detectWindow = (p0: Point, p1: Point, p2: Point): Anchor | null => {
    // Refractory: no anchor until a fraction of the period has passed.
    if (p1.t - lastAnchorT < o.refractoryFraction * period) return null;

    if (o.mode === 'zeroCrossing') {
      // Down at p1, not down at p2: the crossing lies between them.
      if (!(p1.vy > 0 && p2.vy <= 0)) return null;
      const amplitude = p1.y - strokeTop;
      if (!passesAmplitude(amplitude)) return null;
      const frac = o.refine ? p1.vy / (p1.vy - p2.vy) : 0;
      return emit(p1.t + frac * (p2.t - p1.t), p1.x + frac * (p2.x - p1.x), amplitude);
    }

    // `turning`: p1 is a local maximum of the down-positive position, i.e. the bottom
    // of the stroke, approached from above.
    const isBottom = p1.y >= p0.y && p1.y >= p2.y && (p1.y > p0.y || p1.y > p2.y);
    if (!isBottom) return null;
    const amplitude = p1.y - Math.min(strokeTop, p0.y);
    if (!passesAmplitude(amplitude)) return null;
    return emitTurn(p0, p1, p2, amplitude);
  };

  /** `turning` on raw samples: the bottom is the running deepest settled point since
   *  the last anchor, confirmed by the first sample (settled or provisional) that has
   *  come back from it by more than the reversal margin. A real stroke rebounds by
   *  hundreds of noise units in one frame, so the margin costs it nothing; a one-frame
   *  wobble on the way down comes back by less, and the descent simply carries on
   *  (the deepest point moves on with it). A held copy comes back by zero, so it is
   *  not a confirmation either. */
  const detectRunning = (last: Point, p2: Point): Anchor | null => {
    if (!deepest || !(p2.t > deepest.t)) return null;
    // The newest sample has no far neighbour to be a spike against yet: one that rose
    // from the last settled point faster than a hand can move confirms nothing until
    // it has settled (and been bridged if it was a spike). Vertical only: a lateral
    // jump (the tracker swapping hands for a frame, seen on the conducting fixtures)
    // says nothing about the bottom.
    if (Math.abs(p2.y - last.y) / (p2.t - last.t) > spikeCeiling()) return null;
    const margin = Math.max(Number.isFinite(jitter) ? o.reversalNoiseUnits * jitter : 0, o.reversalFraction * envelope);
    if (!(p2.y < deepest.y - margin)) return null;
    const p0 = beforeDeepest;
    const p1 = deepest;
    // The first point after the bottom is the far neighbour of the fit: the
    // confirming sample itself when it came straight back, else the settled point
    // between (a flat or slow turn).
    const after = afterDeepest ?? p2;
    // A reversal, whether or not it is a beat: whatever happens next is the next
    // stroke, so a hand coming up from where its history began cannot pin the
    // bottom at that first sample.
    deepest = beforeDeepest = afterDeepest = null;
    if (!p0) return null;
    if (p1.t - lastAnchorT < o.refractoryFraction * period) return null;
    const amplitude = p1.y - Math.min(strokeTop, p0.y);
    if (!passesAmplitude(amplitude)) return null;
    return emitTurn(p0, p1, after, amplitude);
  };

  /** Track the running deepest point over the settled stream. */
  const trackDeepest = (pt: Point, before: Point | undefined) => {
    if (!deepest || pt.y > deepest.y) {
      deepest = pt;
      beforeDeepest = before ?? null;
      afterDeepest = null;
    } else if (!afterDeepest) {
      afterDeepest = pt;
    }
  };

  return {
    push(s) {
      const prev = raw[raw.length - 1];
      if (prev && (s.t < prev.t || s.t - prev.t > o.maxGap)) clearHistory();
      raw.push(s);
      if (raw.length > 3) raw.shift();

      const pt = settle();
      if (pt) {
        if (pt.y < strokeTop) strokeTop = pt.y;
        trackDeepest(pt, settled[settled.length - 1]);
        settled.push(pt);
        if (settled.length > 3) settled.shift();
      }

      // The window: [p0, p1, p2], p1 the candidate.
      let p0: Point | undefined;
      let p1: Point | undefined;
      let p2: Point | undefined;
      if (o.prefilter === 'median') {
        [p0, p1, p2] = settled;
      } else {
        p0 = settled[settled.length - 2];
        p1 = settled[settled.length - 1];
        if (p1) p2 = { t: s.t, x: s.x, y: sign * s.y, vy: s.t > p1.t ? (sign * s.y - p1.y) / (s.t - p1.t) : 0, bridged: false };
      }
      if (!p1 || !p2) return null;
      const dt = p2.t - p1.t;
      if (dt <= 0) return null;

      // The envelope decays with time whether or not anything fires, so a player who
      // starts beating smaller is re-normalised and can beat again (a stale envelope
      // would gate them out forever).
      decayEnvelope(p2.t);
      // Approach statistics on the newest transition: speed and the largest drop in
      // speed while moving down.
      const prevSpeed = () => Math.hypot(p0 ? (p1!.x - p0.x) / Math.max(1e-9, p1!.t - p0.t) : 0, p1!.vy);
      if (p2.vy > 0) {
        const vx = (p2.x - p1.x) / dt;
        const speed = Math.hypot(vx, p2.vy);
        speedSum += speed;
        speedCount++;
        if (p1.vy > 0) {
          const decel = (prevSpeed() - speed) / dt;
          if (decel > peakDecel) peakDecel = decel;
        }
      } else if (p1.vy > 0) {
        // The reversing frame: the speed drops to its minimum here.
        const decel = (prevSpeed() - Math.abs(p2.vy)) / dt;
        if (decel > peakDecel) peakDecel = decel;
      }

      if (o.mode === 'turning' && o.prefilter === 'spikes') return detectRunning(p1, p2);
      if (!p0) return null;
      return detectWindow(p0, p1, p2);
    },
    setPeriod(p) {
      if (Number.isFinite(p) && p > 0) period = p;
    },
    envelope: () => envelope,
    jitter: () => jitter,
    reset() {
      clearHistory();
      jitter = NaN;
      jitterN = 0;
      envelope = 0;
      envelopeT = NaN;
      lastAnchorT = -Infinity;
      lastAnchorX = NaN;
      period = o.initialPeriod;
    },
  };
}
