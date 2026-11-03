/**
 * Editing a categorizer's gestures (#754, phase 4 of `docs/design/dynamic-gestures.md`): the
 * Gestures section's verbs, as pure functions of the categorizer, the way `../sorting.ts` holds
 * the held categories' verbs.
 *
 * Section 4 of the design keeps sorting for gestures thin on purpose: record more (the traces of a
 * new take join a gesture, or make a new one), rename, delete, drop a trace, and merge (pool two
 * gestures' traces). No split: a player who wants two gestures records two.
 *
 * Every verb returns the same result as a sorting verb (`{ ok, categorizer }` or `{ ok: false,
 * error }`), validated by the file's schema, so the session store applies it as one undoable edit
 * exactly like a move or a merge of held categories.
 *
 * ## What a new take's traces become
 *
 * A trace carries the WHOLE live vector per frame. Joining an existing gesture, it is projected
 * onto that gesture's features (the gesture keeps what it is matched on). Making a new one, its
 * features are the take's, written with `gestureSection` (rounded, its shape stated, a fresh id
 * clear of every category's and gesture's).
 *
 * The section has ONE weights map (the noise units of a session). A second take's session has
 * its own estimate, and a weight is only a unit for a feature's distance, so the section keeps
 * the weight it already has for a feature, and takes a new take's only for a feature it did not
 * have: a later take never re-scales the gestures recorded before it.
 *
 * Trace ids are kept unique across the section (a later take of the same cue id would repeat
 * `<cue>#1`): a repeated id gets a `~n` suffix, since dropping a trace names it by id.
 *
 * ## The file's frame bound holds on save too (#954)
 *
 * An imported file may carry at most `MAX_GESTURE_FRAMES` trace frames. An edit that would GROW
 * the section past that bound is refused with the reason, so "Record more" never saves a document
 * its own export cannot re-import. An edit that does not grow it (a drop, a delete, a rename, a
 * merge) always passes, so a record saved over the bound by an older build can still be trimmed.
 *
 * Pure: categorizers and traces in, categorizers out.
 */
import { gestureFrameCount, MAX_GESTURE_FRAMES, PersonalCategorizerSchema, type CategorizerGesture, type CategorizerGestures, type PersonalCategorizer } from '../categorizer';
import type { FeatureWeights, Trace } from '../types';
import { fromStoredTrace, gestureSection, toStoredTrace } from './file';
import type { GestureShape } from './matcher';
import { GESTURE_QUALITY_DEFAULTS } from './quality';

/** What every verb returns (the sorting verbs' shape). */
export type GestureEdit = { ok: true; categorizer: PersonalCategorizer } | { ok: false; error: string };

const fail = (error: string): GestureEdit => ({ ok: false, error });

/** Why an edit may not grow `before`'s section to `after` (null: it may): past `maxFrames` trace
 *  frames, and more than it had (see the module header). */
export function framesRefusal(before: CategorizerGestures | undefined, after: CategorizerGestures | null | undefined, maxFrames: number = MAX_GESTURE_FRAMES): string | null {
  const now = gestureFrameCount(after);
  if (now <= maxFrames || now <= gestureFrameCount(before)) return null;
  return `the gestures would hold ${now} frames of movement, more than the ${maxFrames} a saved file can carry; drop or delete some repetitions first`;
}

/** `c` with `gestures` (none: the section dropped), validated; a schema error, or growth past the
 *  frame bound, is the result's. */
function withGestures(c: PersonalCategorizer, gestures: CategorizerGestures | null, maxFrames?: number): GestureEdit {
  const { gestures: _old, ...rest } = c;
  void _old;
  const refused = framesRefusal(c.gestures, gestures, maxFrames);
  if (refused) return fail(refused);
  const next = gestures && gestures.items.length > 0 ? { ...rest, gestures: { ...gestures, weights: usedWeights(gestures) } } : rest;
  try {
    return { ok: true, categorizer: PersonalCategorizerSchema.parse(next) };
  } catch (e) {
    return fail(e instanceof Error ? e.message.split('\n')[0] : String(e));
  }
}

/** The section's weights for the features its gestures still list (a deleted gesture's go). */
function usedWeights(section: CategorizerGestures): FeatureWeights {
  const listed = new Set(section.items.flatMap((g) => g.features));
  return Object.fromEntries(Object.entries(section.weights).filter(([f]) => listed.has(f)));
}

/** A gesture of `c` by id. */
const gestureOf = (c: PersonalCategorizer, id: string): CategorizerGesture | undefined => c.gestures?.items.find((g) => g.id === id);

/** The same name, ignoring case and the spaces around it. */
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `id`, or `id~n` for the smallest n not in `taken`; added to `taken`. */
function uniqueId(id: string, taken: Set<string>): string {
  let out = id;
  for (let n = 2; taken.has(out); n++) out = `${id}~${n}`;
  taken.add(out);
  return out;
}

/** Every trace id of the section. */
const traceIds = (c: PersonalCategorizer): Set<string> => new Set((c.gestures?.items ?? []).flatMap((g) => g.traces.map((t) => t.id)));

export interface AddTracesOptions {
  /** The gesture the traces join, by id ("Record more"). Absent: the gesture the traces name
   *  (their `gesture`, by name, ignoring case), or a new one of that name. */
  into?: string;
  /** The features a NEW gesture is matched on (the take's gesture cue's). */
  features: readonly string[];
  /** The take's weights (`scaleWeights` of its session's noise): used only for a feature the
   *  section has no weight for yet (see the module header). */
  weights: Readonly<FeatureWeights>;
  /** The shape a NEW gesture is written with (`gestureSection`'s default when absent). */
  shape?: GestureShape;
  /** The most trace frames the section may grow to (default `MAX_GESTURE_FRAMES`, the import
   *  door's bound). */
  maxFrames?: number;
}

/**
 * A take's traces of ONE gesture added to `c` (see the module header): into the gesture `into`
 * names, or the one called as the traces are, or a new one. A trace of fewer than two frames is
 * no path and is left out; with none left, nothing changes and the error says so.
 */
export function addGestureTraces(c: PersonalCategorizer, traces: readonly Trace[], options: AddTracesOptions): GestureEdit {
  const kept = traces.filter((t) => t.samples.length >= 2);
  if (kept.length === 0) return fail('no repetition was cut from the take');
  const label = kept[0].gesture.trim();
  if (kept.some((t) => !sameName(t.gesture, label))) return fail('the traces name more than one gesture');
  const items = c.gestures?.items ?? [];
  const target = options.into !== undefined ? gestureOf(c, options.into) : items.find((g) => sameName(g.label, label));
  if (options.into !== undefined && !target) return fail(`there is no gesture "${options.into}"`);
  const ids = traceIds(c);
  if (target) {
    const added = kept.map((t) => ({ ...toStoredTrace(t, target.features), id: uniqueId(t.id, ids) }));
    return withGestures(c, { weights: c.gestures!.weights, items: items.map((g) => (g === target ? { ...g, traces: [...g.traces, ...added] } : g)) }, options.maxFrames);
  }
  if (!label) return fail('a new gesture needs a name');
  let fresh: CategorizerGestures;
  try {
    fresh = gestureSection(kept, {
      features: options.features,
      weights: options.weights,
      taken: [...c.categories.map((x) => x.id), ...items.map((g) => g.id)],
      ...(options.shape ? { shape: options.shape } : {}),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const made = fresh.items.map((g) => ({ ...g, traces: g.traces.map((t) => ({ ...t, id: uniqueId(t.id, ids) })) }));
  // The section's weights win; the take's fill only the features it had none for.
  return withGestures(c, { weights: { ...fresh.weights, ...(c.gestures?.weights ?? {}) }, items: [...items, ...made] }, options.maxFrames);
}

/** Rename gesture `id` to `label` (trimmed). Refused when empty or another gesture's name. */
export function renameGesture(c: PersonalCategorizer, id: string, label: string): GestureEdit {
  const g = gestureOf(c, id);
  const name = label.trim();
  if (!g) return fail(`there is no gesture "${id}"`);
  if (!name) return fail('a gesture needs a name');
  const clash = c.gestures!.items.find((x) => x.id !== id && sameName(x.label, name));
  if (clash) return fail(`another gesture is already called "${clash.label}"`);
  return withGestures(c, { ...c.gestures!, items: c.gestures!.items.map((x) => (x.id === id ? { ...x, label: name } : x)) });
}

/** Delete gesture `id` with its traces (the section goes with its last gesture). */
export function deleteGesture(c: PersonalCategorizer, id: string): GestureEdit {
  if (!gestureOf(c, id)) return fail(`there is no gesture "${id}"`);
  return withGestures(c, { ...c.gestures!, items: c.gestures!.items.filter((g) => g.id !== id) });
}

/** Drop one repetition of gesture `id`. Refused for its only one: delete the gesture instead. */
export function dropGestureTrace(c: PersonalCategorizer, id: string, traceId: string): GestureEdit {
  const g = gestureOf(c, id);
  if (!g) return fail(`there is no gesture "${id}"`);
  if (!g.traces.some((t) => t.id === traceId)) return fail(`"${g.label}" has no repetition "${traceId}"`);
  if (g.traces.length === 1) return fail(`that is the only repetition of "${g.label}": delete the gesture instead`);
  return withGestures(c, { ...c.gestures!, items: c.gestures!.items.map((x) => (x === g ? { ...x, traces: x.traces.filter((t) => t.id !== traceId) } : x)) });
}

/**
 * Merge gesture `from` into `into`: every trace of both, under `into`'s id, name, features and
 * shape (a `from` trace re-projected onto them: a feature it never measured reads null). `from`
 * goes; a binding of it is not carried (it named `from`). Refused when `from` measured under
 * `minShared` of `into`'s features (the share the quality compares a pair on), so a merge never
 * pools rows that are mostly holes.
 */
export function mergeGestures(
  c: PersonalCategorizer,
  from: string,
  into: string,
  { minShared = GESTURE_QUALITY_DEFAULTS.minShared }: { minShared?: number } = {},
): GestureEdit {
  const a = gestureOf(c, from);
  const b = gestureOf(c, into);
  if (!a || !b) return fail(`there is no gesture "${!a ? from : into}"`);
  if (a === b) return fail('a gesture cannot be merged into itself');
  // The moved traces are re-projected onto the target's features: below the share the quality
  // compares a pair on, their rows would be mostly (or all) holes, a repetition of nothing.
  const own = new Set(a.features);
  const shared = b.features.filter((f) => own.has(f)).length;
  if (b.features.length === 0 || shared / b.features.length < minShared) {
    return fail(`"${a.label}" and "${b.label}" are not measured on the same features, so their repetitions cannot be pooled; record more of one instead`);
  }
  const moved = a.traces.map((t) => ({ ...toStoredTrace(fromStoredTrace(t, a.id, a.features), b.features), id: t.id }));
  return withGestures(c, {
    ...c.gestures!,
    items: c.gestures!.items.flatMap((g) => (g === a ? [] : g === b ? [{ ...g, traces: [...g.traces, ...moved] }] : [g])),
  });
}
