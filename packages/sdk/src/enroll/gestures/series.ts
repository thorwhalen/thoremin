/**
 * A run of feature frames as a comparable series (#752): what the window matcher compares, and
 * what the trace quality of #753 will compare.
 *
 * A trace is a list of whole live vectors at the camera's uneven stamps. Before two of them can
 * be compared they are put on common ground, in this order:
 *
 * 1. **The chosen features, weighted.** Only the gesture's features, each multiplied by its
 *    weight (noise units when the weights are `scaleWeights` of the session's estimator), so a
 *    feature in degrees does not outweigh one in hand lengths.
 * 2. **Resampled in time** to a fixed number of rows, by linear interpolation at the frames'
 *    own stamps (a dropped frame is bridged, not shifted). The matcher's DTW then handles
 *    speed changes within a repetition; the resampling handles its overall length.
 * 3. **Position** (optional): each column minus its mean, so a wave made higher in the frame is
 *    the same wave.
 * 4. **Scale** (optional): the deviations from the column means divided by the series'
 *    amplitude (the RMS deviation from the column means, one number for all columns, so the
 *    shape's proportions are kept), so a big wave and a small one are the same wave. Only the
 *    deviations are scaled: with position off, each column's mean is kept as it was, as an
 *    offset (`row = mean + (x - mean) / amplitude`), so where the gesture is made still counts
 *    and its size does not. Dividing the raw values instead would scale the offset with the
 *    size, and a bigger wave would look like one made elsewhere. The amplitude is reported
 *    either way: it is the "how big" of the gesture's variation.
 *
 * A feature with no finite value anywhere in the run is a column of `NaN`, which the DTW
 * skips (`dtw.ts`).
 */
import type { FeatureWeights, TraceSample } from '../types';

export interface SeriesOptions {
  /** The features compared, in column order. */
  features: readonly string[];
  /** Per-feature multiplier; a feature missing here is left out (weight 0). */
  weights: Readonly<FeatureWeights>;
  /** Rows after resampling. */
  length: number;
  /** Subtract each column's mean (position invariance). */
  position: boolean;
  /** Divide the deviations from the column means by the amplitude (scale invariance). */
  scale: boolean;
}

export interface Series {
  rows: number[][];
  /** The run's duration, first to last stamp, in ms. */
  durationMs: number;
  /** How long the motion itself took, in ms ({@link motionSpanMs}): the speed's measure, which
   *  does not move with where the segmenter cut the run. */
  motionSpanMs: number;
  /** RMS deviation from the column means, in weighted units, before any scaling. */
  amplitude: number;
}

/** Linear interpolation of the finite points `(ts, xs)` at `t`, clamped at the ends. */
function interpolate(ts: readonly number[], xs: readonly number[], t: number): number {
  if (ts.length === 0) return NaN;
  if (t <= ts[0]) return xs[0];
  const last = ts.length - 1;
  if (t >= ts[last]) return xs[last];
  let k = 1;
  while (ts[k] < t) k++;
  const f = (t - ts[k - 1]) / (ts[k] - ts[k - 1]);
  return xs[k - 1] + f * (xs[k] - xs[k - 1]);
}

/** Mean of the finite values of `xs`; `NaN` when there is none. */
function finiteMean(xs: readonly number[]): number {
  let sum = 0;
  let n = 0;
  for (const x of xs) {
    if (!Number.isFinite(x)) continue;
    sum += x;
    n += 1;
  }
  return n === 0 ? NaN : sum / n;
}

/** `samples` as a {@link Series} (see the module header). Fewer than two samples: no rows. */
export function toSeries(samples: readonly TraceSample[], options: SeriesOptions): Series {
  const { features, weights, length, position, scale } = options;
  if (samples.length < 2 || length < 2) return { rows: [], durationMs: 0, motionSpanMs: 0, amplitude: 0 };
  const t0 = samples[0].t;
  const durationMs = samples[samples.length - 1].t - t0;
  const at = Array.from({ length }, (_, i) => t0 + (durationMs * i) / (length - 1));

  const columns = features.map((id) => {
    const w = weights[id] ?? 0;
    const ts: number[] = [];
    const xs: number[] = [];
    for (const s of samples) {
      const x = s.vector[id];
      if (w === 0 || x === undefined || !Number.isFinite(x)) continue;
      ts.push(s.t);
      xs.push(x * w);
    }
    return at.map((t) => interpolate(ts, xs, t));
  });

  const means = columns.map(finiteMean);
  let sq = 0;
  let n = 0;
  columns.forEach((col, k) => {
    for (const x of col) {
      if (!Number.isFinite(x)) continue;
      sq += (x - means[k]) ** 2;
      n += 1;
    }
  });
  const amplitude = n === 0 ? 0 : Math.sqrt(sq / n);
  const divisor = scale && amplitude > 0 ? amplitude : 1;

  const rows = at.map((_, i) => columns.map((col, k) => (position ? 0 : means[k]) + (col[i] - means[k]) / divisor));
  return { rows, durationMs, motionSpanMs: motionSpanMs(samples, options), amplitude };
}

/**
 * The share of a run's path that its motion span leaves out at each end (#909): the span runs from
 * where a tenth of the path has been travelled to where nine tenths have. The slow tails, which a
 * bigger or a smaller repetition pushes across the segmenter's threshold at different moments, hold
 * little path, so the span measures the motion and not the cut.
 */
export const MOTION_SPAN_TAIL = 0.1;

/**
 * How long the motion took, in ms: the time between the moments the cumulative path (the weighted
 * features' RMS step, frame to frame, at the frames' own stamps) reaches {@link MOTION_SPAN_TAIL} and
 * one minus it of its total. Scale-free (a bigger wave travels more path, in the same proportions)
 * and nearly free of the cut points. A step that misses a weighted feature adds no path (measured
 * over fewer features it would add a different amount). Tracker jitter adds a little path per
 * frame, so a take at another frame rate than its templates reads a few percent off (1.007-1.052
 * for a 60 fps wave against 30 fps templates). No path: 0.
 */
export function motionSpanMs(samples: readonly TraceSample[], { features, weights }: Pick<SeriesOptions, 'features' | 'weights'>, tail = MOTION_SPAN_TAIL): number {
  if (!(tail > 0 && tail < 0.5)) throw new Error(`motionSpanMs: tail must be between 0 and 0.5 (got ${tail})`);
  const weighted = features.filter((id) => (weights[id] ?? 0) !== 0);
  const cumulative: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    let sq = 0;
    let complete = weighted.length > 0;
    for (const id of weighted) {
      const a = samples[i - 1].vector[id];
      const b = samples[i].vector[id];
      if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) {
        complete = false;
        break;
      }
      sq += ((b - a) * weights[id]) ** 2;
    }
    cumulative.push(cumulative[i - 1] + (complete ? Math.sqrt(sq / weighted.length) : 0));
  }
  const total = cumulative[cumulative.length - 1];
  if (!(total > 0)) return 0;
  /** The stamp at which the cumulative path reaches `share` of the total, interpolated. */
  const when = (share: number): number => {
    const target = share * total;
    let k = 1;
    while (k < cumulative.length - 1 && cumulative[k] < target) k++;
    const span = cumulative[k] - cumulative[k - 1];
    const f = span > 0 ? (target - cumulative[k - 1]) / span : 0;
    return samples[k - 1].t + f * (samples[k].t - samples[k - 1].t);
  };
  return when(1 - tail) - when(tail);
}
