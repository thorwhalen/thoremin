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
 * - `turning` (default): the bottom of the stroke — a local maximum of the (median
 *   filtered) vertical position — with the anchor time refined below the frame period
 *   by a parabolic fit through the three position samples around it, and the peak
 *   deceleration of the approach measured as the articulation signal.
 * - `zeroCrossing`: conga's bounce detector — the vertical-velocity sign change,
 *   interpolated linearly. Kept for comparison on the fixtures.
 *
 * Both fire ONE frame after the turning point (the sample on the far side is what
 * confirms it), which is the irreducible latency of a causal extremum detector; the
 * oscillator downstream is what predicts ahead of it.
 *
 * Landmark streams are not clean: MediaPipe emits single-frame spikes and short
 * dropouts, and a detector that trusts every sample fires on the spikes and loses the
 * stroke across the gaps. So the input is median-of-three filtered (one frame of extra
 * latency, and every one-frame spike is gone), and the stroke's top is the running
 * highest point since the last anchor rather than a state a glitch can reset.
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
  /** Median-of-three prefilter on the position (one frame of latency; kills one-frame
   *  landmark spikes). Off for synthetic, already-clean input if latency matters. */
  medianFilter?: boolean;
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
   *  median of its neighbours (the same convention as `src/enroll/noise.ts`). This is
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
}

const DEFAULTS: Required<DetectorOptions> = {
  mode: 'turning',
  yDown: true,
  mirrorX: false,
  medianFilter: true,
  refractoryFraction: 0.25,
  initialPeriod: 0.6,
  minAmplitudeFraction: 0.2,
  minAmplitude: 0,
  minAmplitudeNoiseUnits: 20,
  envelopeDecayPerSecond: 0.9,
  maxGap: 0.5,
};

interface Point {
  t: number;
  x: number;
  /** Vertical position with DOWN positive (so the ictus is a maximum). */
  y: number;
  /** Vertical velocity, down positive, backward difference. */
  vy: number;
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

export interface IctusDetector {
  /** Feed one sample. Returns an anchor when a beat candidate was confirmed by this
   *  sample, else null. Samples must arrive in time order. */
  push(sample: Sample): Anchor | null;
  /** Tell the detector the current period estimate (seconds) so the refractory window
   *  tracks the tempo. The oscillator calls this back. */
  setPeriod(period: number): void;
  /** The current amplitude envelope (caller's units) — for display and tests. */
  envelope(): number;
  reset(): void;
}

export function createIctusDetector(options: DetectorOptions = {}): IctusDetector {
  const o = { ...DEFAULTS, ...options };
  const sign = o.yDown ? 1 : -1;
  const xSign = o.mirrorX ? -1 : 1;

  // Raw samples for the median prefilter (the last three), then a three-deep window of
  // filtered points [p0, p1, p2]; a turning point at p1 is confirmed when p2 arrives.
  const raw: Sample[] = [];
  let p0: Point | null = null;
  let p1: Point | null = null;
  let p2: Point | null = null;
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
    p0 = p1 = p2 = null;
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

  const emit = (t: number, x: number, amplitude: number): Anchor => {
    decayEnvelope(t);
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

  return {
    push(s) {
      const prev = raw[raw.length - 1];
      if (prev && (s.t < prev.t || s.t - prev.t > o.maxGap)) clearHistory();
      raw.push(s);
      if (raw.length > 3) raw.shift();

      // The filtered point: the median of the last three samples, stamped at the middle
      // sample's time (one frame of latency); or the sample itself when unfiltered.
      let fp: { t: number; x: number; y: number };
      if (o.medianFilter) {
        if (raw.length < 3) return null;
        const [a, b, c] = raw;
        const my = sign * median3(sign * a.y, sign * b.y, sign * c.y);
        fp = { t: b.t, x: median3(a.x, b.x, c.x), y: my };
        // The residual of the middle sample against the median of its neighbours is the
        // frame-to-frame jitter, whether the hand is still or sweeping smoothly.
        const resid = Math.abs(sign * b.y - my);
        jitterN++;
        jitter = jitterN === 1 ? resid : jitter + Math.max(1 / jitterN, 0.02) * (resid - jitter);
      } else {
        fp = { t: s.t, x: s.x, y: sign * s.y };
      }

      const prevPt = p2;
      const dt = prevPt ? fp.t - prevPt.t : 0;
      const vy = prevPt && dt > 0 ? (fp.y - prevPt.y) / dt : 0;
      const pt: Point = { t: fp.t, x: fp.x, y: fp.y, vy };
      p0 = p1;
      p1 = p2;
      p2 = pt;
      if (!prevPt || dt <= 0) return null;

      // The stroke's top is the highest point since the last anchor.
      if (pt.y < strokeTop) strokeTop = pt.y;
      // Approach statistics: speed and the largest drop in speed while moving down.
      if (pt.vy > 0) {
        const vx = (pt.x - prevPt.x) / dt;
        const speed = Math.hypot(vx, pt.vy);
        speedSum += speed;
        speedCount++;
        if (prevPt.vy > 0) {
          const prevSpeed = Math.hypot(p0 ? (prevPt.x - p0.x) / Math.max(1e-9, prevPt.t - p0.t) : 0, prevPt.vy);
          const decel = (prevSpeed - speed) / dt;
          if (decel > peakDecel) peakDecel = decel;
        }
      } else if (prevPt.vy > 0) {
        // The reversing frame: the speed drops to its minimum here.
        const prevSpeed = Math.hypot(p0 ? (prevPt.x - p0.x) / Math.max(1e-9, prevPt.t - p0.t) : 0, prevPt.vy);
        const decel = (prevSpeed - Math.abs(pt.vy)) / dt;
        if (decel > peakDecel) peakDecel = decel;
      }

      if (!p0 || !p1) return null;

      // Refractory: no anchor until a fraction of the period has passed.
      if (p1.t - lastAnchorT < o.refractoryFraction * period) return null;

      if (o.mode === 'zeroCrossing') {
        // Down at p1, not down at p2: the crossing lies between them.
        if (!(p1.vy > 0 && p2.vy <= 0)) return null;
        const amplitude = p1.y - strokeTop;
        if (!passesAmplitude(amplitude)) return null;
        const frac = p1.vy / (p1.vy - p2.vy);
        return emit(p1.t + frac * (p2.t - p1.t), p1.x + frac * (p2.x - p1.x), amplitude);
      }

      // `turning`: p1 is a local maximum of the down-positive position, i.e. the bottom
      // of the stroke, approached from above.
      const isBottom = p1.y >= p0.y && p1.y >= p2.y && (p1.y > p0.y || p1.y > p2.y);
      if (!isBottom) return null;
      const amplitude = p1.y - Math.min(strokeTop, p0.y);
      if (!passesAmplitude(amplitude)) return null;
      const off = parabolicOffset(p0.y, p1.y, p2.y);
      const step = off >= 0 ? p2.t - p1.t : p1.t - p0.t;
      const x = p1.x + off * (off >= 0 ? p2.x - p1.x : p1.x - p0.x);
      return emit(p1.t + off * step, x, amplitude);
    },
    setPeriod(p) {
      if (Number.isFinite(p) && p > 0) period = p;
    },
    envelope: () => envelope,
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
