/**
 * A categorizer file's `gestures` section (#753, phase 3 of `docs/design/dynamic-gestures.md`):
 * writing it from a session's traces, and reading the traces back for the matcher.
 *
 * ## Why a projection on the way out
 *
 * A {@link Trace} carries the WHOLE live vector per frame (the segmenter does not know which
 * features a gesture will be matched on), a few hundred numbers a frame. Stored as is, five
 * repetitions of a dozen gestures would dwarf the rest of the file. So each trace is projected
 * onto its gesture's chosen features and kept as rows aligned with them, rounded as a sample's
 * `support` is (`roundSupport`), with each frame's own time (the matcher resamples at the
 * frames' stamps, so a dropped frame must stay a gap, not a shift). The features and their
 * weights are captured per gesture at save time: what the player taught is matched later on
 * what was attended then, whatever the session's feature space becomes.
 *
 * ## Ids and labels
 *
 * As a held category has a stable id (`cat-1`) and a player-facing label, so does a gesture: the
 * label is the name the cue asked for ("wave"), the id is what a binding is keyed by, so a rename
 * never breaks a binding. Read back, a trace names its gesture by the ID, which is what the
 * matcher then fires and a binding dispatches on.
 *
 * ## The model is derived, never stored
 *
 * {@link gestureModelFromCategorizer} rebuilds the matcher's model from the stored traces with
 * `buildGestureModel`, as `modelFromCategorizer` rebuilds the held categories from the samples.
 * The window length and the invariances are the matcher's defaults (`MATCHER_DEFAULTS`) until a
 * gesture needs its own; the live tuning (tolerance, refractory period) is the device's.
 *
 * Pure: traces and records in, records and traces out.
 */
import {
  roundSupport,
  TRACE_TIME_DECIMALS,
  type CategorizerGesture,
  type CategorizerTrace,
  type PersonalCategorizer,
} from '../categorizer';
import type { FeatureVector, FeatureWeights, Trace } from '../types';
import { buildGestureModel, byGesture, type GestureModel, type GestureModelOptions } from './matcher';

/** The id a gesture gets when the caller has none for it: by first-seen order. */
export const defaultGestureId = (_label: string, index: number): string => `gesture-${index + 1}`;

export interface GestureSectionOptions {
  /** The features each gesture is matched on: one list for all, or per gesture name. */
  features: readonly string[] | ((gesture: string) => readonly string[]);
  /** The session's weights (`scaleWeights` of its noise estimate); each gesture keeps those of
   *  its own features. */
  weights: Readonly<FeatureWeights>;
  /** The id for a gesture name (an existing gesture keeps its id); default {@link defaultGestureId}. */
  idFor?: (gesture: string, index: number) => string;
}

const roundTime = (x: number): number => Number(x.toFixed(TRACE_TIME_DECIMALS));

/** One trace as stored: projected onto `features`, rounded, times after its first frame. */
export function toStoredTrace(trace: Trace, features: readonly string[]): CategorizerTrace {
  const t0 = trace.samples[0]?.t ?? 0;
  return {
    id: trace.id,
    cue: trace.cue,
    t0: roundTime(Number.isFinite(t0) ? t0 : 0),
    t: trace.samples.map((s) => roundTime(s.t - t0)),
    rows: trace.samples.map((s) => features.map((f) => roundSupport(s.vector[f]))),
  };
}

/**
 * The `gestures` section for `traces`: one entry per gesture name, in first-seen order, each
 * with its features, their weights and its traces projected (see the module header). A trace
 * of fewer than two frames is dropped (it is no path); so is a gesture left with none.
 */
export function gestureSection(traces: readonly Trace[], options: GestureSectionOptions): CategorizerGesture[] {
  const featuresOf = typeof options.features === 'function' ? options.features : () => options.features as readonly string[];
  const idFor = options.idFor ?? defaultGestureId;
  const out: CategorizerGesture[] = [];
  let index = 0;
  for (const [label, list] of byGesture(traces)) {
    const features = [...featuresOf(label)];
    const kept = list.filter((tr) => tr.samples.length >= 2);
    if (kept.length === 0) continue;
    const weights: FeatureWeights = {};
    for (const f of features) if (Object.hasOwn(options.weights, f)) weights[f] = options.weights[f];
    out.push({ id: idFor(label, index), label, features, weights, traces: kept.map((tr) => toStoredTrace(tr, features)) });
    index += 1;
  }
  return out;
}

/** A stored trace as a {@link Trace} naming its gesture by `gestureId`: vectors keyed by the
 *  gesture's features (a null value left out, as every distance in `enroll/` reads it). */
export function fromStoredTrace(stored: CategorizerTrace, gestureId: string, features: readonly string[]): Trace {
  return {
    id: stored.id,
    gesture: gestureId,
    cue: stored.cue,
    samples: stored.rows.map((row, n) => {
      const vector: FeatureVector = {};
      features.forEach((f, k) => {
        const x = row[k];
        if (x !== null && x !== undefined) vector[f] = x;
      });
      return { vector, t: stored.t0 + stored.t[n] };
    }),
  };
}

/** Every stored trace, as traces naming their gesture by its id. */
export function gestureTraces(c: Pick<PersonalCategorizer, 'gestures'>): Trace[] {
  return (c.gestures ?? []).flatMap((g) => g.traces.map((tr) => fromStoredTrace(tr, g.id, g.features)));
}

/** The one feature space the stored gestures are matched in: the union of their features (in
 *  first-seen order), their weights (the first gesture naming a feature gives its weight; one
 *  session gives them all the same), and each gesture's own features by id. */
export interface GestureSpace {
  features: string[];
  weights: FeatureWeights;
  featuresOf: Record<string, string[]>;
}

export function gestureSpace(c: Pick<PersonalCategorizer, 'gestures'>): GestureSpace {
  const features: string[] = [];
  const seen = new Set<string>();
  const weights: FeatureWeights = {};
  const featuresOf: Record<string, string[]> = {};
  for (const g of c.gestures ?? []) {
    featuresOf[g.id] = [...g.features];
    for (const f of g.features) {
      if (seen.has(f)) continue;
      seen.add(f);
      features.push(f);
      if (Object.hasOwn(g.weights, f)) weights[f] = g.weights[f];
    }
  }
  return { features, weights, featuresOf };
}

/**
 * The matcher's model for a categorizer's gestures, derived from its stored traces. A gesture's
 * templates carry only its own features, so a segment is compared with them on those (the DTW
 * skips a dimension one side never measured).
 */
export function gestureModelFromCategorizer(
  c: Pick<PersonalCategorizer, 'gestures'>,
  options: Omit<GestureModelOptions, 'features' | 'weights'> = {},
): GestureModel {
  const { features, weights } = gestureSpace(c);
  return buildGestureModel(gestureTraces(c), { ...options, features, weights });
}
