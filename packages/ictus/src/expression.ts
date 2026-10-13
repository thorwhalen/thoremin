/**
 * Expression from the body (#378, body-movement A6): dynamics and articulation from more
 * than the strokes, each channel relative to the player's own recent range.
 *
 * Why a blend. A conductor's stroke size (`dynamics.ts`, the anchors' excursion over the
 * recent envelope) is the universal loudness cue, but a body says loud with more than the
 * stroke: the whole body moves more (quantity of motion) and the arm reaches further (arm
 * extension). The design (§3.6 of the 2026-10-13 body-movement design) blends the three,
 * and makes the stroke the larger share because it is the one cue a conductor is taught.
 *
 * Why per player, over about 20 s. Loudness-from-movement models differ between people
 * (Sarasua and Guaus, conducting map §1.5), so no channel has an absolute scale here: each
 * is read against the distribution of its own last `windowS` seconds (`createRangeNormalizer`),
 * 0.5 at the player's median, toward 1 at the top of their recent range and toward 0 at the
 * bottom. A spread floor (`minRelSpread`, relative to the median) keeps a player who never
 * varies at 0.5 instead of magnifying their jitter into dynamics.
 *
 * Articulation reads the strokes' braking sharpness by default (`Anchor.sharpness`, as
 * `dynamics.ts` does for the hand), its log against the same 20 s window: `dynamics.ts`
 * re-centres its sharpness reference within about five strokes, so a phrase played legato
 * would read as the player's usual stroke before it ended. `flow` reads Laban flow instead: the beating wrist's mean jerk, normalised the same
 * way, low (smooth, free) toward legato, high (bound, abrupt) toward staccato. The e-baton
 * found acceleration alone misses slow fluid gestures and jerk fixes it (design ref [21]).
 *
 * Pure and causal: frames in, numbers out, no DAG or DOM. A missing channel (a wrist the
 * tracker lost, no body in frame) drops out of the blend rather than reading as zero.
 */
import { clamp01, quantileSorted } from '@thoremin/stats';
import type { DynamicsEstimate } from './dynamics';

export interface RangeNormalizerOptions {
  /** The window the player's range is read over, seconds. */
  windowS?: number;
  /** Values are averaged into bins of this many seconds before the window keeps them. */
  binS?: number;
  /** The quantiles that span the range (their distance is the spread). */
  lo?: number;
  hi?: number;
  /** The spread is at least this fraction of the median's magnitude, and at least
   *  `minSpread` (for a channel read in logs, whose median may be near 0). */
  minRelSpread?: number;
  minSpread?: number;
  /** Below this much history (seconds) the normaliser reads 0.5. */
  warmupS?: number;
}

export const RANGE_NORMALIZER_DEFAULTS: Required<RangeNormalizerOptions> = {
  windowS: 20,
  binS: 0.1,
  lo: 0.1,
  hi: 0.9,
  minRelSpread: 0.25,
  minSpread: 0,
  warmupS: 1,
};

export interface RangeNormalizer {
  /** Fold `x` in at time `t` (non-decreasing) and return it normalised, 0..1. */
  push(t: number, x: number): number;
  /** `x` normalised against the current window, 0..1 (0.5 before the warm-up). */
  normalize(x: number): number;
  reset(): void;
}

/** A value against its own recent distribution: 0.5 + (x - median) / spread, clamped. */
export function createRangeNormalizer(options: RangeNormalizerOptions = {}): RangeNormalizer {
  const o = { ...RANGE_NORMALIZER_DEFAULTS, ...options };
  let bins: { t: number; v: number }[] = [];
  let binStart = NaN;
  let binSum = 0;
  let binCount = 0;
  let median = NaN;
  let spread = NaN;
  const restat = () => {
    if (!bins.length || bins[bins.length - 1].t - bins[0].t < o.warmupS - o.binS / 2) {
      median = NaN;
      spread = NaN;
      return;
    }
    const sorted = bins.map((b) => b.v).sort((a, b) => a - b);
    median = quantileSorted(sorted, 0.5);
    spread = Math.max(quantileSorted(sorted, o.hi) - quantileSorted(sorted, o.lo), o.minRelSpread * Math.abs(median), o.minSpread, 1e-12);
  };
  const normalize = (x: number): number => {
    if (!Number.isFinite(median) || !Number.isFinite(x)) return 0.5;
    const n = 0.5 + (x - median) / spread;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  };
  return {
    push(t, x) {
      if (Number.isFinite(x)) {
        if (!Number.isFinite(binStart)) binStart = t;
        if (t - binStart >= o.binS && binCount > 0) {
          bins.push({ t: binStart, v: binSum / binCount });
          while (bins.length && bins[0].t < t - o.windowS) bins.shift();
          binStart = t;
          binSum = 0;
          binCount = 0;
          restat();
        }
        binSum += x;
        binCount++;
      }
      return normalize(x);
    },
    normalize,
    reset() {
      bins = [];
      binStart = NaN;
      binSum = 0;
      binCount = 0;
      median = NaN;
      spread = NaN;
    },
  };
}

/** What the body says about expression in one frame. Any field may be missing. */
export interface BodyExpressionFrame {
  t: number;
  /** Quantity of motion (torso lengths per second). */
  motion?: number;
  /** How far the beating arm reaches, 0 (folded) .. 1 (straight). */
  extension?: number;
  /** The beating wrist's jerk magnitude (torso lengths per second cubed). */
  jerk?: number;
}

/** Where articulation is read from: the stroke's braking sharpness, or Laban flow. */
export const ARTICULATION_SOURCES = ['sharpness', 'flow'] as const;
export type ArticulationSource = (typeof ARTICULATION_SOURCES)[number];

export interface ExpressionBlendOptions {
  /** The share of each cue in the dynamics (renormalised over the cues present). */
  weights?: { excursion?: number; motion?: number; extension?: number };
  /** Each channel is smoothed over this many seconds before it is normalised (about a
   *  stroke: a level, not the ripple inside a stroke). */
  smoothS?: number;
  /** The per-player range of every channel (`createRangeNormalizer`). */
  range?: RangeNormalizerOptions;
  articulation?: ArticulationSource;
}

export const EXPRESSION_BLEND_DEFAULTS = {
  weights: { excursion: 0.5, motion: 0.25, extension: 0.25 },
  smoothS: 0.75,
  articulation: 'sharpness' as ArticulationSource,
};

export interface ExpressionBlend {
  /** Fold one body frame in. */
  push(frame: BodyExpressionFrame): void;
  /** The blended estimate, given the strokes' own (`dynamics.ts`; null when no stroke
   *  source is followed, and the excursion drops out). */
  read(strokes: DynamicsEstimate | null): DynamicsEstimate;
  /** Fold one stroke in (its time and braking sharpness; NaN = unmeasurable, ignored). */
  pushStroke(stroke: { t: number; sharpness: number }): void;
  /** The normalised channels, for a readout (0.5 = the player's median, NaN = not seen). */
  channels(): { motion: number; extension: number; flow: number };
  setArticulation(source: ArticulationSource): void;
  reset(): void;
}

export function createExpressionBlend(options: ExpressionBlendOptions = {}): ExpressionBlend {
  const weights = { ...EXPRESSION_BLEND_DEFAULTS.weights, ...options.weights };
  const smoothS = options.smoothS ?? EXPRESSION_BLEND_DEFAULTS.smoothS;
  let articulation = options.articulation ?? EXPRESSION_BLEND_DEFAULTS.articulation;
  const names = ['motion', 'extension', 'jerk'] as const;
  type Name = (typeof names)[number];
  const norm = Object.fromEntries(names.map((n) => [n, createRangeNormalizer(options.range)])) as Record<Name, RangeNormalizer>;
  let smooth: Record<Name, { t: number; v: number } | null> = { motion: null, extension: null, jerk: null };
  let read: Record<Name, number> = { motion: NaN, extension: NaN, jerk: NaN };
  // Sharpness is a ratio: its log, with a spread of at least a doubling either side.
  const sharpNorm = createRangeNormalizer({ ...options.range, minSpread: Math.max(options.range?.minSpread ?? 0, 2 * Math.LN2) });
  let sharp = NaN;
  return {
    pushStroke({ t, sharpness }) {
      if (Number.isFinite(sharpness) && sharpness > 0) sharp = sharpNorm.push(t, Math.log(sharpness));
    },
    push(f) {
      for (const n of names) {
        const x = f[n];
        if (x === undefined || !Number.isFinite(x)) {
          // A channel unseen for longer than its smoothing drops out of the blend.
          const s = smooth[n];
          if (s && f.t - s.t > smoothS) {
            smooth[n] = null;
            read[n] = NaN;
          }
          continue;
        }
        const s = smooth[n];
        const v = s ? s.v + (1 - Math.exp(-Math.max(0, f.t - s.t) / smoothS)) * (x - s.v) : x;
        smooth[n] = { t: f.t, v };
        read[n] = norm[n].push(f.t, v);
      }
    },
    read(strokes) {
      let num = 0;
      let den = 0;
      const add = (w: number, v: number) => {
        if (w > 0 && Number.isFinite(v)) {
          num += w * v;
          den += w;
        }
      };
      if (strokes) add(weights.excursion, strokes.dynamics);
      add(weights.motion, read.motion);
      add(weights.extension, read.extension);
      const dynamics = den > 0 ? num / den : (strokes?.dynamics ?? 0.5);
      const art = articulation === 'flow' ? read.jerk : Number.isFinite(sharp) ? sharp : (strokes?.articulation ?? NaN);
      return { dynamics: clamp01(dynamics), articulation: Number.isFinite(art) ? clamp01(art) : (strokes?.articulation ?? 0.5) };
    },
    channels: () => ({ motion: read.motion, extension: read.extension, flow: read.jerk }),
    setArticulation(source) {
      articulation = source;
    },
    reset() {
      for (const n of names) norm[n].reset();
      sharpNorm.reset();
      sharp = NaN;
      smooth = { motion: null, extension: null, jerk: null };
      read = { motion: NaN, extension: NaN, jerk: NaN };
    },
  };
}
