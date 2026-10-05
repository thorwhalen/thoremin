/**
 * Noise units (#163) — the trainer's answer to "what is a unit?"
 *
 * ## The problem
 *
 * The live feature vector is RAW catalog output: head pose in degrees, blendshapes in
 * 0..1, mesh ratios, frame positions in 0..1. Nothing in `src/enroll/` may know which
 * feature is which (that is the modality seam), so it cannot carry a table of units —
 * and yet every number it computes is a distance. With raw units a 1-degree head
 * jitter outweighs a full smile, a head cue never reads as "held", and the feature
 * ranking picks pose over expression fifty to one. Trainer v1 shipped like that; the
 * recorded-fixture tests did not catch it because they hand-scaled the vectors.
 *
 * ## The answer: measure everything in multiples of its own noise
 *
 * Every feature has an observable, unit-carrying quantity that needs no catalog: how
 * much it jitters between consecutive frames when nothing is happening. Divide a
 * feature's displacement by that and the result is unit-free — "this moved by eight
 * times its own noise" means the same thing for a blendshape and for an angle. So:
 *
 * - the still-point sampler judges "held" in noise units (a pose is held when no
 *   feature has moved more than a few sigma over the window);
 * - the model's distance weights are `1 / sigma`, so every clustering and
 *   classification distance is in noise-sigma;
 * - the feature ranking becomes a signal-to-noise ratio.
 *
 * One estimator per session, fed by EVERY frame of every cue, so all of those agree.
 *
 * ## Robustness, and the two floors
 *
 * The per-feature sigma is an exponentially-weighted mean of the absolute frame-to-
 * frame difference, with each update CLIPPED at a few times the current estimate — a
 * deliberate head turn produces differences twenty times the resting jitter, and an
 * unclipped average would inflate for seconds afterwards, making the next held pose
 * look like motion (or the reverse). A slow time constant does the rest.
 *
 * The clip needs something to clip against, so the first `warmupFrames` differences
 * are kept and their MEDIAN is the estimate: clipping from the very first difference
 * would trap a feature whose first frame happened to be quiet at a tiny estimate it
 * could only grow out of at a few percent per frame, and a plain mean would let two
 * frames of a head turn triple the seed. During the warm-up the estimate is still
 * whatever mostly happened first — a steady sweep would measure as "noise" and read as
 * held — so the sampler refuses to judge a feature until {@link NoiseEstimator.isWarm}.
 * A routine is data and need not start with a rest cue; this is what keeps that from
 * mattering.
 *
 * The clip and time constant are chosen together against one scenario: three seconds
 * of continuous motion (a player sweeping around looking for a face) must not leave
 * the estimate so inflated that the next deliberate move reads as held. Growth under
 * the clip compounds at `2 * alpha` per frame; at `clip: 2`, `tauMs: 10000` that is
 * ~1.8x over three seconds, and it decays back on the same time constant.
 *
 * Three floors keep the ratio finite and honest:
 *
 * - a feature that has been exactly constant so far (a blendshape the model pins at
 *   zero) has sigma 0; dividing by it would make its first twitch infinite. The floor
 *   is a small fraction of the feature's RUNNING RANGE over the session, so the unit
 *   is never smaller than 1% of everything the feature has done;
 * - a unit can never be finer than the RESOLUTION at which a feature changes: the
 *   smallest non-zero step ever seen. A channel the model has pinned (`noseSneer`,
 *   `cheekSquint` — whose whole session range is one rounding quantum of ~1e-5) would
 *   otherwise get the maximal SNR from the range floor, and a single quantum flip
 *   would read as a hundred sigma and veto "held" for the whole vector. With the step
 *   floor a flip is one sigma, which is what it is;
 * - a feature that never varies at all (range 0, sigma 0) gets weight 0 in the model:
 *   it carries no information, and no unit can be defined for it.
 *
 * The range floor is also what bounds a feature's signal-to-noise ratio (a feature
 * cannot be more than `1/rangeFloor` sigma wide), so one unusually clean channel
 * cannot dominate every distance.
 */
import type { FeatureVector, FeatureWeights } from './types';

export interface NoiseOptions {
  /** Time constant of the jitter estimate, in ms. Slow on purpose (see above). */
  tauMs?: number;
  /** An update larger than `clip` x the current estimate is clipped to it. */
  clip?: number;
  /** Floor on sigma, as a fraction of the feature's running range. */
  rangeFloor?: number;
  /** Frames of plain averaging before the clipped update takes over. */
  warmupFrames?: number;
  /**
   * A difference spanning a gap longer than this (ms) is not a frame-to-frame
   * difference at all — the feature was absent, or nothing was fed for a while — and
   * is skipped: the sample only re-anchors `last`. Folding it in would dent the
   * estimate (normalised by the gap it reads near zero) and take `tauMs` to recover.
   */
  maxGapMs?: number;
}

const DEFAULTS = { tauMs: 10000, clip: 2, rangeFloor: 0.01, warmupFrames: 30, maxGapMs: 500 };

/** A point-in-time, serializable snapshot of the estimator. */
export interface NoiseSnapshot {
  /** Per-feature jitter estimate (the raw sigma, before the floors). */
  sigma: Record<string, number>;
  /** Per-feature running range over everything seen. */
  range: Record<string, number>;
  /** Per-feature smallest non-zero per-frame step seen (the feature's resolution). */
  step: Record<string, number>;
  /** How many frames it was built from. */
  frames: number;
}

export interface NoiseEstimator {
  /** Fold one frame in. `tMs` must be non-decreasing. */
  push(vector: FeatureVector, tMs: number): void;
  /** The effective sigma for `id` — the jitter estimate floored by the range — or
   *  `NaN` when the feature has never been seen. */
  sigma(id: string): number;
  /**
   * Whether `id`'s estimate is past its warm-up — i.e. is a NOISE estimate rather than
   * a plain mean of whatever happened first. A never-seen feature is not warm.
   */
  isWarm(id: string): boolean;
  /** The features seen so far. */
  features(): string[];
  snapshot(): NoiseSnapshot;
  reset(): void;
}

interface Stat {
  last: number;
  lastT: number;
  sigma: number;
  /** Differences folded in so far (the warm-up counter). */
  n: number;
  /** The warm-up differences (kept only until warm; the estimate is their median). */
  warm: number[];
  lo: number;
  hi: number;
  /** Smallest non-zero per-frame step seen; Infinity until one is. */
  step: number;
}

/** Median of a small array (copied; the input is not reordered). */
function median(xs: readonly number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** `max(sigma, rangeFloor * range, step)` — the one rule, so the sampler and the weights
 *  agree. `step` is the feature's resolution (Infinity = not yet seen → ignored). */
export function effectiveSigma(sigma: number, range: number, rangeFloor: number, step = Infinity): number {
  return Math.max(sigma, rangeFloor * range, Number.isFinite(step) ? step : 0);
}

export function createNoiseEstimator(options: NoiseOptions = {}): NoiseEstimator {
  const o = { ...DEFAULTS, ...options };
  const stats = new Map<string, Stat>();
  let frames = 0;

  return {
    push(vector, tMs) {
      frames += 1;
      for (const id of Object.keys(vector)) {
        const x = vector[id];
        if (!Number.isFinite(x)) continue;
        const s = stats.get(id);
        if (!s) {
          stats.set(id, { last: x, lastT: tMs, sigma: 0, n: 0, warm: [], lo: x, hi: x, step: Infinity });
          continue;
        }
        if (x < s.lo) s.lo = x;
        if (x > s.hi) s.hi = x;
        const dt = tMs - s.lastT;
        if (dt > o.maxGapMs) {
          // Too long since this feature was last seen: re-anchor, do not measure.
          s.last = x;
          s.lastT = tMs;
          continue;
        }
        // Per-frame difference, normalised to a nominal 33 ms frame so a dropped frame
        // does not read as a burst of noise. Guard dt<=0 (duplicate stamp) as one frame.
        const perFrame = Math.abs(x - s.last) * (dt > 0 ? Math.min(3, 33 / dt) : 1);
        const rawStep = Math.abs(x - s.last);
        if (rawStep > 0 && rawStep < s.step) s.step = rawStep;
        s.last = x;
        s.lastT = tMs;
        s.n += 1;
        if (s.n <= o.warmupFrames) {
          s.warm.push(perFrame);
          s.sigma = median(s.warm);
          if (s.n === o.warmupFrames) s.warm = [];
          continue;
        }
        // Clip against the RAW estimate, not the range-floored one: the floor grows
        // with every move, and clipping against it would let a move inflate the
        // estimate almost unchecked (measured: 6x on a one-second turn).
        const d = s.sigma > 0 ? Math.min(perFrame, o.clip * s.sigma) : perFrame;
        const alpha = dt > 0 ? 1 - Math.exp(-dt / o.tauMs) : 0;
        s.sigma += alpha * (d - s.sigma);
      }
    },
    sigma(id) {
      const s = stats.get(id);
      if (!s) return NaN;
      return effectiveSigma(s.sigma, s.hi - s.lo, o.rangeFloor, s.step);
    },
    isWarm(id) {
      const s = stats.get(id);
      return !!s && s.n >= o.warmupFrames;
    },
    features: () => [...stats.keys()],
    snapshot() {
      const sigma: Record<string, number> = {};
      const range: Record<string, number> = {};
      const step: Record<string, number> = {};
      for (const [id, s] of stats) {
        sigma[id] = s.sigma;
        range[id] = s.hi - s.lo;
        step[id] = s.step;
      }
      return { sigma, range, step, frames };
    },
    reset() {
      stats.clear();
      frames = 0;
    },
  };
}

export interface ScaleOptions {
  /**
   * Floor on sigma as a fraction of range, for the WEIGHTS. Stricter than the
   * estimator's own floor on purpose: it caps any feature's signal-to-noise ratio at
   * `1/rangeFloor`, so one unusually clean channel cannot own every distance.
   */
  rangeFloor?: number;
}

const SCALE_DEFAULTS = { rangeFloor: 0.02 };

/**
 * Per-feature weights that turn a raw-unit distance into a noise-unit one:
 * `1 / max(sigma, rangeFloor * range)`. A feature that never varied (range 0 and
 * sigma 0) gets weight 0 — there is no unit for it, and it says nothing.
 */
export function scaleWeights(snapshot: NoiseSnapshot, options: ScaleOptions = {}): FeatureWeights {
  const o = { ...SCALE_DEFAULTS, ...options };
  const out: FeatureWeights = {};
  for (const id of Object.keys(snapshot.sigma)) {
    const s = effectiveSigma(snapshot.sigma[id], snapshot.range[id] ?? 0, o.rangeFloor, snapshot.step?.[id]);
    out[id] = s > 0 ? 1 / s : 0;
  }
  return out;
}

/** `vector` re-expressed in noise units (for a profile over scaled frames). */
export function applyWeights(vector: FeatureVector, weights: FeatureWeights): FeatureVector {
  const out: FeatureVector = {};
  for (const id of Object.keys(vector)) {
    const w = weights[id];
    const x = vector[id];
    if (w === undefined || !Number.isFinite(x)) continue;
    out[id] = x * w;
  }
  return out;
}
