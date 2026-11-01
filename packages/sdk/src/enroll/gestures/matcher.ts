/**
 * The window matcher (#752, phase 2 of `docs/design/dynamic-gestures.md`): which named gesture,
 * if any, the player just made.
 *
 * ## The seam
 *
 * {@link WindowMatcher} is injected wherever a gesture is recognised, the way `RhythmPrior` and
 * `AnchorDetector` are injected in `ictus`: `push(frame)` per camera frame, `reset()`. Each push
 * answers two things. `fired` is the gesture recognised on this frame (an event, at most once
 * per repetition). `following` is the gesture being followed as it unfolds, with how far along
 * it is; a matcher that can only judge a whole repetition, like this one, always says `null`,
 * and the causal Gesture Variation Follower of phase 5 fills it without the seam changing.
 *
 * ## Rung 1: the motion segmenter, then DTW against the templates
 *
 * {@link createDtwMatcher} cuts the live stream with the same motion segmenter that cut the
 * player's repetitions out of the take (`segmenter.ts`, the same noise units), and judges each
 * closed segment whole: per-segment, the design's first rung (section 7, question 1).
 *
 * A segment becomes a series (`series.ts`: the gesture's features, weighted, resampled, made
 * position and scale invariant) and is compared with every template by banded DTW (`dtw.ts`).
 * Its distance to a gesture is the distance to that gesture's nearest template. That distance
 * is judged against the gesture's own **radius**, the median distance from each of its
 * templates to the nearest other one: how far apart the player's own repetitions are, but
 * never under `minRadius` of the gesture's own size (repetitions closer than that are the same
 * motion, and a radius of almost nothing would refuse the player's next one for being a
 * little bigger, which moves where the segmenter starts it). A
 * segment is the gesture whose `distance / radius` is smallest, if that ratio is at most
 * `tolerance`; otherwise it is nothing the player taught (a stranger, refused). So a gesture
 * the player repeats precisely is matched precisely, and a loose one loosely, with one number.
 *
 * A gesture needs `minTraces` repetitions to have a radius at all (one trace is no agreement,
 * the design's section 4); with fewer it is left out of the model and listed in `skipped`.
 *
 * The **variation** of a fire is what the invariances took away: `speed` is the templates'
 * median duration over the segment's (2 = twice as fast), `scale` the segment's amplitude over
 * the templates' median (2 = twice as big). An expressive channel for a binding, for free.
 *
 * The model is derived from the traces, never stored (samples are the source of truth: the
 * design's section 3), so {@link buildGestureModel} is pure and cheap to re-run.
 */
import type { NoiseEstimator } from '../noise';
import type { FeatureVector, FeatureWeights, Trace, TraceSample } from '../types';
import { dtwDistance } from './dtw';
import { createMotionSegmenter, type SegmenterOptions } from './segmenter';
import { toSeries, type Series, type SeriesOptions } from './series';

/** How a recognised repetition differed from the templates: what the invariances took away. */
export interface Variation {
  /** The templates' median duration over this one's: above 1 is faster. */
  speed: number;
  /** This one's amplitude over the templates' median: above 1 is bigger. */
  scale: number;
}

/** A recognised repetition. */
export interface GestureFire {
  gesture: string;
  /** The stamp of the frame it was recognised on. */
  t: number;
  /** 1 on a template, 0 at the edge of what is accepted. */
  confidence: number;
  /** DTW distance to the nearest template, in series units. */
  distance: number;
  variation: Variation;
}

/** A gesture being followed as it unfolds (a causal matcher's; rung 1 never follows). */
export interface Following {
  gesture: string;
  /** 0 at its start, 1 at its end. */
  progress: number;
  confidence: number;
}

/** What one frame says. */
export interface MatchReading {
  fired: GestureFire | null;
  following: Following | null;
}

/** The seam: one frame in, a reading out. No clock of its own: `tMs` is the caller's. */
export interface WindowMatcher {
  push(vector: FeatureVector, tMs: number): MatchReading;
  reset(): void;
}

/** The defaults, with where each comes from. Provisional until the real-take set of #754. */
export const MATCHER_DEFAULTS = {
  /** Rows a series is resampled to: a 1.5 s repetition at 30 fps is 45 frames, so 32 keeps its
   *  shape and keeps DTW at about a thousand cells per template. */
  length: 32,
  /** Sakoe-Chiba half-width, a fraction of the length: the common 10-20 % for gestures, at the
   *  top, because a player's repetitions vary in pacing within the repetition. */
  band: 0.2,
  /** Accept up to twice the gesture's own radius: the median repetition sits at 1. */
  tolerance: 2,
  /** The radius's floor, as a fraction of the gesture's amplitude: repetitions that differ by
   *  under a tenth of their own size are the same motion. On the synthetic goldens the
   *  player's own repetitions sit within 0.07 and the nearest other gesture beyond 0.26, so
   *  with `tolerance` the cut falls at 0.2, between the two. */
  minRadius: 0.1,
  /** One trace is no agreement (design section 4). */
  minTraces: 2,
  /** A gesture is the same made anywhere in the frame... */
  position: true,
  /** ...and at any size (the size is reported as the variation instead). */
  scale: true,
  /** No extra hold-off: the segmenter already spaces two segments by its closing quiet. */
  refractoryMs: 0,
} as const;

export interface GestureModelOptions {
  /** The features a gesture is matched on (a wave is the wrist's path, not the mouth). */
  features: readonly string[];
  /** Per-feature multipliers: `scaleWeights` of the session's noise estimate when there is
   *  one. Default: each feature over its spread across all the traces. */
  weights?: Readonly<FeatureWeights>;
  length?: number;
  band?: number;
  position?: boolean;
  scale?: boolean;
  minRadius?: number;
  minTraces?: number;
}

/** One gesture's templates and what they agree on. */
export interface GestureTemplates {
  gesture: string;
  templates: Series[];
  /** Median distance from a template to its nearest sibling, floored by `minRadius`. */
  radius: number;
  durationMs: number;
  amplitude: number;
}

/** What {@link buildGestureModel} derives from the traces. */
export interface GestureModel {
  gestures: GestureTemplates[];
  /** Gestures left out for having fewer than `minTraces` repetitions. */
  skipped: string[];
  series: SeriesOptions;
  band: number;
}

/** The result of judging one segment. */
export interface SegmentMatch {
  /** The accepted gesture, or null for a stranger. */
  gesture: string | null;
  /** The nearest gesture, accepted or not (null when the model is empty). */
  nearest: string | null;
  distance: number;
  /** `distance / radius` of the nearest gesture. */
  ratio: number;
  confidence: number;
  variation: Variation;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Each feature over its standard deviation across every sample of every trace (0 if flat). */
function spreadWeights(traces: readonly Trace[], features: readonly string[]): FeatureWeights {
  const out: FeatureWeights = {};
  for (const id of features) {
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (const tr of traces) {
      for (const s of tr.samples) {
        const x = s.vector[id];
        if (x === undefined || !Number.isFinite(x)) continue;
        sum += x;
        sq += x * x;
        n += 1;
      }
    }
    const variance = n > 1 ? sq / n - (sum / n) ** 2 : 0;
    out[id] = variance > 0 ? 1 / Math.sqrt(variance) : 0;
  }
  return out;
}

/** Group traces by gesture, in first-seen order. */
function byGesture(traces: readonly Trace[]): Map<string, Trace[]> {
  const out = new Map<string, Trace[]>();
  for (const tr of traces) {
    const list = out.get(tr.gesture);
    if (list) list.push(tr);
    else out.set(tr.gesture, [tr]);
  }
  return out;
}

/** The model the matcher reads, derived from the player's traces (see the module header). */
export function buildGestureModel(traces: readonly Trace[], options: GestureModelOptions): GestureModel {
  const o = { ...MATCHER_DEFAULTS, ...options };
  const series: SeriesOptions = {
    features: o.features,
    weights: o.weights ?? spreadWeights(traces, o.features),
    length: o.length,
    position: o.position,
    scale: o.scale,
  };
  const gestures: GestureTemplates[] = [];
  const skipped: string[] = [];
  for (const [gesture, list] of byGesture(traces)) {
    const templates = list.map((tr) => toSeries(tr.samples, series)).filter((s) => s.rows.length > 0);
    if (templates.length < o.minTraces) {
      skipped.push(gesture);
      continue;
    }
    const nearestSibling = templates.map((a, i) =>
      Math.min(...templates.filter((_, j) => j !== i).map((b) => dtwDistance(a.rows, b.rows, { band: o.band }))),
    );
    const amplitude = median(templates.map((s) => s.amplitude));
    // In series units: the amplitude is 1 once scaled, its weighted value otherwise.
    const floor = o.minRadius * (o.scale ? 1 : amplitude);
    gestures.push({
      gesture,
      templates,
      radius: Math.max(median(nearestSibling), floor),
      durationMs: median(templates.map((s) => s.durationMs)),
      amplitude,
    });
  }
  return { gestures, skipped, series, band: o.band };
}

/** Judge one segment against the model (see the module header). */
export function matchSegment(
  model: GestureModel,
  samples: readonly TraceSample[],
  { tolerance = MATCHER_DEFAULTS.tolerance }: { tolerance?: number } = {},
): SegmentMatch {
  const seg = toSeries(samples, model.series);
  let best: { g: GestureTemplates; distance: number; ratio: number } | null = null;
  if (seg.rows.length > 0) {
    for (const g of model.gestures) {
      const distance = Math.min(...g.templates.map((t) => dtwDistance(seg.rows, t.rows, { band: model.band })));
      const ratio = g.radius > 0 ? distance / g.radius : distance === 0 ? 0 : Infinity;
      if (!best || ratio < best.ratio) best = { g, distance, ratio };
    }
  }
  if (!best) return { gesture: null, nearest: null, distance: Infinity, ratio: Infinity, confidence: 0, variation: { speed: NaN, scale: NaN } };
  const accepted = best.ratio <= tolerance;
  return {
    gesture: accepted ? best.g.gesture : null,
    nearest: best.g.gesture,
    distance: best.distance,
    ratio: best.ratio,
    confidence: accepted ? 1 - best.ratio / tolerance : 0,
    variation: {
      speed: seg.durationMs > 0 ? best.g.durationMs / seg.durationMs : NaN,
      scale: best.g.amplitude > 0 ? seg.amplitude / best.g.amplitude : NaN,
    },
  };
}

/** The segmenter's thresholds a matcher may override. */
export type SegmentationOptions = Pick<SegmenterOptions, 'startSigma' | 'stopSigma' | 'quietMs' | 'minTraceMs' | 'maxTraceMs'>;

export interface DtwMatcherOptions {
  model: GestureModel;
  /** The noise units the live stream is segmented in; the caller feeds it with frames that
   *  are not a gesture (`inRun()` says which), as the session does during a take. */
  noise: NoiseEstimator;
  tolerance?: number;
  /** After a fire, no other fire for this long, in ms. */
  refractoryMs?: number;
  segmentation?: SegmentationOptions;
}

/** A rung-1 {@link WindowMatcher}, plus the segmenter's `inRun` for the caller's noise feed. */
export interface DtwMatcher extends WindowMatcher {
  /** True while a segment is open: its frames are a gesture's, not noise. */
  inRun(): boolean;
}

const NOTHING: MatchReading = Object.freeze({ fired: null, following: null });

/** Build the rung-1 matcher: the motion segmenter, then {@link matchSegment} per segment. */
export function createDtwMatcher(options: DtwMatcherOptions): DtwMatcher {
  const tolerance = options.tolerance ?? MATCHER_DEFAULTS.tolerance;
  const refractoryMs = options.refractoryMs ?? MATCHER_DEFAULTS.refractoryMs;
  const segmenter = createMotionSegmenter({
    ...options.segmentation,
    gesture: '',
    cue: 'live',
    noise: options.noise,
    features: options.model.series.features,
    retain: false,
  });
  let lastFire = -Infinity;

  return {
    push(vector, tMs) {
      const segment = segmenter.push(vector, tMs);
      if (!segment || tMs - lastFire < refractoryMs) return NOTHING;
      const m = matchSegment(options.model, segment.samples, { tolerance });
      if (m.gesture === null) return NOTHING;
      lastFire = tMs;
      return { fired: { gesture: m.gesture, t: tMs, confidence: m.confidence, distance: m.distance, variation: m.variation }, following: null };
    },
    reset() {
      segmenter.reset();
      lastFire = -Infinity;
    },
    inRun: () => segmenter.inRun(),
  };
}
