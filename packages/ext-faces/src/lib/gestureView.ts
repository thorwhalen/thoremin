/**
 * The Gestures section's view of a categorizer (#754): per gesture its repetitions as small path
 * sketches, and its quality chip, from the stored traces only. Pure; the panel renders it.
 *
 * ## The chip, and why it never says "overlaps a held category" here
 *
 * The chip is `gestureQuality` over the categorizer's stored traces, in each gesture's own
 * features, weights and shape (`gestureSpace`), so it reads the same for a fresh carve and a
 * reopened one (E4's rule). A stored trace keeps only its gesture's features (a hand's positions),
 * not the held categories' (its shape), so the overlap with the held categories cannot be measured
 * from it, and the grid does not try: the overlap is measured once, when a take ends, on the
 * take's whole frames, and said then (`gestureOverlapNotice`). Storing every trace over the union
 * of the two feature sets would keep it measurable, at three times the size of a gesture section;
 * the decision and the alternative are in `docs/design/dynamic-gestures.md` section 4.
 *
 * ## The sketch
 *
 * A repetition is drawn as its path over the two features of its gesture that move most (largest
 * spread over all of the gesture's repetitions together), on one box per gesture, so the sketches
 * of one gesture compare in size and place. A wave of a hand is then its side-to-side swing.
 */
import { gestureQuality, gestureSpace, gestureTraces, type GestureQuality, type GestureSetQuality, type HoldOverlap } from '@thoremin/sdk/enroll/gestures';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { QualityGrade } from '@thoremin/sdk/enroll/quality';
import type { Trace, TrainedModel } from '@thoremin/sdk/enroll/types';

export const GESTURE_VIEW_DEFAULTS = {
  /** Points a sketch is thinned to at most (a stored repetition has 30-60 frames). */
  sketchPoints: 24,
} as const;

/** One repetition as drawn: its id and its path, in 0..1 on its gesture's box (y down). */
export interface TraceSketch {
  id: string;
  points: readonly (readonly [number, number])[];
  /** The leave-one-out odd repetition, flagged: "drop the odd one". */
  odd: boolean;
}

/** What the chip says. */
export interface GestureChip {
  grade: QualityGrade;
  dots: 1 | 2 | 3;
  word: string;
  /** The numbers behind it. */
  title: string;
}

export interface GestureCard {
  id: string;
  label: string;
  traces: readonly TraceSketch[];
  chip: GestureChip | null;
  /** The flagged odd repetition's id, offered for a one-click drop; null when none. */
  odd: string | null;
}

/** Every gesture's sketches and chip (none without a `gestures` section). */
export function gestureCards(c: Pick<PersonalCategorizer, 'gestures'>, { sketchPoints = GESTURE_VIEW_DEFAULTS.sketchPoints }: { sketchPoints?: number } = {}): GestureCard[] {
  const items = c.gestures?.items ?? [];
  if (items.length === 0) return [];
  const quality = qualityOf(c);
  const labels = new Map(items.map((g) => [g.id, g.label]));
  const traces = gestureTraces(c);
  return items.map((g) => {
    const q = quality?.gestures.find((x) => x.gesture === g.id) ?? null;
    const odd = q?.odd?.flagged ? q.odd.id : null;
    const own = traces.filter((t) => t.gesture === g.id);
    const axes = movingAxes(own, g.features);
    const box = boxOf(own, axes);
    return {
      id: g.id,
      label: g.label,
      traces: own.map((t) => ({ id: t.id, points: sketch(t, axes, box, sketchPoints), odd: t.id === odd })),
      chip: q ? chipOf(q, (id) => labels.get(id) ?? id) : null,
      odd,
    };
  });
}

/** The quality of every stored gesture, in each one's own space; null when it cannot be read. */
function qualityOf(c: Pick<PersonalCategorizer, 'gestures'>): GestureSetQuality | null {
  const space = gestureSpace(c);
  try {
    return gestureQuality(gestureTraces(c), { features: space.features, weights: space.weights, featuresOf: space.featuresOf, shapes: space.shapes });
  } catch {
    return null;
  }
}

/** The chip's word and numbers (the held categories' wording, for a gesture's repetitions). */
export function chipOf(q: GestureQuality, labelOf: (id: string) => string): GestureChip {
  const word =
    q.grade === 'thin'
      ? 'needs another repetition'
      : q.grade === 'close'
        ? q.closeTo
          ? `close to ${labelOf(q.closeTo)}`
          : 'close'
        : q.grade === 'ok'
          ? q.loose
            ? 'repetitions differ'
            : q.odd?.flagged
              ? 'one odd repetition'
              : 'ok'
          : 'distinct';
  const num = (x: number | null) => (x === null || !Number.isFinite(x) ? 'n/a' : x.toFixed(2));
  const title = `${q.traces} repetitions; agreement ${num(q.agreement)}; nearest ${q.nearest ? labelOf(q.nearest) : 'none'} at ${num(q.ratio)} radii`;
  return { grade: q.grade, dots: q.dots, word, title };
}

/** The two feature columns that move most over `traces`, by spread (fewer when fewer move). */
function movingAxes(traces: readonly Trace[], features: readonly string[]): string[] {
  const spread = features.map((f) => {
    const xs = traces.flatMap((t) => t.samples.map((s) => s.vector[f]).filter((x): x is number => Number.isFinite(x)));
    if (xs.length === 0) return { f, s: 0 };
    const m = xs.reduce((a, x) => a + x, 0) / xs.length;
    return { f, s: xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length };
  });
  return spread
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((x) => x.f);
}

type Box = { min: number[]; span: number };

/** One square box around every frame of `traces` on `axes`. */
function boxOf(traces: readonly Trace[], axes: readonly string[]): Box {
  const min = axes.map(() => Infinity);
  const max = axes.map(() => -Infinity);
  for (const t of traces)
    for (const s of t.samples)
      axes.forEach((f, k) => {
        const x = s.vector[f];
        if (!Number.isFinite(x)) return;
        min[k] = Math.min(min[k], x);
        max[k] = Math.max(max[k], x);
      });
  const span = Math.max(0, ...axes.map((_, k) => (Number.isFinite(max[k] - min[k]) ? max[k] - min[k] : 0)));
  return { min: min.map((x) => (Number.isFinite(x) ? x : 0)), span };
}

/** A trace's path on the box, at most `n` points, centred where a column is missing. */
function sketch(t: Trace, axes: readonly string[], box: Box, n: number): [number, number][] {
  const at = (s: Trace['samples'][number], k: number): number => {
    const x = s.vector[axes[k]];
    if (axes[k] === undefined || !Number.isFinite(x) || !(box.span > 0)) return 0.5;
    return (x - box.min[k]) / box.span;
  };
  const rows = t.samples;
  const step = Math.max(1, Math.ceil(rows.length / Math.max(2, n)));
  const out: [number, number][] = [];
  for (let i = 0; i < rows.length; i += step) out.push([at(rows[i], 0), at(rows[i], 1)]);
  const last = rows[rows.length - 1];
  if (last && (rows.length - 1) % step !== 0) out.push([at(last, 0), at(last, 1)]);
  return out;
}

/**
 * The overlap of a just-recorded gesture with the held categories, in words (see the module
 * header): measured on the take's whole frames against the held model, said once as the take ends.
 * `labelOf` names a category by id. Null when it dwells in none (or nothing could be read).
 */
export function gestureOverlapNotice(
  name: string,
  traces: readonly Trace[],
  { features, weights, holds, labelOf }: { features: readonly string[]; weights: Readonly<Record<string, number>>; holds: TrainedModel; labelOf: (id: string) => string },
): string | null {
  let overlaps: HoldOverlap[] | null = null;
  try {
    overlaps = gestureQuality(traces, { features, weights, holds }).gestures[0]?.overlaps ?? null;
  } catch {
    return null;
  }
  if (!overlaps || overlaps.length === 0) return null;
  const which = overlaps.map((o) => `"${labelOf(o.category)}" (${(o.longestMs / 1000).toFixed(1)} s)`).join(', ');
  return `Your ${name} passes through ${which} on the way, long enough to also fire ${overlaps.length === 1 ? 'it' : 'them'} when you play.`;
}
