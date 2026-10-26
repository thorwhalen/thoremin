/**
 * How much the feature vector is moving, measured once for every consumer (#751).
 *
 * Two readers need the same number: the still-point sampler (`sampler.ts`), which keeps the
 * frames where nothing moves, and the motion segmenter (`gestures/segmenter.ts`), which keeps
 * the runs where something does. If they measured motion differently, "held" for one would not
 * be "not moving" for the other, and a frame could be both a pose and part of a gesture. So
 * the measurement lives here, and both read it.
 *
 * ## What is measured
 *
 * The displacement over a short WINDOW (`speedWindowMs`), not frame to frame: a feature
 * jittering by a hundredth per frame is physically still, yet reads as 1.2 units a second at
 * 60 fps and 2.4 at 120, so a frame-to-frame threshold tuned on one machine silently refuses
 * on a faster one. Against the sample one window ago, jitter cancels and the threshold means
 * the same thing everywhere.
 *
 * By default the displacement is in NOISE UNITS (#163): each feature's change divided by its
 * own jitter (`noise.ts`), RMS over the attended features. The live vector mixes degrees and
 * 0..1 blendshapes; one degree of head jitter outweighs a whole smile in raw units. The v1
 * rule (mean absolute change per second, for vectors already in uniform units) is kept as
 * `metric: 'absolute'`.
 *
 * ## The three answers
 *
 * A reading is a number, or why there is none: `'cold'` while an attended feature present in
 * the frame has no warm noise estimate (its unit is not known yet, so nothing can be judged),
 * and `'pending'` while there is no reference one window back (the first frame, a repeated
 * stamp, or a reference far older than the window, which is a gap and not a displacement).
 * The difference matters to a consumer: a cold frame breaks a run, a pending one does not.
 */
import { createNoiseEstimator, type NoiseEstimator } from './noise';
import type { FeatureVector } from './types';

/**
 * The defaults both consumers share, with where each number comes from.
 *
 * `stillSigma` is set from the recorded face clip, not from theory. Over a genuinely held
 * face the 100 ms displacement is NOT ~sqrt(3) per-frame jitters (MediaPipe's output wanders
 * at low frequency too) and measures p50 1.3, p75 3.3, p90 4, max ~5 sigma; a deliberate head
 * turn reads 8-12. Three would have flagged a quarter of held frames as motion; five sits in
 * the gap. `deliberateSigma` is the lower edge of that deliberate band.
 */
export const MOTION_DEFAULTS = {
  /** Window over which displacement is measured: long enough that per-frame jitter cancels,
   *  short enough to notice a real move promptly. */
  speedWindowMs: 100,
  /** At or below this many noise-sigma over the window, the vector is held. */
  stillSigma: 5,
  /** Above this many noise-sigma, the vector is moving on purpose. */
  deliberateSigma: 8,
  /** How long a state must last to count: a held pose's dwell, a gesture's closing quiet. */
  dwellMs: 220,
} as const;

/** Mean absolute difference per second between two vectors over `dtMs` (the v1 rule). */
function absoluteSpeed(a: FeatureVector, b: FeatureVector, dtMs: number): number {
  if (dtMs <= 0) return 0;
  const keys = Object.keys(a);
  if (keys.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    // A feature reports NaN for "not measurable this frame"; it must not poison the
    // speed estimate (NaN would compare false against the threshold forever and the
    // sampler would silently never emit).
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sum += Math.abs(x - y);
    n += 1;
  }
  if (n === 0) return 0;
  return (sum / n) / (dtMs / 1000);
}

/** Mean absolute distance between two vectors over their shared finite features. */
export function meanAbsDistance(a: FeatureVector, b: FeatureVector): number {
  let sum = 0;
  let n = 0;
  for (const k of Object.keys(a)) {
    const x = a[k];
    const y = b[k];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sum += Math.abs(x - y);
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * RMS over `features` of `(a - b) / sigma(feature)` — the distance between two
 * vectors in noise units. Features absent from either side, or with no usable sigma
 * yet, are skipped; with nothing comparable the distance is 0 ("cannot tell they
 * differ").
 */
export function noiseDistance(
  a: FeatureVector,
  b: FeatureVector,
  sigma: (id: string) => number,
  features: readonly string[],
): number {
  let sum = 0;
  let n = 0;
  for (const k of features) {
    const x = a[k];
    const y = b[k];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const s = sigma(k);
    if (!Number.isFinite(s)) continue;
    const d = s > 0 ? (x - y) / s : x === y ? 0 : Infinity;
    sum += d * d;
    n += 1;
  }
  if (n === 0) return 0;
  return Math.sqrt(sum / n);
}

/** A motion reading: the displacement, or why there is none (see the module header). */
export type MotionReading = number | 'cold' | 'pending';

export interface WindowMotionOptions {
  /** `'noise-relative'` (default): noise-sigma RMS over `features`. `'absolute'`: the v1
   *  rule, mean absolute change per second over every key. */
  metric?: 'noise-relative' | 'absolute';
  speedWindowMs?: number;
  /** The features the reading attends to. Default: every key of the frame. */
  features?: readonly string[];
  /** The estimator the noise units come from. Pass a session's so every distance shares one
   *  set of units; omitted, the meter keeps a private one and feeds it every frame. */
  noise?: NoiseEstimator;
  /** A frame from just before the first push, so the first window has a reference. A seed
   *  older than twice the window is discarded unjudged. */
  seed?: { v: FeatureVector; t: number };
}

export interface WindowMotion {
  /** Feed one frame (times non-decreasing) and read its motion. */
  push(vector: FeatureVector, tMs: number): MotionReading;
  /** The last numeric reading (0 after a reset). */
  last(): number;
  /** The frames the last reading spans, oldest first: the reference one window back, then
   *  every frame up to the latest. A copy. */
  span(): { v: FeatureVector; t: number }[];
  /** The estimator the readings are in units of (the injected one, or the private one). */
  readonly noise: NoiseEstimator;
  /** Back to the seed; a private estimator is reset too. */
  reset(): void;
}

/** Build a window-motion meter. No clock of its own: `tMs` comes from the caller. */
export function createWindowMotion(options: WindowMotionOptions = {}): WindowMotion {
  const metric = options.metric ?? 'noise-relative';
  const windowMs = options.speedWindowMs ?? MOTION_DEFAULTS.speedWindowMs;
  const noise = options.noise ?? createNoiseEstimator();
  const ownNoise = !options.noise;
  /** Recent frames, trimmed to just cover the window. */
  const history: { v: FeatureVector; t: number }[] = options.seed ? [options.seed] : [];
  let last = 0;

  const attention = (v: FeatureVector): readonly string[] => options.features ?? Object.keys(v);

  /** Noise-relative only: every attended feature PRESENT in this frame must have a warm
   *  noise estimate, or motion cannot be judged yet (see noise.ts). */
  const judgeable = (v: FeatureVector): boolean => {
    if (metric === 'absolute') return true;
    for (const k of attention(v)) if (Number.isFinite(v[k]) && !noise.isWarm(k)) return false;
    return true;
  };

  return {
    noise,
    push(vector, tMs) {
      // A private estimator learns only from what it is shown; a shared one is fed by its
      // owner and must not see every frame twice.
      if (ownNoise) noise.push(vector, tMs);
      // Still warming up. The history is kept (the seed, or the last judged frame): the
      // reference survives a cold stretch and is re-anchored by the trim on the next push.
      if (!judgeable(vector)) return 'cold';
      history.push({ v: vector, t: tMs });
      // Keep one sample older than the window, and drop the rest.
      while (history.length > 2 && tMs - history[1].t >= windowMs) history.shift();
      if (history.length < 2) return 'pending';
      const ref = history[0];
      const dt = tMs - ref.t;
      if (dt <= 0) return 'pending';
      // A reference far older than the window (a stale seed, a long cold stretch) is not a
      // window's displacement and must not be judged as one.
      if (history.length === 2 && dt > 2 * windowMs) {
        history.shift();
        return 'pending';
      }
      last = metric === 'absolute' ? absoluteSpeed(ref.v, vector, dt) : noiseDistance(vector, ref.v, noise.sigma, attention(vector));
      return last;
    },
    last: () => last,
    span: () => history.slice(),
    reset() {
      history.length = 0;
      if (options.seed) history.push(options.seed);
      last = 0;
      if (ownNoise) noise.reset();
    },
  };
}
