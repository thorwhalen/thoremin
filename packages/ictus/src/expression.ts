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

/** What a shaping hand that is not stroking says about loudness in one frame (#457). Any
 *  field may be missing (the hand unseen, no body to measure its height against). */
export interface HandGestureFrame {
  t: number;
  /** The hand's height: on the torso (0 at the hips, 1 at the shoulders) when the body is
   *  seen, else on the image (frame heights, up-positive). */
  height?: number;
  /** Which of the two the height is (each has its own range: they differ in scale). */
  heightOn?: 'torso' | 'image';
  /** How far the palm faces up: 1 up (rise), -1 down (hush), 0 toward the camera. */
  palmUp?: number;
}

export interface HandGestureOptions {
  /** The share of each cue in the dynamics (renormalised over the cues present). */
  weights?: { height?: number; palm?: number };
  /** Each raw channel is smoothed with this time constant (seconds) before it is read: a
   *  tracker's jitter is not a swell. */
  smoothS?: number;
  /** A channel not seen for this long (seconds) drops out of the reading. */
  holdS?: number;
  /** The per-player range of every channel (`createRangeNormalizer`), over seconds of
   *  MOVEMENT (see `minMove`). */
  range?: RangeNormalizerOptions;
  /** The smallest spread each channel's range is read with, in its own unit: a hand held
   *  still is not magnified into dynamics. */
  minSpread?: { torso?: number; image?: number; palm?: number };
  /** A channel is moving while its smoothed value has changed by at least this much over
   *  the last `moveWindowS`; only moving samples teach the range, so a posture held still
   *  (a hand raised and kept up through a long forte) keeps its reading instead of
   *  becoming the player's new middle. In each channel's unit. */
  minMove?: { torso?: number; image?: number; palm?: number };
  moveWindowS?: number;
}

export const HAND_GESTURE_DEFAULTS = {
  weights: { height: 0.6, palm: 0.4 },
  smoothS: 0.15,
  holdS: 1,
  /** A conductor's expressive hand travels about a torso, waist to above the shoulder, and
   *  the palm turns through its whole range: a still hand reads the middle, half of this
   *  above it reads full. Torso lengths; frame heights (a torso is about a third of the
   *  frame); the palm's unit (1 = facing the camera to facing up). */
  minSpread: { torso: 1, image: 0.3, palm: 1 },
  /** About five times a webcam wrist's smoothed jitter over half a second, and under the
   *  slowest deliberate swell (a torso over six seconds moves 0.075 in 0.5 s). */
  minMove: { torso: 0.05, image: 0.015, palm: 0.1 },
  moveWindowS: 0.5,
};

export interface HandGesture {
  /** Fold one frame in. */
  push(frame: HandGestureFrame): void;
  /** The dynamics the gesture says at `t`, 0..1, or NaN while no channel is fresh and
   *  taught (a channel that has not yet moved for the range's warm-up drops out). */
  read(t: number): number;
  /** Change the cues' shares (a live dial), keeping the player's ranges. */
  setWeights(w: { height?: number; palm?: number }): void;
  reset(): void;
}

/**
 * The conducting literature's expressive hand (#457; Kolesnik and Wanderley): loudness from
 * how high the hand is held and which way the palm faces (up to rise, down to hush), not
 * from strokes. Continuous, so a hand rising slowly is a crescendo with no stroke at all.
 * Each channel is read against the player's own range (`createRangeNormalizer`, the same
 * 20 s as the body's expression), so "high" is this player's high. The range is learned
 * from the hand's MOVEMENT only, on a clock that runs while it moves: a stroke-based
 * channel never sits still, a posture does, and a held posture must not drift back to
 * the middle. A channel that has not moved yet (a palm that never turns) says nothing.
 */
export function createHandGesture(options: HandGestureOptions = {}): HandGesture {
  let weights = { ...HAND_GESTURE_DEFAULTS.weights, ...options.weights };
  const smoothS = options.smoothS ?? HAND_GESTURE_DEFAULTS.smoothS;
  const holdS = options.holdS ?? HAND_GESTURE_DEFAULTS.holdS;
  const minSpread = { ...HAND_GESTURE_DEFAULTS.minSpread, ...options.minSpread };
  const minMove = { ...HAND_GESTURE_DEFAULTS.minMove, ...options.minMove };
  const moveWindowS = options.moveWindowS ?? HAND_GESTURE_DEFAULTS.moveWindowS;
  const warmupS = options.range?.warmupS ?? RANGE_NORMALIZER_DEFAULTS.warmupS;
  type Channel = 'torso' | 'image' | 'palm';
  const mk = (c: Channel) => createRangeNormalizer({ ...options.range, minSpread: Math.max(options.range?.minSpread ?? 0, minSpread[c]) });
  /** Per channel: the smoothed raw value and its time, the recent smoothed values (for
   *  the movement test), the movement clock, and the range. */
  type Track = { t: number; ew: number; recent: { t: number; ew: number }[]; moveT: number; norm: RangeNormalizer };
  let tracks: Partial<Record<Channel, Track>> = {};
  const fold = (c: Channel, t: number, x: number | undefined) => {
    if (x === undefined || !Number.isFinite(x)) return;
    let k = tracks[c];
    // Time that went backwards (a replay from the top) starts the channel afresh; a long
    // gap restarts its smoothing and its movement test, not the range it learned.
    if (k && t < k.t) k = undefined;
    if (!k) {
      tracks[c] = { t, ew: x, recent: [{ t, ew: x }], moveT: 0, norm: mk(c) };
      return;
    }
    const gap = t - k.t > holdS;
    const ew = gap ? x : k.ew + (1 - Math.exp(-(t - k.t) / Math.max(smoothS, 1e-6))) * (x - k.ew);
    if (gap) k.recent = [];
    k.recent.push({ t, ew });
    while (k.recent.length > 1 && k.recent[1].t <= t - moveWindowS) k.recent.shift();
    const moving = k.recent.length > 1 && k.recent[0].t <= t - moveWindowS + 1e-9 && Math.abs(ew - k.recent[0].ew) >= minMove[c];
    if (moving && !gap) {
      k.moveT += t - k.t;
      k.norm.push(k.moveT, ew);
    }
    k.t = t;
    k.ew = ew;
  };
  return {
    push(f) {
      fold(f.heightOn === 'image' ? 'image' : 'torso', f.t, f.height);
      fold('palm', f.t, f.palmUp);
    },
    read(t) {
      let num = 0;
      let den = 0;
      const live = (c: Channel) => {
        const k = tracks[c];
        return k && Math.abs(t - k.t) <= holdS && k.moveT >= warmupS ? k : undefined;
      };
      // The height on the torso when it is fresh, else on the image.
      const h = live('torso') ?? live('image');
      const p = live('palm');
      if (h && weights.height > 0) {
        num += weights.height * h.norm.normalize(h.ew);
        den += weights.height;
      }
      if (p && weights.palm > 0) {
        num += weights.palm * p.norm.normalize(p.ew);
        den += weights.palm;
      }
      return den > 0 ? clamp01(num / den) : NaN;
    },
    setWeights(w) {
      weights = { ...weights, ...w };
    },
    reset() {
      tracks = {};
    },
  };
}
