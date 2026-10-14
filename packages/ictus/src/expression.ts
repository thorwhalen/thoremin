/**
 * Expression from the body (#378, body-movement A6): dynamics and articulation from more
 * than the strokes, each channel relative to the player's own recent range.
 *
 * Why a blend. A conductor's stroke size (the anchors' excursion) is the universal loudness cue, but a body says loud with more than the
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
 * The excursion is the stroke's own amplitude (`Anchor.amplitude`, torso lengths from the
 * body's impact detector) against the same 20 s window, per channel. `dynamics.ts` reads it
 * against a fast-decaying maximum instead, so a steady stroke reads near 1 there while the
 * other channels read a steady player at 0.5; blended, a change after a change was lost.
 * Where a detector reports no amplitude, `dynamics.ts`'s reading stands in.
 *
 * Per stroke. The body's channels are read once per stroke, as the mean of its frames
 * since the previous one, the way `dynamics.ts` reads the excursion: the loudness is the
 * stroke's, a still body between strokes or in a fermata changes nothing, and the ripple
 * inside a stroke averages out.
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
        // Time that went backwards (a replay from the top) starts a new bin there.
        if (!Number.isFinite(binStart) || t < binStart) {
          binStart = t;
          binSum = 0;
          binCount = 0;
        }
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
  /** A stroke's channels are the means of its frames since the previous stroke, but over
   *  no more than this many seconds (the first stroke after a pause is not averaged with
   *  the stillness before it). */
  maxSpanS?: number;
  /** The per-player range of every channel (`createRangeNormalizer`). */
  range?: RangeNormalizerOptions;
  articulation?: ArticulationSource;
}

export const EXPRESSION_BLEND_DEFAULTS = {
  weights: { excursion: 0.5, motion: 0.25, extension: 0.25 },
  maxSpanS: 1.5,
  articulation: 'sharpness' as ArticulationSource,
};

export interface ExpressionBlend {
  /** Fold one body frame in (read at the next stroke). */
  push(frame: BodyExpressionFrame): void;
  /** Close a stroke: its time, braking sharpness (NaN = unmeasurable) and, where the
   *  detector reports it, its excursion and channel (`Anchor.amplitude`). The body's
   *  channels are read per stroke, as `dynamics.ts` reads the excursion: between strokes,
   *  and through a hold or a fermata, nothing changes (a still body in a fermata is not a
   *  diminuendo). */
  pushStroke(stroke: { t: number; sharpness: number; amplitude?: number; channel?: string }): void;
  /** The blended estimate, given the strokes' own (`dynamics.ts`; null when no stroke
   *  source is followed, and the excursion drops out). */
  read(strokes: DynamicsEstimate | null): DynamicsEstimate;
  /** The normalised channels, for a readout (0.5 = the player's median, NaN = not seen). */
  channels(): { motion: number; extension: number; flow: number };
  setArticulation(source: ArticulationSource): void;
  reset(): void;
}

export function createExpressionBlend(options: ExpressionBlendOptions = {}): ExpressionBlend {
  const weights = { ...EXPRESSION_BLEND_DEFAULTS.weights, ...options.weights };
  const maxSpanS = options.maxSpanS ?? EXPRESSION_BLEND_DEFAULTS.maxSpanS;
  let articulation = options.articulation ?? EXPRESSION_BLEND_DEFAULTS.articulation;
  const names = ['motion', 'extension', 'jerk'] as const;
  type Name = (typeof names)[number];
  const norm = Object.fromEntries(names.map((n) => [n, createRangeNormalizer(options.range)])) as Record<Name, RangeNormalizer>;
  /** The frames since the last stroke (trimmed to `maxSpanS`). */
  let frames: BodyExpressionFrame[] = [];
  let read: Record<Name, number> = { motion: NaN, extension: NaN, jerk: NaN };
  // Sharpness is a ratio: its log, with a spread of at least a doubling either side.
  const sharpNorm = createRangeNormalizer({ ...options.range, minSpread: Math.max(options.range?.minSpread ?? 0, 2 * Math.LN2) });
  let sharp = NaN;
  // The stroke's excursion, a ratio too, per channel (a wrist travels several times as far
  // as a trunk, and the detector may follow either).
  const excNorm = new Map<string, RangeNormalizer>();
  let excursion = NaN;
  return {
    push(f) {
      frames.push(f);
      while (frames.length && frames[0].t < f.t - maxSpanS) frames.shift();
    },
    pushStroke({ t, sharpness, amplitude, channel }) {
      if (Number.isFinite(sharpness) && sharpness > 0) sharp = sharpNorm.push(t, Math.log(sharpness));
      if (amplitude !== undefined && Number.isFinite(amplitude) && amplitude > 0) {
        const key = channel ?? '';
        let n = excNorm.get(key);
        if (!n) excNorm.set(key, (n = createRangeNormalizer({ ...options.range, minSpread: Math.max(options.range?.minSpread ?? 0, Math.LN2) })));
        excursion = n.push(t, Math.log(amplitude));
      }
      for (const n of names) {
        let sum = 0;
        let count = 0;
        for (const f of frames) {
          const x = f[n];
          if (f.t >= t - maxSpanS && x !== undefined && Number.isFinite(x)) {
            sum += x;
            count++;
          }
        }
        // A channel unseen through the whole stroke drops out of the blend.
        read[n] = count ? norm[n].push(t, sum / count) : NaN;
      }
      frames = [];
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
      // The excursion: the strokes' own amplitude against the player's range when the
      // detector reports it, else `dynamics.ts`'s reading (against the recent envelope).
      add(weights.excursion, Number.isFinite(excursion) ? excursion : (strokes?.dynamics ?? NaN));
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
      excNorm.clear();
      excursion = NaN;
      frames = [];
      read = { motion: NaN, extension: NaN, jerk: NaN };
      sharp = NaN;
    },
  };
}
