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
 * The measurement itself is `motion.ts`'s (#751), shared with the motion segmenter that
 * keeps what this sampler throws away, so "held" here and "not moving" there are one test.
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
import { createWindowMotion, meanAbsDistance, MOTION_DEFAULTS, noiseDistance } from './motion';
import type { NoiseEstimator } from './noise';
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
   * The last point taken before this sampler began, when it continues a capture (a carve
   * resumed after a pause, #385 E2): a held pose closer to it than `minSeparation` is the
   * same pose again and is not taken, exactly as within one sampler.
   */
  lastEmitted?: FeatureVector;
  /**
   * The noise estimator to judge against. Pass the session's so that "held", the
   * separation test and the model's distances all use ONE set of units; omitted, the
   * sampler keeps a private one (fine for a standalone use, but then it only learns
   * the noise of the frames it is itself given).
   */
  noise?: NoiseEstimator;
}

/** The held threshold, dwell and window are the meter's (`MOTION_DEFAULTS`, where the
 *  `stillSigma` calibration is written down), so a gesture's "not moving" is this "held". */
const DEFAULTS = {
  metric: 'noise-relative' as const,
  stillSigma: MOTION_DEFAULTS.stillSigma,
  speedThreshold: 0.35,
  dwellMs: MOTION_DEFAULTS.dwellMs,
  speedWindowMs: MOTION_DEFAULTS.speedWindowMs,
  cue: 'vocabulary',
  armed: true,
};

/** Per-metric default separation: 3 sigma, or 0.05 raw (the v1 value). */
const SEPARATION_DEFAULT = { 'noise-relative': 3, absolute: 0.05 };

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
  /** Whether a held pose would be emitted: false once a point is emitted (or at a disarmed
   *  start) until the vector moves away. "Hold a new pose", for a hold indicator (#385 E2). */
  isArmed(): boolean;
}

/**
 * Build a still-point sampler. Stateful (it has to be — dwell is temporal) but
 * self-contained: no clock of its own, no globals, `tMs` is supplied by the caller so
 * tests drive it deterministically. The motion it judges "held" by is `motion.ts`'s.
 */
export function createStillPointSampler(options: SamplerOptions = {}): StillPointSampler {
  const o = { ...DEFAULTS, ...options };
  const minSeparation = options.minSeparation ?? SEPARATION_DEFAULT[o.metric];
  const meter = createWindowMotion({
    metric: o.metric,
    speedWindowMs: o.speedWindowMs,
    features: o.features,
    noise: o.noise,
    seed: o.seed,
  });
  const noise = meter.noise;
  const captured: StillPoint[] = [];

  /** When the current held run began, or null when moving. */
  let settlingSince: number | null = null;
  /** Running sum and count PER KEY for the dwell-window mean: a feature measurable on
   *  only part of the dwell (a second hand flickering in and out) must average over the
   *  frames it was present for, not be dragged toward zero by the ones it was not. */
  let acc: Record<string, number> = {};
  let accN: Record<string, number> = {};
  /** Set after an emit; cleared once the player moves again. */
  let armed = o.armed;
  let lastEmitted: FeatureVector | null = options.lastEmitted ?? null;
  let moved = false;

  const resetAccumulator = () => {
    acc = {};
    accN = {};
  };

  const attention = (v: FeatureVector): readonly string[] => o.features ?? Object.keys(v);
  const threshold = o.metric === 'absolute' ? o.speedThreshold : o.stillSigma;
  const separation = (a: FeatureVector, b: FeatureVector): number =>
    o.metric === 'absolute' ? meanAbsDistance(a, b) : noiseDistance(a, b, noise.sigma, attention(a));

  return {
    push(vector, tMs) {
      const v = meter.push(vector, tMs);
      if (v === 'cold') {
        // Still warming up: no dwell may begin, and nothing may be emitted.
        settlingSince = null;
        resetAccumulator();
        return null;
      }
      // Not enough history to judge yet — do not guess "held". (A gap re-anchors the
      // reference; the next frame is judged against it.)
      if (v === 'pending' || v === 'gap') return null;

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
      meter.reset();
      settlingSince = null;
      resetAccumulator();
      armed = o.armed;
      lastEmitted = options.lastEmitted ?? null;
      moved = false;
    },
    isSettling: () => settlingSince !== null,
    lastSpeed: () => meter.last(),
    hasMoved: () => moved,
    isArmed: () => armed,
  };
}
