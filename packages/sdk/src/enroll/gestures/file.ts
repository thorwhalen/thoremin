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
 * frames' stamps, so a dropped frame must stay a gap, not a shift). The features are captured per
 * gesture at save time, and their weights once for the section (one session, one noise estimate):
 * what the player taught is matched later on what was attended then, whatever the session's
 * feature space becomes. A feature with no weight is refused at save, never silently dropped.
 *
 * ## Ids and labels
 *
 * As a held category has a stable id (`cat-1`) and a player-facing label, so does a gesture: the
 * label is the name the cue asked for ("wave"), the id is what a binding is keyed by, so a rename
 * never breaks a binding. Read back, a trace names its gesture by the ID, which is what the
 * matcher then fires and a binding dispatches on. A new gesture gets the smallest free
 * `gesture-n` ({@link freshGestureId}, the twin of `freshCategoryId`), never a position: a
 * re-save after a deletion keeps every other gesture's id, given the ids it had
 * ({@link gestureIds}).
 *
 * ## The model is derived, never stored
 *
 * {@link gestureModelFromCategorizer} rebuilds the matcher's model from the stored traces with
 * `buildGestureModel`, as `modelFromCategorizer` rebuilds the held categories from the samples.
 * The live tuning (tolerance, refractory period) is the device's.
 *
 * ## The shape it was recorded with (#754)
 *
 * A gesture written here states its window length and invariances (`length`, `position`, `scale`:
 * the matcher's defaults at the time, unless the caller says otherwise), and is read back with
 * them, so a later retune of `MATCHER_DEFAULTS` never silently changes how a saved gesture is
 * matched. A gesture saved before (#753) states none and is matched with the defaults of the day.
 *
 * Pure: traces and records in, records and traces out.
 */
import {
  ASIDE_BIN,
  NEUTRAL_BIN,
  roundSupport,
  TRACE_TIME_DECIMALS,
  type CategorizerGestures,
  type CategorizerTrace,
  type PersonalCategorizer,
} from '../categorizer';
import type { FeatureVector, FeatureWeights, Trace } from '../types';
import { definedOnly } from '../../util/options';
import { buildGestureModel, byGesture, MATCHER_DEFAULTS, type GestureModel, type GestureModelOptions, type GestureShape } from './matcher';

/** The shape a gesture is written with when the caller names none: the matcher's defaults now. */
export const RECORDED_SHAPE: Required<GestureShape> = { length: MATCHER_DEFAULTS.length, position: MATCHER_DEFAULTS.position, scale: MATCHER_DEFAULTS.scale };

/** A gesture id not in `taken`: `gesture-n`, smallest n first (`freshCategoryId`'s twin). */
export function freshGestureId(taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`gesture-${n}`)) n++;
  return `gesture-${n}`;
}

/** A saved categorizer's gesture ids by label: what a re-save passes as `ids`. */
export function gestureIds(c: Pick<PersonalCategorizer, 'gestures'>): Map<string, string> {
  return new Map((c.gestures?.items ?? []).map((g) => [g.label, g.id]));
}

export interface GestureSectionOptions {
  /** The features each gesture is matched on: one list for all, or per gesture name. */
  features: readonly string[] | ((gesture: string) => readonly string[]);
  /** The session's weights (`scaleWeights` of its noise estimate): one for every feature. */
  weights: Readonly<FeatureWeights>;
  /** Ids already given, by label: such a gesture keeps its id. Default none; {@link gestureIds}. */
  ids?: ReadonlyMap<string, string>;
  /** Ids a NEW gesture may not take: the categorizer's category ids (the bins are always taken). */
  taken?: Iterable<string>;
  /** The length and invariances each gesture is written with (one for all, or per gesture name);
   *  default {@link RECORDED_SHAPE}. */
  shape?: GestureShape | ((gesture: string) => GestureShape);
}

/** `shape` with every field stated ({@link RECORDED_SHAPE} filling the rest). */
export function statedShape(shape: GestureShape = {}): Required<GestureShape> {
  return { ...RECORDED_SHAPE, ...definedOnly(shape) };
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

/** The ids of the gestures in `labels`: a kept id first (so no new one takes it), then the
 *  smallest free `gesture-n` for each new label, in order. */
function assignIds(labels: readonly string[], ids: ReadonlyMap<string, string>, taken: Iterable<string>): Map<string, string> {
  const used = new Set<string>([NEUTRAL_BIN, ASIDE_BIN, ...taken]);
  const out = new Map<string, string>();
  for (const label of labels) {
    const id = ids.get(label);
    if (id !== undefined) {
      out.set(label, id);
      used.add(id);
    }
  }
  for (const label of labels) {
    if (out.has(label)) continue;
    const id = freshGestureId(used);
    out.set(label, id);
    used.add(id);
  }
  return out;
}

/** `weights` on `features`; throws naming the feature when one has no weight, and the gesture
 *  when none is above 0 (it could never be compared). */
function sectionWeights(features: ReadonlyMap<string, readonly string[]>, weights: Readonly<FeatureWeights>): FeatureWeights {
  const out: FeatureWeights = {};
  for (const [label, list] of features) {
    for (const f of list) {
      if (!Object.hasOwn(weights, f)) throw new Error(`gestureSection: feature "${f}" of gesture "${label}" has no weight`);
      out[f] = weights[f];
    }
    if (!list.some((f) => weights[f] > 0)) throw new Error(`gestureSection: gesture "${label}" has no feature with a weight above 0 (nothing it moves was measured at rest)`);
  }
  return out;
}

/**
 * The `gestures` section for `traces`: one entry per gesture name, in first-seen order, each
 * with its features and its traces projected, and the weights of every feature they list (see
 * the module header). A trace of fewer than two frames is dropped (it is no path); so is a
 * gesture left with none. Throws when a feature has no weight, or a gesture none above 0.
 */
export function gestureSection(traces: readonly Trace[], options: GestureSectionOptions): CategorizerGestures {
  const featuresOf = typeof options.features === 'function' ? options.features : () => options.features as readonly string[];
  const shapeOf = typeof options.shape === 'function' ? options.shape : () => (options.shape ?? {}) as GestureShape;
  const kept = [...byGesture(traces)]
    .map(([label, list]) => ({ label, list: list.filter((tr) => tr.samples.length >= 2), features: [...featuresOf(label)] }))
    .filter((g) => g.list.length > 0);
  const weights = sectionWeights(new Map(kept.map((g) => [g.label, g.features])), options.weights);
  const ids = assignIds(
    kept.map((g) => g.label),
    options.ids ?? new Map(),
    options.taken ?? [],
  );
  return {
    weights,
    items: kept.map((g) => ({ id: ids.get(g.label)!, label: g.label, features: g.features, traces: g.list.map((tr) => toStoredTrace(tr, g.features)), ...statedShape(shapeOf(g.label)) })),
  };
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
  return (c.gestures?.items ?? []).flatMap((g) => g.traces.map((tr) => fromStoredTrace(tr, g.id, g.features)));
}

/** The one feature space the stored gestures are matched in: the union of their features (in
 *  first-seen order), the section's weights, each gesture's own features by id, and the shape a
 *  gesture states (only those that state one). */
export interface GestureSpace {
  features: string[];
  weights: FeatureWeights;
  featuresOf: Record<string, string[]>;
  shapes: Record<string, GestureShape>;
}

/** What a stored gesture states of its shape (nothing for one saved before #754). */
export function storedShape(g: GestureShape): GestureShape {
  const out: GestureShape = {};
  if (g.length !== undefined) out.length = g.length;
  if (g.position !== undefined) out.position = g.position;
  if (g.scale !== undefined) out.scale = g.scale;
  return out;
}

export function gestureSpace(c: Pick<PersonalCategorizer, 'gestures'>): GestureSpace {
  const items = c.gestures?.items ?? [];
  const features = [...new Set(items.flatMap((g) => g.features))];
  return {
    features,
    weights: { ...(c.gestures?.weights ?? {}) },
    featuresOf: Object.fromEntries(items.map((g) => [g.id, [...g.features]])),
    shapes: Object.fromEntries(items.flatMap((g) => (Object.keys(storedShape(g)).length > 0 ? [[g.id, storedShape(g)]] : []))),
  };
}

/**
 * The matcher's model for a categorizer's gestures, derived from its stored traces. A gesture's
 * templates carry only its own features, so a segment is compared with them on those (the DTW
 * skips a dimension one side never measured).
 */
export function gestureModelFromCategorizer(
  c: Pick<PersonalCategorizer, 'gestures'>,
  options: Omit<GestureModelOptions, 'features' | 'weights' | 'shapes'> = {},
): GestureModel {
  const { features, weights, shapes } = gestureSpace(c);
  return buildGestureModel(gestureTraces(c), { ...options, features, weights, shapes });
}

/** A categorizer's gestures as a host plays them: the matcher's model and each gesture's name. */
export interface PlayableGestures {
  model: GestureModel;
  names: readonly { id: string; label: string }[];
}

/** How many sections the content memo keeps (the working one, the saved one, undo's neighbours). */
export const PLAYABLE_MEMO_SIZE = 8;

/** One derivation per gestures CONTENT. A live model is re-made on every tuning change and every
 *  edit, and every edit re-parses the categorizer (the schema clones `gestures`), so a memo by
 *  reference would miss on a hold moved or a category renamed. The matcher's model must not be
 *  re-derived then, both for its cost (a DTW per pair of repetitions) and so a listener kept by
 *  model identity stays warm (#954 review). The reference is the fast path; the content (its
 *  JSON) the key; a few recent sections are kept. */
const byReference = new WeakMap<CategorizerGestures, PlayableGestures>();
const byContent = new Map<string, PlayableGestures>();

/**
 * The gestures of `c` as a host plays them (#954: the carve tool's live test and the category
 * dispatcher alike), or null when it has none: the derived model ({@link
 * gestureModelFromCategorizer}) and the names by id. The same object for the same content.
 */
export function playableGestures(c: Pick<PersonalCategorizer, 'gestures'>): PlayableGestures | null {
  const section = c.gestures;
  if (!section || section.items.length === 0) return null;
  const known = byReference.get(section);
  if (known) return known;
  const key = JSON.stringify(section);
  let out = byContent.get(key);
  if (out) byContent.delete(key); // re-inserted below: the most recent last
  else out = { model: gestureModelFromCategorizer(c), names: section.items.map((g) => ({ id: g.id, label: g.label })) };
  byContent.set(key, out);
  while (byContent.size > PLAYABLE_MEMO_SIZE) byContent.delete(byContent.keys().next().value!);
  byReference.set(section, out);
  return out;
}
