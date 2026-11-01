/**
 * How good a player's dynamic gestures are (#753, phase 3 of `docs/design/dynamic-gestures.md`,
 * section 4): the numbers behind the Gestures chips in Sorting, the dynamic analogue of the held
 * categories' `quality.ts`, and in its vocabulary (grade, dots, nearest, `closeTo`, `thin`).
 *
 * A held category is judged by spread around a centre; a gesture has no centre, only repetitions
 * of a path, so it is judged by how alike its repetitions are and how unlike the others':
 *
 * - **Agreement**: each trace's mean DTW distance to its siblings, and the gesture's mean over
 *   its pairs. A gesture is `loose` on either of two tests. ABSOLUTE: its agreement is past what
 *   the matcher accepts around a gesture at its radius floor ({@link GESTURE_QUALITY_DEFAULTS.looseCeiling}
 *   floors, the matcher's `tolerance x minRadius`, 0.2 series units by default), so it holds with
 *   one gesture or two. RELATIVE: `relativeAgreement` is the agreement over the median agreement
 *   of the player's OTHER gestures ("your five waves differ more than your gestures usually do"),
 *   loose past {@link GESTURE_QUALITY_DEFAULTS.looseAgreement}, but only above the radius floor
 *   (repetitions closer than that are the same motion to the matcher, however precise the
 *   others). The gesture itself is never in its own reference: with one or two gestures it would
 *   be half of it, and a sloppy gesture could never be loose.
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
 *   distance in noise units, its reject radius and its taught Neutral). A single REJECTED frame
 *   between two frames of one category does not break its run (a flicker the tracker holds
 *   through; {@link GESTURE_QUALITY_DEFAULTS.holdRejectedFrames}); a Neutral frame does (Neutral
 *   is a reading the tracker enters, and leaving it re-enters the category). Only the LEADING
 *   and TRAILING runs are exempt (once the rejected frames at either end, the hand not yet in any
 *   reading, are set aside): a gesture that starts and ends on a held pose (the
 *   resting open hand the wave starts from) is fine (design section 4), but a return to that pose
 *   mid-way, after Neutral, is a fresh entry and counts.
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
 * A pair whose DTW distance is not finite (no dimension measured in both, possible only with
 * `minShared: 0`) is incomparable too, so an agreement is never Infinity.
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
import { definedOnly } from '../../util/options';
import { dtwDistance } from './dtw';
import { gestureRadius, MATCHER_DEFAULTS, resolveGestureOptions, type GestureModelOptions } from './matcher';
import { toSeries, type Series } from './series';

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
  /** Agreement past this many times the OTHER gestures' typical one is `loose`: the matcher's
   *  tolerance again (a repetition twice as far as usual is at the edge of what it accepts). */
  looseAgreement: MATCHER_DEFAULTS.tolerance,
  /** Agreement past this many radius floors is `loose` whatever the other gestures do: the
   *  matcher's tolerance, so the line is `tolerance x minRadius` (0.2 series units), what the
   *  matcher accepts around a gesture at its floor. */
  looseCeiling: MATCHER_DEFAULTS.tolerance,
  /** The odd trace is flagged at this many times the others' agreement: past the matcher's
   *  tolerance, the matcher would refuse a repetition like it. */
  oddRatio: MATCHER_DEFAULTS.tolerance,
  /** A trace inside a held category's reading for this long would fire it: the sampler's dwell. */
  dwellMs: MOTION_DEFAULTS.dwellMs,
  /** The most consecutive rejected frames a dwell holds through: one, a flicker (a tracking
   *  glitch), which the tracker holds through. Longer is the hand moving away: the tracker may
   *  still REPORT the category through its exit hysteresis, but the hand is not dwelling in it
   *  (a wave's swings out and back through its resting pose would read as one long dwell). */
  holdRejectedFrames: 1,
} as const;

export type GestureQualityOptions = GestureModelOptions & {
    [K in keyof typeof GESTURE_QUALITY_DEFAULTS]?: number;
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
  /** `agreement` over the median agreement of the OTHER gestures; null when there is none. */
  relativeAgreement: number | null;
  /** "Your repetitions differ": past the absolute line, or the relative one (module header). */
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
}

/** The options with every default filled in, and the matcher's resolved radius floor. */
type Options = GestureQualityOptions & { [K in keyof typeof GESTURE_QUALITY_DEFAULTS]: number } & { minRadius: number };

/** Mean of `xs`; null when empty. */
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** One trace in the matcher's space, with the columns its first row measured. */
interface Item {
  trace: Trace;
  s: Series;
  finite: Set<number>;
}

/** The pair questions every part asks: is a pair comparable for gesture `g`, and its distance. */
interface PairSpace {
  items: Item[];
  /** Comparable for `g` AND at a finite distance: the only pairs any number is made from. */
  pair(g: string, i: number, j: number): number | null;
}

function makePairSpace(items: Item[], columns: ReadonlyMap<string, number[]>, minShared: number, band: number): PairSpace {
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
  const shares = (g: string, i: number, j: number): boolean => {
    const cols = columns.get(g)!;
    if (cols.length === 0) return false;
    const shared = cols.filter((k) => items[i].finite.has(k) && items[j].finite.has(k)).length;
    return shared / cols.length >= minShared;
  };
  return {
    items,
    pair(g, i, j) {
      if (!shares(g, i, j)) return null;
      const d = dist(i, j);
      return Number.isFinite(d) ? d : null;
    },
  };
}

/** The traces in the matcher's space, grouped by gesture in first-seen order (a trace too short
 *  for a series is counted in its gesture's order but has no member index). */
function prepare(traces: readonly Trace[], series: Parameters<typeof toSeries>[1]) {
  const items: Item[] = traces.map((trace) => {
    const s = toSeries(trace.samples, series);
    const finite = new Set<number>();
    if (s.rows.length > 0) s.rows[0].forEach((x, k) => Number.isFinite(x) && finite.add(k));
    return { trace, s, finite };
  });
  const members = new Map<string, number[]>();
  items.forEach((it, i) => {
    const list = members.get(it.trace.gesture) ?? [];
    members.set(it.trace.gesture, list);
    if (it.s.rows.length > 0) list.push(i);
  });
  return { items, members };
}

/** Each gesture's own weighted columns: the shared-coverage denominator. */
function ownColumns(order: readonly string[], options: Options, features: readonly string[], weights: Readonly<Record<string, number>>): Map<string, number[]> {
  const weighted = (f: string) => Object.hasOwn(weights, f) && weights[f] !== 0;
  return new Map(
    order.map((g) => {
      const own = new Set(options.featuresOf?.[g] ?? features);
      return [g, features.flatMap((f, k) => (own.has(f) && weighted(f) ? [k] : []))];
    }),
  );
}

interface Pair {
  i: number;
  j: number;
  d: number;
}

/** The leave-one-trace-out candidate among `idx` (null below three traces or with no pairs). */
function oddTrace(idx: readonly number[], pairs: readonly Pair[], items: readonly Item[], floor: number, oddRatio: number): OddTrace | null {
  const agreement = mean(pairs.map((p) => p.d));
  if (agreement === null || idx.length < 3) return null;
  let odd: OddTrace | null = null;
  for (const i of idx) {
    const without = mean(pairs.filter((p) => p.i !== i && p.j !== i).map((p) => p.d));
    const dI = mean(pairs.filter((p) => p.i === i || p.j === i).map((p) => p.d));
    if (without === null || dI === null) continue;
    const improvement = without > 0 ? agreement / without : agreement > 0 ? Infinity : 1;
    if (odd && improvement <= odd.improvement) continue;
    const ratio = dI / Math.max(without, floor);
    odd = { id: items[i].trace.id, ratio, improvement, flagged: ratio >= oddRatio };
  }
  return odd;
}

/** How alike one gesture's repetitions are: its pairs, agreement, radius and odd trace. */
function withinGesture(g: string, idx: readonly number[], space: PairSpace, o: Options, scale: boolean) {
  const { items } = space;
  const amplitude = median(idx.map((i) => items[i].s.amplitude));
  const floor = o.minRadius * (scale ? 1 : amplitude);
  const pairs: Pair[] = [];
  let incomparable = 0;
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const d = space.pair(g, idx[a], idx[b]);
      if (d === null) incomparable += 1;
      else pairs.push({ i: idx[a], j: idx[b], d });
    }
  }
  const siblings = (i: number) => pairs.filter((p) => p.i === i || p.j === i).map((p) => p.d);
  const traces: TraceQuality[] = idx.map((i) => {
    const d = siblings(i);
    return { id: items[i].trace.id, gesture: g, agreement: mean(d), comparable: d.length };
  });
  const nearestSibling = idx.map(siblings).filter((d) => d.length > 0).map((d) => Math.min(...d));
  return {
    agreement: mean(pairs.map((p) => p.d)),
    radius: gestureRadius(nearestSibling, amplitude, { minRadius: o.minRadius, scale }),
    floor,
    odd: oddTrace(idx, pairs, items, floor, o.oddRatio),
    traces,
    incomparable,
  };
}

/** The nearest other gesture to `g`: per trace the nearest comparable trace of each other
 *  gesture, then the median over the traces. */
function separation(g: string, idx: readonly number[], members: ReadonlyMap<string, number[]>, space: PairSpace) {
  let nearest: string | null = null;
  let distance = Infinity;
  let incomparable = 0;
  for (const [h, other] of members) {
    if (h === g || other.length === 0) continue;
    const per: number[] = [];
    for (const i of idx) {
      let best = Infinity;
      for (const j of other) {
        const d = space.pair(g, i, j);
        if (d === null) incomparable += 1;
        else best = Math.min(best, d);
      }
      if (Number.isFinite(best)) per.push(best);
    }
    const d = per.length > 0 ? median(per) : Infinity;
    if (d < distance) {
      distance = d;
      nearest = h;
    }
  }
  return { nearest, distance, incomparable };
}

/** One frame as the held model reads it: a category id, a rejection, or neither (Neutral). */
interface HoldReading {
  t: number;
  id: string | null;
  rejected: boolean;
}

/** The frames carrying `minShared` of the model's weighted features, read by `classify`. */
function readHolds(holds: TrainedModel, samples: readonly TraceSample[], minShared: number): HoldReading[] {
  const features = holds.features.filter((f) => !Object.hasOwn(holds.weights, f) || holds.weights[f] !== 0);
  if (features.length === 0) return [];
  const measured = (v: FeatureVector) => features.filter((f) => Number.isFinite(v[f])).length / features.length >= minShared;
  return samples.flatMap((s) => {
    if (!measured(s.vector)) return [];
    const c = classify(holds, s.vector);
    return [{ t: s.t, id: c.categoryId, rejected: c.rejected === true }];
  });
}

/** The readings' ids with each run of at most `maxGap` rejected frames between two frames of one
 *  category given that category (the tracker holds through it). */
function holdThroughRejections(reads: readonly HoldReading[], maxGap: number): (string | null)[] {
  const ids = reads.map((r) => r.id);
  let i = 0;
  while (i < reads.length) {
    if (!reads[i].rejected) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < reads.length && reads[j].rejected) j += 1;
    const before = i > 0 ? ids[i - 1] : null;
    if (before !== null && j < reads.length && ids[j] === before && j - i <= maxGap) ids.fill(before, i, j);
    i = j;
  }
  return ids;
}

/** Runs of one id, in order, with their duration from first to last frame. */
function runsOf(ids: readonly (string | null)[], t: readonly number[]): { id: string | null; ms: number }[] {
  const out: { id: string | null; ms: number }[] = [];
  let start = 0;
  for (let i = 1; i <= ids.length; i++) {
    if (i < ids.length && ids[i] === ids[start]) continue;
    out.push({ id: ids[start], ms: t[i - 1] - t[start] });
    start = i;
  }
  return out;
}

/** `[from, to)`: the readings without their leading and trailing rejected frames (the hand not yet
 *  in, or already out of, any reading: nothing the tracker would commit). */
function trimRejected(reads: readonly HoldReading[]): [number, number] {
  let from = 0;
  let to = reads.length;
  while (from < to && reads[from].rejected) from += 1;
  while (to > from && reads[to - 1].rejected) to -= 1;
  return [from, to];
}

/**
 * The held categories `samples` dwells in (see the module header): runs of one category lasting
 * `dwellMs`, other than the leading and trailing runs (once leading and trailing rejections are
 * set aside), longest per category. Null when no frame carries `minShared` of the model's
 * weighted features.
 */
function holdRuns(holds: TrainedModel, samples: readonly TraceSample[], o: Options): Map<string, number> | null {
  const all = readHolds(holds, samples, o.minShared);
  if (all.length === 0) return null;
  const reads = all.slice(...trimRejected(all));
  const runs = runsOf(
    holdThroughRejections(reads, o.holdRejectedFrames),
    reads.map((r) => r.t),
  );
  const out = new Map<string, number>();
  runs.slice(1, -1).forEach(({ id, ms }) => {
    if (id !== null && ms >= o.dwellMs) out.set(id, Math.max(out.get(id) ?? 0, ms));
  });
  return out;
}

/** The held categories a gesture's traces dwell in, most traces first; null when none measured. */
function holdOverlaps(holds: TrainedModel, traces: readonly Trace[], o: Options): HoldOverlap[] | null {
  const found = new Map<string, HoldOverlap>();
  let measured = false;
  for (const tr of traces) {
    const runs = holdRuns(holds, tr.samples, o);
    if (runs === null) continue;
    measured = true;
    for (const [category, ms] of runs) {
      const cur = found.get(category) ?? { category, traces: 0, longestMs: 0 };
      found.set(category, { category, traces: cur.traces + 1, longestMs: Math.max(cur.longestMs, ms) });
    }
  }
  return measured ? [...found.values()].sort((a, b) => b.traces - a.traces || b.longestMs - a.longestMs) : null;
}

/** Whether a gesture's repetitions differ (see the module header), and by how much relative to
 *  the other gestures' median agreement. */
function looseness(agreement: number | null, others: readonly number[], floor: number, o: Options): { relativeAgreement: number | null; loose: boolean } {
  if (agreement === null) return { relativeAgreement: null, loose: false };
  const typical = others.length > 0 ? median(others) : NaN;
  const relativeAgreement = typical > 0 ? agreement / typical : null;
  const absolute = agreement > o.looseCeiling * floor;
  const relative = relativeAgreement !== null && relativeAgreement > o.looseAgreement && agreement > floor;
  return { relativeAgreement, loose: absolute || relative };
}

/** The quality of a player's gestures from their traces (see the module header). */
export function gestureQuality(traces: readonly Trace[], options: GestureQualityOptions): GestureSetQuality {
  const resolved = resolveGestureOptions(options);
  const o: Options = { ...GESTURE_QUALITY_DEFAULTS, ...definedOnly(options), minRadius: resolved.minRadius };
  const { series, band, minTraces } = resolved;
  const { items, members } = prepare(traces, series);
  const order = [...members.keys()];
  const space = makePairSpace(items, ownColumns(order, o, series.features, series.weights), o.minShared, band);

  const parts = order.map((g) => {
    const idx = members.get(g)!;
    const within = withinGesture(g, idx, space, o, series.scale);
    const apart = separation(g, idx, members, space);
    const overlaps = o.holds ? holdOverlaps(o.holds, idx.map((i) => items[i].trace), o) : null;
    return { g, idx, within, apart, overlaps };
  });

  const gestures = parts.map(({ g, idx, within, apart, overlaps }): GestureQuality => {
    const others = parts.flatMap((p) => (p.g === g || p.within.agreement === null ? [] : [p.within.agreement]));
    const { relativeAgreement, loose } = looseness(within.agreement, others, within.floor, o);
    const ratio = apart.nearest === null || !(within.radius > 0) ? Infinity : apart.distance / within.radius;
    const confused = ratio < o.closeRatio;
    const overlap = (overlaps?.length ?? 0) > 0;
    const grade: QualityGrade =
      idx.length < minTraces || within.agreement === null
        ? 'thin'
        : confused || overlap
          ? 'close'
          : ratio < o.okRatio || loose || within.odd?.flagged
            ? 'ok'
            : 'distinct';
    return {
      gesture: g,
      traces: idx.length,
      agreement: within.agreement,
      relativeAgreement,
      loose,
      radius: within.radius,
      odd: within.odd,
      nearest: apart.nearest,
      distance: apart.distance,
      ratio,
      overlaps,
      incomparable: within.incomparable + apart.incomparable,
      grade,
      dots: gradeDots(grade),
      closeTo: grade !== 'close' ? null : confused ? apart.nearest : (overlaps?.[0]?.category ?? null),
    };
  });
  return { gestures, traces: parts.flatMap((p) => p.within.traces) };
}
