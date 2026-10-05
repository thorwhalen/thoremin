/**
 * The still-point sampler (#160) — the front of the trainer pipeline, and the piece
 * that keeps the whole thing honest.
 *
 * ## Why this exists at all
 *
 * The obvious design is to record every frame of the enrollment take and cluster them.
 * That design fails, for a reason that is not obvious until you look at the data: **a
 * stream of someone "moving their face around" is mostly transitions.** Most frames are
 * on the path between expressions, so clustering all of them finds the centre of the
 * motion envelope — a set of blurry averages nobody can reproduce on purpose — rather
 * than the poses the player actually held.
 *
 * The literature's answer is to segment first: split a stream into *dynamic* and
 * *static* segments using velocity derived from the signal, and keep the static ones.
 * This is that, online and allocation-free per frame.
 *
 * ## The rule
 *
 * A still-point is emitted when the feature vector has stayed "held" for `dwellMs`
 * continuously. The emitted vector is the **mean over the dwell window**, not the single
 * frame at the end of it — averaging a held pose is free noise reduction, and the
 * player was holding still by definition.
 *
 * **Displacement is measured over a short WINDOW (`speedWindowMs`), not frame to frame.**
 * This was a real bug before it was a design note. A frame-to-frame difference is
 * frame-rate dependent in the worst way: a feature jittering +/-0.01 per frame is
 * physically still, yet reads as 1.2 units/second at 60 fps and 2.4 at 120 fps — so a
 * threshold tuned on one machine refuses to emit anything on a faster one, silently.
 * Comparing against the sample ~`speedWindowMs` ago measures actual displacement, so
 * high-frequency jitter cancels and the threshold means the same thing everywhere.
 *
 * ## "Held" is judged in NOISE UNITS (#163)
 *
 * The v1 rule compared a mean absolute displacement against a fixed number, which
 * assumed every feature lived in 0..1. The live vector does not: head pose is in
 * degrees, and one degree of jitter outweighs a whole smile, so a head cue could never
 * read as held. The default metric now divides each feature's window displacement by
 * that feature's own jitter (see `noise.ts`) and takes the RMS over the features the
 * caller cares about: "held" means no feature has moved more than `stillSigma` times
 * its own noise. Unit-free, per-feature, and — because the estimator is shared across
 * the session — consistent with every distance the model later computes. The v1 rule is
 * kept as `metric: 'absolute'` for callers whose vectors are already uniform.
 *
 * After emitting, the sampler will not emit again until the vector has *moved away*
 * (exceeded the threshold) and settled somewhere new. Without that latch, holding a
 * pose for five seconds would emit fifty near-identical points and hand the clusterer a
 * dwell-time histogram instead of a vocabulary — the pose you happened to rest on
 * longest would dominate every cluster it touched.
 */
import { createNoiseEstimator, type NoiseEstimator } from './noise';
import type { FeatureVector, StillPoint } from './types';

export interface SamplerOptions {
  /**
   * How "held" is judged. `'noise-relative'` (default): each feature's window
   * displacement in multiples of its own jitter, RMS across `features`, held below
   * `stillSigma`. `'absolute'`: the v1 rule — mean absolute change per second across
   * all features, held below `speedThreshold` (assumes uniform ~0..1 units).
   */
  metric?: 'noise-relative' | 'absolute';
  /** `'noise-relative'`: the held threshold, in noise-sigma over the window. */
  stillSigma?: number;
  /**
   * `'absolute'`: mean absolute per-feature change per second below which the vector
   * counts as held, in the vector's own units.
   */
  speedThreshold?: number;
  /** How long the vector must stay held before a point is emitted. */
  dwellMs?: number;
  /** Window over which displacement is measured. Long enough that per-frame jitter
   *  cancels, short enough to notice a real move promptly. */
  speedWindowMs?: number;
  /** Which cue to stamp emitted points with. */
  cue?: string;
  /**
   * The features the held test and the separation test ATTEND to. Default: every
   * finite key of the vector. A cue that asks for a head movement should judge
   * stillness on the head, not on a twitching mouth.
   */
  features?: readonly string[];
  /**
   * `'noise-relative'`: minimum RMS noise-unit distance from the previously emitted
   * point before a new one may be emitted. `'absolute'`: the same in the vector's
   * units (mean absolute difference). A second guard against near-duplicates when the
   * player drifts slowly between two very similar poses without ever crossing the
   * held threshold.
   */
  minSeparation?: number;
  /**
   * Whether the sampler may emit BEFORE the player has moved. Default true, so a
   * standalone sampler fed a held pose reports it. A session starts each cue's sampler
   * DISARMED: the pose held while an instruction is being given is the previous one
   * (rest, or the last cue's answer), and a cue's first point must follow a movement —
   * otherwise "look right" would inherit the left turn the player is still holding.
   */
  armed?: boolean;
  /**
   * A reference frame from just BEFORE this sampler's first push (the last frame the
   * session saw), so the first window has something to compare against. A seed older
   * than twice the speed window is discarded unjudged: the held threshold was set for
   * 100 ms displacements, and ordinary slow wander over a second exceeds it.
   */
  seed?: { v: FeatureVector; t: number };
  /**
   * The noise estimator to judge against. Pass the session's so that "held", the
   * separation test and the model's distances all use ONE set of units; omitted, the
   * sampler keeps a private one (fine for a standalone use, but then it only learns
   * the noise of the frames it is itself given).
   */
  noise?: NoiseEstimator;
}

/**
 * `stillSigma` is set from the recorded face clip, not from theory. Over a genuinely
 * held face the 100 ms displacement is NOT ~sqrt(3) per-frame jitters — MediaPipe's
 * output wanders at low frequency too — and measures p50 1.3, p75 3.3, p90 4, max
 * ~5 sigma; a deliberate head turn reads 8-12. Three would have flagged a quarter of
 * held frames as motion; five sits in the gap.
 */
const DEFAULTS = {
  metric: 'noise-relative' as const,
  stillSigma: 5,
  speedThreshold: 0.35,
  dwellMs: 220,
  speedWindowMs: 100,
  cue: 'vocabulary',
  armed: true,
};

/** Per-metric default separation: 3 sigma, or 0.05 raw (the v1 value). */
const SEPARATION_DEFAULT = { 'noise-relative': 3, absolute: 0.05 };

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

export interface StillPointSampler {
  /** Feed one live frame. Returns a still-point on the tick one is completed. */
  push(vector: FeatureVector, tMs: number): StillPoint | null;
  /** Everything emitted so far. */
  points(): StillPoint[];
  /** Drop the captured points and reset the internal state. */
  reset(): void;
  /** True while the vector is currently held and accumulating a dwell. */
  isSettling(): boolean;
  /** The last computed motion measure (noise-sigma or units/s, per `metric`), for a meter. */
  lastSpeed(): number;
  /** True once the vector has exceeded the held threshold at least once since reset —
   *  i.e. the player has MOVED. Tells "never moved" apart from "moved, never held". */
  hasMoved(): boolean;
}

/**
 * Build a still-point sampler. Stateful (it has to be — dwell is temporal) but
 * self-contained: no clock of its own, no globals, `tMs` is supplied by the caller so
 * tests drive it deterministically.
 */
export function createStillPointSampler(options: SamplerOptions = {}): StillPointSampler {
  const o = { ...DEFAULTS, ...options };
  const minSeparation = options.minSeparation ?? SEPARATION_DEFAULT[o.metric];
  const noise = o.noise ?? createNoiseEstimator();
  const ownNoise = !o.noise;
  const captured: StillPoint[] = [];

  /** Recent frames, trimmed to just cover the speed window. */
  const history: { v: FeatureVector; t: number }[] = o.seed ? [o.seed] : [];
  /** When the current held run began, or null when moving. */
  let settlingSince: number | null = null;
  /** Running sum and count PER KEY for the dwell-window mean: a feature measurable on
   *  only part of the dwell (a second hand flickering in and out) must average over the
   *  frames it was present for, not be dragged toward zero by the ones it was not. */
  let acc: Record<string, number> = {};
  let accN: Record<string, number> = {};
  /** Set after an emit; cleared once the player moves again. */
  let armed = o.armed;
  let lastEmitted: FeatureVector | null = null;
  let lastSpeed = 0;
  let moved = false;

  const resetAccumulator = () => {
    acc = {};
    accN = {};
  };

  const attention = (v: FeatureVector): readonly string[] => o.features ?? Object.keys(v);

  /** Noise-relative only: every attention feature PRESENT in this frame must have a
   *  warm noise estimate, or "held" cannot be judged yet (see noise.ts). */
  const judgeable = (v: FeatureVector): boolean => {
    if (o.metric === 'absolute') return true;
    for (const k of attention(v)) if (Number.isFinite(v[k]) && !noise.isWarm(k)) return false;
    return true;
  };

  const motion = (ref: FeatureVector, now: FeatureVector, dt: number): number => {
    if (o.metric === 'absolute') return absoluteSpeed(ref, now, dt);
    return noiseDistance(now, ref, noise.sigma, attention(now));
  };
  const threshold = o.metric === 'absolute' ? o.speedThreshold : o.stillSigma;
  const separation = (a: FeatureVector, b: FeatureVector): number =>
    o.metric === 'absolute' ? meanAbsDistance(a, b) : noiseDistance(a, b, noise.sigma, attention(a));

  return {
    push(vector, tMs) {
      // A private estimator learns only from what it is shown; a shared one is fed by
      // the session and must not see every frame twice.
      if (ownNoise) noise.push(vector, tMs);
      if (!judgeable(vector)) {
        // Still warming up: no dwell may begin, and nothing may be emitted. The history
        // is kept (the seed, or the last judged frame): the reference survives a cold
        // stretch and is re-anchored by the window trim on the next judged push.
        settlingSince = null;
        resetAccumulator();
        return null;
      }
      history.push({ v: vector, t: tMs });
      // Keep one sample older than the window, and drop the rest.
      while (history.length > 2 && tMs - history[1].t >= o.speedWindowMs) history.shift();
      if (history.length < 2) return null;
      const ref = history[0];
      const dt = tMs - ref.t;
      // Not enough history to judge yet — do not guess "held".
      if (dt <= 0) return null;
      // A reference far older than the window (a stale seed, a long cold stretch) is
      // not a 100 ms displacement and must not be judged as one.
      if (history.length === 2 && dt > 2 * o.speedWindowMs) {
        history.shift();
        return null;
      }
      const v = motion(ref.v, vector, dt);
      lastSpeed = v;

      if (v > threshold) {
        // Moving: abandon any dwell in progress, and re-arm — the player has left the
        // pose they last gave us, so the next held pose is a genuinely new one.
        settlingSince = null;
        resetAccumulator();
        armed = true;
        moved = true;
        return null;
      }

      // Held this frame: accumulate toward the dwell mean.
      if (settlingSince === null) settlingSince = tMs;
      for (const k of Object.keys(vector)) {
        const x = vector[k];
        if (!Number.isFinite(x)) continue;
        acc[k] = (acc[k] ?? 0) + x;
        accN[k] = (accN[k] ?? 0) + 1;
      }

      if (!armed || tMs - settlingSince < o.dwellMs) return null;

      const mean: FeatureVector = {};
      for (const k of Object.keys(acc)) mean[k] = acc[k] / accN[k];

      if (lastEmitted && separation(mean, lastEmitted) < minSeparation) {
        // Too close to the last point to be a different pose. Stay disarmed rather than
        // emitting a near-duplicate; the player has to actually move somewhere new.
        armed = false;
        return null;
      }

      const point: StillPoint = { vector: mean, t: settlingSince, cue: o.cue };
      captured.push(point);
      lastEmitted = mean;
      armed = false;
      resetAccumulator();
      settlingSince = null;
      return point;
    },
    points: () => captured.slice(),
    reset() {
      captured.length = 0;
      history.length = 0;
      if (o.seed) history.push(o.seed);
      settlingSince = null;
      resetAccumulator();
      armed = o.armed;
      lastEmitted = null;
      lastSpeed = 0;
      moved = false;
      if (ownNoise) noise.reset();
    },
    isSettling: () => settlingSince !== null,
    lastSpeed: () => lastSpeed,
    hasMoved: () => moved,
  };
}
