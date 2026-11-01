/**
 * How good a player's dynamic gestures are (#753, phase 3 of `docs/design/dynamic-gestures.md`,
 * section 4): the numbers behind the Gestures chips in Sorting, the dynamic analogue of the held
 * categories' `quality.ts`, and in its vocabulary (grade, dots, nearest, `closeTo`, `thin`).
 *
 * A held category is judged by spread around a centre; a gesture has no centre, only repetitions
 * of a path, so it is judged by how alike its repetitions are and how unlike the others':
 *
 * - **Agreement**: each trace's mean DTW distance to its siblings, and the gesture's mean over
 *   its pairs; `relativeAgreement` puts it in units of the TYPICAL agreement across the player's
 *   gestures (their median), so "your five waves differ" means "differ more than your gestures
 *   usually do", not a number in feature units. Past {@link GESTURE_QUALITY_DEFAULTS.looseAgreement}
 *   the gesture is `loose`.
 * - **The odd trace** (leave-one-trace-out, the suspect hold's analogue): the repetition whose
 *   removal most improves the gesture's agreement. It is `flagged` when it is clearly worse: its
 *   mean distance to the others at least {@link GESTURE_QUALITY_DEFAULTS.oddRatio} times the
 *   agreement of the others among themselves. Needs three traces (with two, removing one leaves
 *   no agreement to compare).
 * - **Separation**: the median over a gesture's traces of the distance to the nearest trace of
 *   another gesture, against the gesture's own RADIUS (the matcher's: the median distance from a
 *   repetition to its nearest sibling, floored at a tenth of its size; `gestureRadius`). The
 *   matcher accepts a segment within `tolerance` radii (`MATCHER_DEFAULTS.tolerance`), so below
 *   that ratio the other gesture's repetitions fall inside what is accepted as this one: CLOSE.
 * - **Overlap with the held categories**: a trace that dwells inside a held category's reading,
 *   for at least the still-point sampler's dwell (`MOTION_DEFAULTS.dwellMs`), would also fire
 *   that category in play. The frames are read by the held model's own `classify` (its weighted
 *   distance in noise units, its reject radius and its taught Neutral), and the categories the
 *   trace starts and ends on (its first and last frames the model reads as a category) do not
 *   count: a gesture that starts and ends on a held pose (the resting open hand the wave starts
 *   from) is fine (design section 4), and a dwell back on the pose it started from is no entry
 *   (the category tracker holds through a rejected frame, so a flicker out and back is not one
 *   either; the everyday check skips the category its first reading is on for the same reason).
 * - **Thin**: one trace is no agreement, "needs another repetition", as one hold is.
 *
 * ## Comparable pairs
 *
 * `dtwDistance` compares two rows on the dimensions finite in BOTH, so a repetition that lost most
 * of its features (a hand half out of frame) is compared on what is left and can look close to
 * anything. A pair is therefore COMPARABLE only when the features both traces measured are at
 * least {@link GESTURE_QUALITY_DEFAULTS.minShared} of the gesture's own; a pair below it says
 * nothing and is left out of the agreement, the radius and the separation (counted in
 * `incomparable`). For two gestures, the fraction is taken over the features of the gesture being
 * judged. A trace with no comparable sibling has no agreement.
 *
 * Everything is measured in the matcher's own space (`resolveGestureOptions`: the gesture's
 * features in noise units, resampled, position and scale invariant by default), so a chip and the
 * matcher never disagree about what "alike" means. Pure and modality-free.
 */
import { median } from '@thoremin/stats';
import { classify } from '../classify';
import { MOTION_DEFAULTS } from '../motion';
import { gradeDots, QUALITY_DEFAULTS, type QualityGrade } from '../quality';
import type { FeatureVector, TrainedModel, Trace, TraceSample } from '../types';
import { dtwDistance } from './dtw';
import { gestureRadius, MATCHER_DEFAULTS, resolveGestureOptions, type GestureModelOptions } from './matcher';
import { toSeries } from './series';

export const GESTURE_QUALITY_DEFAULTS = {
  /**
   * The least share of the gesture's features both traces of a pair must have measured for the
   * pair to be compared at all. Half: below it the DTW reads what is LEFT of a repetition, so a
   * pair says more about what was lost than about the shape. Provisional, like the matcher's
   * numbers, until the real-take set of #754.
   */
  minShared: 0.5,
  /** Separation below this many radii is CLOSE: the matcher's own tolerance, inside which another
   *  gesture's repetition would be accepted as this one. */
  closeRatio: MATCHER_DEFAULTS.tolerance,
  /** Separation below this is only OK: the held categories' line (`QUALITY_DEFAULTS.okRatio`). */
  okRatio: QUALITY_DEFAULTS.okRatio,
  /** Agreement past this many times the typical one is `loose`: the matcher's tolerance again (a
   *  repetition twice as far as usual is at the edge of what it accepts). */
  looseAgreement: MATCHER_DEFAULTS.tolerance,
  /** The odd trace is flagged at this many times the others' agreement: past the matcher's
   *  tolerance, the matcher would refuse a repetition like it. */
  oddRatio: MATCHER_DEFAULTS.tolerance,
  /** Fewer traces than this: "needs another repetition" (the matcher's own minimum). */
  minTraces: MATCHER_DEFAULTS.minTraces,
  /** A trace inside a held category's reading for this long would fire it: the sampler's dwell. */
  dwellMs: MOTION_DEFAULTS.dwellMs,
} as const;

export type GestureQualityOptions = GestureModelOptions & {
    [K in Exclude<keyof typeof GESTURE_QUALITY_DEFAULTS, 'minTraces'>]?: number;
  } & {
    /** Each gesture's own features (the shared-coverage denominator), by gesture; default: every
     *  weighted feature of `features`. `gestureSpace(c).featuresOf` for a categorizer's. */
    featuresOf?: Readonly<Record<string, readonly string[]>>;
    /** The held categories' model, for the overlap. Absent: no overlap is measured. */
    holds?: TrainedModel;
  };

/** One trace's agreement with its siblings. */
export interface TraceQuality {
  id: string;
  gesture: string;
  /** Mean DTW distance to its comparable siblings (series units); null when it has none. */
  agreement: number | null;
  /** How many siblings it was comparable with. */
  comparable: number;
}

/** The leave-one-trace-out candidate: the trace whose removal most improves agreement. */
export interface OddTrace {
  id: string;
  /** Its mean distance to the others over the others' agreement among themselves (floored at the
   *  matcher's radius floor): about 1 for a repetition like the rest. */
  ratio: number;
  /** The gesture's agreement with it over the agreement without it: above 1 it was hurting. */
  improvement: number;
  /** Whether it is clearly worse ({@link GESTURE_QUALITY_DEFAULTS.oddRatio}): "drop the odd one". */
  flagged: boolean;
}

/** A held category a gesture passes through, dwelling. */
export interface HoldOverlap {
  /** The held category's id. */
  category: string;
  /** How many of the gesture's traces dwell in it. */
  traces: number;
  /** The longest dwell, in ms. */
  longestMs: number;
}

export interface GestureQuality {
  gesture: string;
  traces: number;
  /** Mean DTW distance over its comparable pairs (series units); null with none. */
  agreement: number | null;
  /** `agreement` over the typical agreement across gestures; null with none. */
  relativeAgreement: number | null;
  /** Past `looseAgreement`: "your repetitions differ". */
  loose: boolean;
  /** The matcher's radius over the comparable pairs; NaN with none. */
  radius: number;
  /** Null below three traces with comparable pairs. */
  odd: OddTrace | null;
  /** The nearest other gesture, or null when there is none to compare with. */
  nearest: string | null;
  /** Median distance from its traces to the nearest other gesture's (series units). */
  distance: number;
  /** `distance / radius`; Infinity with no neighbour. */
  ratio: number;
  /** The held categories it dwells in; null when not measured (no held model, or no frame
   *  carried enough of its features). */
  overlaps: HoldOverlap[] | null;
  /** Pairs (within, and to other gestures) left out for too little shared coverage. */
  incomparable: number;
  grade: QualityGrade;
  dots: 1 | 2 | 3;
  /** What it will be confused with when CLOSE: the nearest gesture, else a held category. */
  closeTo: string | null;
}

export interface GestureSetQuality {
  gestures: GestureQuality[];
  traces: TraceQuality[];
  /** The median agreement across gestures, floored at the matcher's radius floor. */
  typicalAgreement: number;
}

/** Mean of `xs`; null when empty. */
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * The held categories `samples` dwells in (see the module header): runs of one category lasting
 * `dwellMs`, other than the categories it starts and ends on. Null when no frame carries
 * `minShared` of the model's weighted features.
 */
function holdRuns(holds: TrainedModel, samples: readonly TraceSample[], minShared: number, dwellMs: number): Map<string, number> | null {
  const features = holds.features.filter((f) => !Object.hasOwn(holds.weights, f) || holds.weights[f] !== 0);
  const measured = (v: FeatureVector) => features.length > 0 && features.filter((f) => Number.isFinite(v[f])).length / features.length >= minShared;
  const read = samples.map((s) => (measured(s.vector) ? { id: classify(holds, s.vector).categoryId } : null));
  if (read.every((x) => x === null)) return null;
  const ids = read.map((x) => x?.id ?? null);
  const ends = new Set([ids.find((x) => x !== null), [...ids].reverse().find((x) => x !== null)]);
  const out = new Map<string, number>();
  let start = 0;
  for (let i = 1; i <= samples.length; i++) {
    const prev = ids[i - 1];
    if (i < samples.length && ids[i] === prev) continue;
    // The run [start, i - 1].
    if (prev !== null && !ends.has(prev)) {
      const ms = samples[i - 1].t - samples[start].t;
      if (ms >= dwellMs) out.set(prev, Math.max(out.get(prev) ?? 0, ms));
    }
    start = i;
  }
  return out;
}

/** The quality of a player's gestures from their traces (see the module header). */
export function gestureQuality(traces: readonly Trace[], options: GestureQualityOptions): GestureSetQuality {
  const o = { ...GESTURE_QUALITY_DEFAULTS, ...options };
  const { series, band, minRadius, minTraces } = resolveGestureOptions(options);
  const { features, weights } = series;
  const weighted = (f: string) => Object.hasOwn(weights, f) && weights[f] !== 0;

  const items = traces.map((tr) => {
    const s = toSeries(tr.samples, series);
    const finite = new Set<number>();
    if (s.rows.length > 0) s.rows[0].forEach((x, k) => Number.isFinite(x) && finite.add(k));
    return { trace: tr, s, finite };
  });
  const order: string[] = [];
  const members = new Map<string, number[]>();
  items.forEach((it, i) => {
    const g = it.trace.gesture;
    if (!members.has(g)) {
      members.set(g, []);
      order.push(g);
    }
    if (it.s.rows.length > 0) members.get(g)!.push(i);
  });
  /** A gesture's own columns: the shared-coverage denominator. */
  const columns = new Map(
    order.map((g) => {
      const own = options.featuresOf?.[g] ?? features;
      const set = new Set(own);
      return [g, features.flatMap((f, k) => (set.has(f) && weighted(f) ? [k] : []))];
    }),
  );
  const comparable = (g: string, i: number, j: number): boolean => {
    const cols = columns.get(g)!;
    if (cols.length === 0) return false;
    const shared = cols.filter((k) => items[i].finite.has(k) && items[j].finite.has(k)).length;
    return shared / cols.length >= o.minShared;
  };
  const cache = new Map<string, number>();
  const dist = (i: number, j: number): number => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    let d = cache.get(key);
    if (d === undefined) {
      d = dtwDistance(items[i].s.rows, items[j].s.rows, { band });
      cache.set(key, d);
    }
    return d;
  };

  const traceQuality: TraceQuality[] = [];
  const perGesture = order.map((g) => {
    const idx = members.get(g)!;
    const amplitude = median(idx.map((i) => items[i].s.amplitude));
    const floor = minRadius * (series.scale ? 1 : amplitude);
    let incomparable = 0;
    // Within: comparable pair distances, per trace and overall.
    const pairs: { i: number; j: number; d: number }[] = [];
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        if (comparable(g, idx[a], idx[b])) pairs.push({ i: idx[a], j: idx[b], d: dist(idx[a], idx[b]) });
        else incomparable += 1;
      }
    }
    const siblings = (i: number) => pairs.filter((p) => p.i === i || p.j === i).map((p) => p.d);
    const own = idx.map((i) => ({ i, d: siblings(i) }));
    for (const { i, d } of own) traceQuality.push({ id: items[i].trace.id, gesture: g, agreement: mean(d), comparable: d.length });
    const agreement = mean(pairs.map((p) => p.d));
    const nearestSibling = own.filter((x) => x.d.length > 0).map((x) => Math.min(...x.d));
    const radius = gestureRadius(nearestSibling, amplitude, { minRadius, scale: series.scale });

    let odd: OddTrace | null = null;
    if (agreement !== null && idx.length >= 3) {
      for (const { i, d } of own) {
        const without = mean(pairs.filter((p) => p.i !== i && p.j !== i).map((p) => p.d));
        const dI = mean(d);
        if (without === null || dI === null) continue;
        const improvement = without > 0 ? agreement / without : agreement > 0 ? Infinity : 1;
        if (odd && improvement <= odd.improvement) continue;
        const ratio = dI / Math.max(without, floor);
        odd = { id: items[i].trace.id, ratio, improvement, flagged: ratio >= o.oddRatio };
      }
    }

    // Separation: per trace the nearest comparable trace of each other gesture, then the median.
    let nearest: string | null = null;
    let distance = Infinity;
    for (const h of order) {
      if (h === g) continue;
      const other = members.get(h)!;
      if (other.length === 0) continue;
      const per: number[] = [];
      for (const i of idx) {
        let best = Infinity;
        for (const j of other) {
          if (!comparable(g, i, j)) {
            incomparable += 1;
            continue;
          }
          best = Math.min(best, dist(i, j));
        }
        if (Number.isFinite(best)) per.push(best);
      }
      const d = per.length > 0 ? median(per) : Infinity;
      if (d < distance) {
        distance = d;
        nearest = h;
      }
    }
    const ratio = nearest === null || !(radius > 0) ? Infinity : distance / radius;

    // Overlap with the held categories.
    let overlaps: HoldOverlap[] | null = null;
    if (o.holds) {
      const found = new Map<string, HoldOverlap>();
      let measured = false;
      for (const i of idx) {
        const runs = holdRuns(o.holds, items[i].trace.samples, o.minShared, o.dwellMs);
        if (runs === null) continue;
        measured = true;
        for (const [category, ms] of runs) {
          const cur = found.get(category) ?? { category, traces: 0, longestMs: 0 };
          found.set(category, { category, traces: cur.traces + 1, longestMs: Math.max(cur.longestMs, ms) });
        }
      }
      overlaps = measured ? [...found.values()].sort((a, b) => b.traces - a.traces || b.longestMs - a.longestMs) : null;
    }

    return { g, idx, agreement, radius, floor, odd, nearest, distance, ratio, overlaps, incomparable };
  });

  const agreements = perGesture.flatMap((p) => (p.agreement === null ? [] : [p.agreement]));
  const floors = perGesture.map((p) => p.floor).filter(Number.isFinite);
  const typicalAgreement = Math.max(agreements.length > 0 ? median(agreements) : 0, floors.length > 0 ? median(floors) : 0);

  const gestures = perGesture.map((p): GestureQuality => {
    const relativeAgreement = p.agreement === null || !(typicalAgreement > 0) ? null : p.agreement / typicalAgreement;
    const loose = relativeAgreement !== null && relativeAgreement > o.looseAgreement;
    const confused = p.ratio < o.closeRatio;
    const overlap = (p.overlaps?.length ?? 0) > 0;
    const grade: QualityGrade =
      p.idx.length < minTraces || p.agreement === null
        ? 'thin'
        : confused || overlap
          ? 'close'
          : p.ratio < o.okRatio || loose || p.odd?.flagged
            ? 'ok'
            : 'distinct';
    const closeTo = grade !== 'close' ? null : confused ? p.nearest : (p.overlaps?.[0]?.category ?? null);
    return {
      gesture: p.g,
      traces: p.idx.length,
      agreement: p.agreement,
      relativeAgreement,
      loose,
      radius: p.radius,
      odd: p.odd,
      nearest: p.nearest,
      distance: p.distance,
      ratio: p.ratio,
      overlaps: p.overlaps,
      incomparable: p.incomparable,
      grade,
      dots: gradeDots(grade),
      closeTo,
    };
  });
  return { gestures, traces: traceQuality, typicalAgreement };
}
