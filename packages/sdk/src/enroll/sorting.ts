/**
 * One editable carve (#385 E4): the edits a player makes while sorting a categorizer's holds,
 * as pure functions over the file ({@link PersonalCategorizer}, version 2), so a fresh carve, a
 * reopened saved one and an imported one are edited the same way.
 *
 * ## Moves become constraints
 *
 * Every placement the player makes is kept as a **pin** (`pins: sampleId -> category id |
 * neutral | aside`), and a re-cut honours them ({@link recut}): the holds pinned to one category
 * start as one cluster (must-link), clusters holding holds pinned to different categories never
 * merge (cannot-link), and holds in a bin stay there. So a moved hold stays where it was put,
 * a merged pair stays merged, a split stays split and a named category keeps its name, at every
 * k; and k is clamped below by the number of pinned categories. The holds the player has not
 * touched are re-cut freely.
 *
 * A re-cut is a function of the samples, the bins and the pins only (never of the previous
 * cut's unpinned categories), so going from k = 3 to 5 and back to 3 gives the k = 3 document
 * again, given the same `baseRejectRadius` (without one, the reject radius floors from the
 * categorizer's own, which a re-cut may have raised). Pinned categories keep their id and label; the others get `cat-n` ids (skipping the
 * pinned ones) and an EMPTY label, for the host to name (the face host's names are the general
 * model's, one-to-one).
 *
 * ## The invariant
 *
 * The schema says every sample is in exactly one place. These edits keep one more: a pinned
 * sample is where its pin says. A category keeps at least one hold under a move (merge it, or
 * delete the holds, to be rid of it); Delete drops a category it empties; no edit leaves a
 * categorizer with no category.
 *
 * Modality-free: nothing here knows what a feature is.
 */
import { buildConstrainedForest, buildHierarchy, cutAt, cutForest, forestRange, suggestForestK, type Forest } from './cluster';
import { TRAIN_DEFAULTS, trainModel } from './classify';
import { selectExemplars } from './exemplars';
import {
  ASIDE_BIN,
  NEUTRAL_BIN,
  PersonalCategorizerSchema,
  memberIndices,
  neutralSampleIndices,
  sampleIndex,
  toSample,
  type CategorizerSample,
  type CategorizerStrangers,
  type PersonalCategorizer,
} from './categorizer';
import type { FeatureVector } from './types';
import type { Skeleton } from './modality';

/** Where a hold can be put: a category id, or one of the two bins. */
export type Place = string;
/** The target of a move that makes a new category of the holds moved. */
export const NEW_CATEGORY = '+new';

export type SortResult = { ok: true; categorizer: PersonalCategorizer } | { ok: false; error: string };

const isBin = (to: string): boolean => to === NEUTRAL_BIN || to === ASIDE_BIN;

/** Where sample `id` is now: a category id, `neutral`, `aside`, or null if it is not a sample. */
export function placeOf(c: PersonalCategorizer, id: string): Place | null {
  for (const cat of c.categories) if (cat.members.includes(id)) return cat.id;
  if (c.neutral.includes(id)) return NEUTRAL_BIN;
  if (c.aside?.includes(id)) return ASIDE_BIN;
  return null;
}

/** A category id no category of `c` has (and not `taken`): `cat-n`, smallest n first. */
export function freshCategoryId(c: Pick<PersonalCategorizer, 'categories'>, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...c.categories.map((x) => x.id), ...taken]);
  let n = 1;
  while (used.has(`cat-${n}`)) n++;
  return `cat-${n}`;
}

/** The categories that hold at least one pinned hold (what bounds k from below). */
export function pinnedCategories(c: PersonalCategorizer): Set<string> {
  return new Set(Object.values(c.pins ?? {}).filter((to) => !isBin(to)));
}

/** Rebuild `c` from a placement (sample id -> place) and its pins, validated. Categories keep the
 *  order given; empty ones are dropped; the bins and members are kept in sample order. */
function rebuild(
  c: PersonalCategorizer,
  categories: readonly { id: string; label: string }[],
  place: ReadonlyMap<string, Place>,
  pins: Readonly<Record<string, Place>>,
  extra: Partial<PersonalCategorizer> = {},
): PersonalCategorizer {
  const members = new Map<string, string[]>(categories.map((x) => [x.id, []]));
  const neutral: string[] = [];
  const aside: string[] = [];
  for (const s of c.samples) {
    const to = place.get(s.id);
    if (to === undefined) continue;
    if (to === NEUTRAL_BIN) neutral.push(s.id);
    else if (to === ASIDE_BIN) aside.push(s.id);
    else members.get(to)?.push(s.id);
  }
  const { aside: _a, pins: _p, ...rest } = c;
  void _a;
  void _p;
  const keptPins = Object.fromEntries(Object.entries(pins).filter(([id]) => place.has(id)));
  return PersonalCategorizerSchema.parse({
    ...rest,
    ...extra,
    samples: c.samples.filter((s) => place.has(s.id)),
    categories: categories.filter((x) => (members.get(x.id)?.length ?? 0) > 0).map((x) => ({ id: x.id, label: x.label, members: members.get(x.id)! })),
    neutral,
    ...(aside.length > 0 ? { aside } : {}),
    ...(Object.keys(keptPins).length > 0 ? { pins: keptPins } : {}),
  });
}

/** Every sample's place now. */
function placement(c: PersonalCategorizer): Map<string, Place> {
  const place = new Map<string, Place>();
  for (const cat of c.categories) for (const id of cat.members) place.set(id, cat.id);
  for (const id of c.neutral) place.set(id, NEUTRAL_BIN);
  for (const id of c.aside ?? []) place.set(id, ASIDE_BIN);
  return place;
}

const fail = (error: string): SortResult => ({ ok: false, error });
const done = (run: () => PersonalCategorizer): SortResult => {
  try {
    return { ok: true, categorizer: run() };
  } catch (e) {
    return fail(e instanceof Error ? e.message.split('\n')[0] : String(e));
  }
};

export interface MoveOptions {
  /** The id a move to {@link NEW_CATEGORY} gives the new category (a fresh `cat-n` by default). */
  newId?: string;
  /** Its label (empty by default: the host names it). */
  newLabel?: string;
}

/**
 * Move holds `ids` to `to` (a category, a bin, or {@link NEW_CATEGORY}) and pin each there.
 * Refused when it would empty a category (merge it instead, or delete its holds).
 */
export function moveHolds(c: PersonalCategorizer, ids: readonly string[], to: Place, options: MoveOptions = {}): SortResult {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return fail('nothing is selected');
  const place = placement(c);
  for (const id of unique) if (!place.has(id)) return fail(`no hold "${id}"`);
  const fresh = to === NEW_CATEGORY;
  const target = fresh ? (options.newId ?? freshCategoryId(c)) : to;
  if (fresh && (c.categories.some((x) => x.id === target) || isBin(target))) return fail(`category id "${target}" is taken`);
  if (!fresh && !isBin(to) && !c.categories.some((x) => x.id === to)) return fail(`no category "${to}"`);
  const moving = new Set(unique);
  for (const cat of c.categories) {
    if (cat.id !== target && cat.members.every((id) => moving.has(id))) {
      return fail(`"${cat.label || cat.id}" would be left with no hold; a category keeps at least one (merge it, or delete its holds)`);
    }
  }
  return done(() => {
    const pins = { ...(c.pins ?? {}) };
    for (const id of unique) {
      place.set(id, target);
      pins[id] = target;
    }
    const categories = [...c.categories.map((x) => ({ id: x.id, label: x.label })), ...(fresh ? [{ id: target, label: options.newLabel ?? '' }] : [])];
    return rebuild(c, categories, place, pins);
  });
}

/** Holds given a name before they were taken (#385 E7). */
export interface LabelledHolds {
  label: string;
  ids: readonly string[];
}

/**
 * Labelled holds (#385 E7, "B for discovery, A for confirmation" made one gesture): a burst
 * recorded under a typed name. Each group's holds go to the category already called `label`
 * (case-insensitively), else to a new category of that name, and are PINNED there, so they stay
 * one category at every k (a re-cut's must-link). A label equal to `neutralLabel` (the modality's
 * word for "none of these") puts them in the Neutral bin. A category the move empties is dropped
 * (its holds were all relabelled). Refused when no category would be left.
 */
export function placeLabelled(c: PersonalCategorizer, groups: readonly LabelledHolds[], { neutralLabel }: { neutralLabel?: string } = {}): SortResult {
  const named = groups.map((g) => ({ label: g.label.trim(), ids: [...new Set(g.ids)] })).filter((g) => g.label !== '' && g.ids.length > 0);
  if (named.length === 0) return { ok: true, categorizer: c };
  const place = placement(c);
  for (const g of named) for (const id of g.ids) if (!place.has(id)) return fail(`no hold "${id}"`);
  const key = (label: string) => label.toLowerCase();
  const neutralKey = neutralLabel ? key(neutralLabel.trim()) : null;
  const categories = c.categories.map((x) => ({ id: x.id, label: x.label }));
  const taken = new Set<string>();
  const pins = { ...(c.pins ?? {}) };
  for (const g of named) {
    let to: Place;
    if (neutralKey !== null && key(g.label) === neutralKey) to = NEUTRAL_BIN;
    else {
      const found = categories.find((x) => key(x.label.trim()) === key(g.label));
      if (found) to = found.id;
      else {
        to = freshCategoryId({ categories: categories.map((x) => ({ ...x, members: [] })) }, taken);
        taken.add(to);
        categories.push({ id: to, label: g.label });
      }
    }
    for (const id of g.ids) {
      place.set(id, to);
      pins[id] = to;
    }
  }
  const left = categories.filter((x) => [...place.values()].includes(x.id));
  if (left.length === 0) return fail('that would leave no category; a categorizer keeps at least one');
  return done(() => rebuild(c, categories, place, pins));
}

/** Delete holds `ids` (a sneeze, a look away): gone from the samples, their bins and their pins;
 *  a category they empty goes with them. Refused when no category would be left. */
export function deleteHolds(c: PersonalCategorizer, ids: readonly string[]): SortResult {
  const gone = new Set(ids);
  if (gone.size === 0) return fail('nothing is selected');
  const place = placement(c);
  for (const id of gone) if (!place.has(id)) return fail(`no hold "${id}"`);
  if (c.categories.every((cat) => cat.members.every((id) => gone.has(id)))) return fail('that would leave no category; a categorizer keeps at least one');
  return done(() => {
    for (const id of gone) place.delete(id);
    const pins = Object.fromEntries(Object.entries(c.pins ?? {}).filter(([id]) => !gone.has(id)));
    return rebuild(c, c.categories, place, pins);
  });
}

/** Merge category `from` into `into`: one category with both's holds, every one pinned to it (a
 *  merged pair stays merged at every k). `into` keeps its id and label. `into` may be the Neutral
 *  bin (#444, a face the quiz keeps missing given up as "none of these"): every hold of `from`
 *  goes to Neutral, pinned there, and the category is dropped; refused for the last category. */
export function mergeCategories(c: PersonalCategorizer, from: string, into: string): SortResult {
  if (from === into) return fail('a category cannot merge with itself');
  if (into === NEUTRAL_BIN) {
    const gone = c.categories.find((x) => x.id === from);
    if (!gone) return fail(`no category "${from}"`);
    if (c.categories.length === 1) return fail('that would leave no category; a categorizer keeps at least one');
    return done(() => {
      const place = placement(c);
      const pins = { ...(c.pins ?? {}) };
      for (const id of gone.members) {
        place.set(id, NEUTRAL_BIN);
        pins[id] = NEUTRAL_BIN;
      }
      return rebuild(c, c.categories.filter((x) => x.id !== from), place, pins);
    });
  }
  const a = c.categories.find((x) => x.id === from);
  const b = c.categories.find((x) => x.id === into);
  if (!a || !b) return fail(`no category "${!a ? from : into}"`);
  return done(() => {
    const place = placement(c);
    const pins = { ...(c.pins ?? {}) };
    for (const id of [...a.members, ...b.members]) {
      place.set(id, into);
      pins[id] = into;
    }
    return rebuild(c, c.categories.filter((x) => x.id !== from), place, pins);
  });
}

/**
 * Split category `id` in two: its own holds cut at 2 by the same average-linkage hierarchy (its
 * pins inside it set aside: a split is the player overruling them). The larger half keeps the id
 * and the label; the other is a new category with an empty label (`options.newId`, a fresh
 * `cat-n` by default), placed right after it. Both halves are pinned, so the split survives a
 * re-cut. Refused for a category of one hold.
 */
export function splitCategory(c: PersonalCategorizer, id: string, options: Pick<MoveOptions, 'newId'> = {}): SortResult {
  const cat = c.categories.find((x) => x.id === id);
  if (!cat) return fail(`no category "${id}"`);
  if (cat.members.length < 2) return fail(`"${cat.label || cat.id}" has one hold; there is nothing to split`);
  const newId = options.newId ?? freshCategoryId(c);
  if (c.categories.some((x) => x.id === newId) || isBin(newId)) return fail(`category id "${newId}" is taken`);
  const at = sampleIndex(c);
  const vectors = cat.members.map((m) => c.samples[at.get(m)!].vector);
  const halves = cutAt(buildHierarchy(vectors, c.features, c.weights), 2).map((h) => h.map((j) => cat.members[j]));
  if (halves.length < 2) return fail(`"${cat.label || cat.id}" cannot be split: its holds are all alike`);
  const [keep, other] = halves[0].length >= halves[1].length ? halves : [halves[1], halves[0]];
  return done(() => {
    const place = placement(c);
    const pins = { ...(c.pins ?? {}) };
    for (const m of keep) pins[m] = id;
    for (const m of other) {
      place.set(m, newId);
      pins[m] = newId;
    }
    const categories = c.categories.flatMap((x) => (x.id === id ? [{ id, label: x.label }, { id: newId, label: '' }] : [{ id: x.id, label: x.label }]));
    return rebuild(c, categories, place, pins);
  });
}

/** The most typical hold of category `id` (its medoid), or null. */
export function medoidOf(c: PersonalCategorizer, id: string): string | null {
  const cat = c.categories.find((x) => x.id === id);
  if (!cat) return null;
  const at = sampleIndex(c);
  const vectors = c.samples.map((s) => s.vector);
  const members = cat.members.map((m) => at.get(m)!);
  const [first] = selectExemplars(c, { centroid: meanOver(members.map((j) => vectors[j]), c.features), members }, vectors, { count: 1 });
  return first ? c.samples[first.index].id : null;
}

function meanOver(vectors: readonly FeatureVector[], features: readonly string[]): FeatureVector {
  const out: FeatureVector = {};
  for (const f of features) {
    let s = 0;
    let n = 0;
    for (const v of vectors) {
      if (Number.isFinite(v[f])) {
        s += v[f];
        n++;
      }
    }
    if (n > 0) out[f] = s / n;
  }
  return out;
}

/**
 * Name category `id` `label`, and anchor it: unless it already holds a pinned hold, its most
 * typical hold is pinned to it, so the name stays with that face at every k. Refused when another
 * category is already called that (case-insensitively).
 */
export function nameCategory(c: PersonalCategorizer, id: string, label: string): SortResult {
  const name = label.trim();
  if (!name) return fail('a name cannot be empty');
  const cat = c.categories.find((x) => x.id === id);
  if (!cat) return fail(`no category "${id}"`);
  const clash = c.categories.find((x) => x.id !== id && x.label.trim().toLowerCase() === name.toLowerCase());
  if (clash) return fail(`another category is already called "${clash.label}"`);
  return done(() => {
    const pins = { ...(c.pins ?? {}) };
    if (!cat.members.some((m) => pins[m] === id)) {
      const anchor = medoidOf(c, id);
      if (anchor) pins[anchor] = id;
    }
    return rebuild(
      c,
      c.categories.map((x) => ({ id: x.id, label: x.id === id ? name : x.label })),
      placement(c),
      pins,
    );
  });
}

export interface RecutOptions {
  /**
   * Where the UNPINNED holds outside the carve go: those in this set to `neutral`, every other
   * unpinned hold (but a set-aside one) into the carve. A fresh take passes its rest cloud (the
   * reject mode's neutral) or an empty set (partition). Without it, unpinned holds stay in
   * the bin they are in, and only the category holds are re-cut (a saved categorizer).
   */
  neutral?: ReadonlySet<string>;
  /** The rest take's frames, for the reject radius (as the carve trains it). */
  rest?: readonly FeatureVector[];
  /** The reject radius before the training-data floor, when there is no rest (default: the
   *  categorizer's own). Pass the radius it was opened with, so k up and down does not drift. */
  baseRejectRadius?: number;
}

/** The range of k a re-cut of `c` allows, and the k the merge gaps suggest. */
export interface RecutRange {
  minK: number;
  maxK: number;
  suggestedK: number;
}

/** Which holds a re-cut carves (indices into `samples`), its must-link groups (pool positions,
 *  by pinned category), and where the others stay. */
function recutPool(c: PersonalCategorizer, options: RecutOptions) {
  const pins = c.pins ?? {};
  const now = placement(c);
  const bins = new Map<string, Place>();
  const pool: number[] = [];
  const groups = new Map<string, number[]>();
  c.samples.forEach((s, i) => {
    const pin = pins[s.id];
    const at = now.get(s.id)!;
    let to: Place | null;
    if (pin !== undefined) to = isBin(pin) ? pin : null;
    else if (at === ASIDE_BIN) to = ASIDE_BIN;
    else if (options.neutral) to = options.neutral.has(s.id) ? NEUTRAL_BIN : null;
    else to = isBin(at) ? at : null;
    if (to !== null) {
      bins.set(s.id, to);
      return;
    }
    if (pin !== undefined) {
      const g = groups.get(pin) ?? [];
      g.push(pool.length);
      groups.set(pin, g);
    }
    pool.push(i);
  });
  return { pool, bins, groups };
}

/** How many forests are kept (a host asks for the range, then cuts the same pool). */
export const FOREST_CACHE_SIZE = 8;
const forests = new Map<string, Forest>();

/**
 * The forest a re-cut cuts. Building it is quadratic in the pool (#420), and it depends on the pool's
 * vectors, the must-link groups and the feature space only (never on k), so it is cached on
 * exactly that: the range shown after an edit and the cut that follows share one build.
 */
function recutPlan(c: PersonalCategorizer, options: RecutOptions) {
  const { pool, bins, groups } = recutPool(c, options);
  const order = [...groups.keys()];
  const mustLink = order.map((k) => groups.get(k)!);
  const key = JSON.stringify([c.features, c.features.map((f) => c.weights[f] ?? 1), pool.map((i) => c.features.map((f) => c.samples[i].vector[f] ?? null)), mustLink]);
  let forest = forests.get(key);
  if (forest) forests.delete(key);
  else forest = buildConstrainedForest(pool.map((i) => c.samples[i].vector), c.features, c.weights, { mustLink });
  forests.set(key, forest);
  while (forests.size > FOREST_CACHE_SIZE) forests.delete(forests.keys().next().value!);
  return { pool, bins, forest, groupIds: order, groups };
}

/**
 * What k a re-cut of `c` can take, without building the forest (cheap: a host shows it on every
 * edit): one category per pinned category (at least one), up to one per free hold plus one per
 * pinned category. `pool` is how many holds a re-cut would carve.
 */
export function recutBounds(c: PersonalCategorizer, options: RecutOptions = {}): { minK: number; maxK: number; pool: number } {
  const { pool, groups } = recutPool(c, options);
  if (pool.length === 0) return { minK: 0, maxK: 0, pool: 0 };
  const grouped = [...groups.values()].reduce((n, g) => n + g.length, 0);
  return { minK: Math.max(1, groups.size), maxK: pool.length - grouped + groups.size, pool: pool.length };
}

/** What k a re-cut of `c` (with `options`) can take, and suggests (this builds the forest). */
export function recutRange(c: PersonalCategorizer, options: RecutOptions = {}): RecutRange {
  const { forest } = recutPlan(c, options);
  return { ...forestRange(forest), suggestedK: suggestForestK(forest) };
}

/**
 * Re-cut `c` at `k` (clamped to {@link recutRange}) honouring its pins. Pinned categories keep
 * their id and label; the other categories are new (`cat-n`, empty labels, for the host to
 * name). Under `strangers: neutral` the reject radius is trained again on the new categories
 * (the rest's spread, or `baseRejectRadius`, floored to accept the training holds), as the carve
 * does. Refused when there is nothing to carve.
 */
export function recut(c: PersonalCategorizer, k: number, options: RecutOptions = {}): SortResult {
  const { pool, bins, forest, groups } = recutPlan(c, options);
  if (pool.length === 0) return fail('every hold is in a bin; there is nothing to carve');
  const clusters = cutForest(forest, k).map((cl) => cl.map((j) => pool[j]));
  const groupOf = new Map<number, string>();
  for (const [catId, g] of groups) for (const j of g) groupOf.set(pool[j], catId);
  const pinnedIds = new Set(groups.keys());
  const labelOf = new Map(c.categories.map((x) => [x.id, x.label]));
  const categories: { id: string; label: string }[] = [];
  const taken = new Set(pinnedIds);
  const place = new Map<string, Place>(bins);
  for (const cl of clusters) {
    const pinned = cl.map((i) => groupOf.get(i)).find((x) => x !== undefined);
    let id: string;
    if (pinned !== undefined) id = pinned;
    else {
      id = freshCategoryId({ categories: [] }, taken);
      taken.add(id);
    }
    categories.push({ id, label: pinned !== undefined ? (labelOf.get(pinned) ?? '') : '' });
    for (const i of cl) place.set(c.samples[i].id, id);
  }
  return done(() => {
    let extra: Partial<PersonalCategorizer> = {};
    if (c.strangers === 'neutral') {
      const vectors = c.samples.map((s) => s.vector);
      const trained = trainModel(vectors, clusters, c.features, c.weights, {
        restVectors: options.rest ?? [],
        defaultRejectRadius: options.baseRejectRadius ?? c.rejectRadius,
      });
      extra = { rejectRadius: trained.rejectRadius };
    }
    return rebuild(c, categories, place, c.pins ?? {}, extra);
  });
}

/**
 * Say what a face nobody taught reads as (#385 E5): the one strangers switch. `nearest` (it
 * reads as the nearest category, or Neutral when Neutral is nearer) drops the reject radius;
 * `neutral` (a face far from every category reads as Neutral) trains one, as a re-cut does: the
 * spread of `rest` (the rest take's frames), else of the Neutral holds, else `baseRejectRadius`
 * or the categorizer's own, floored to accept the categories' holds. Nothing is re-cut and no hold
 * moves: Neutral is taught by example in both settings.
 */
export function setStrangers(c: PersonalCategorizer, strangers: CategorizerStrangers, options: Pick<RecutOptions, 'rest' | 'baseRejectRadius'> = {}): SortResult {
  if (c.strangers === strangers) return { ok: true, categorizer: c };
  return done(() => {
    const { rejectRadius: _r, ...rest } = c;
    void _r;
    if (strangers === 'nearest') return PersonalCategorizerSchema.parse({ ...rest, strangers });
    const vectors = c.samples.map((x) => x.vector);
    const restVectors = options.rest ?? neutralSampleIndices(c).map((i) => vectors[i]);
    const trained = trainModel(vectors, memberIndices(c), c.features, c.weights, {
      restVectors,
      defaultRejectRadius: options.baseRejectRadius ?? c.rejectRadius ?? TRAIN_DEFAULTS.defaultRejectRadius,
    });
    return PersonalCategorizerSchema.parse({ ...rest, strangers, rejectRadius: trained.rejectRadius });
  });
}

/** Train (or stop training) the Neutral holds as the null class (#385 E5): what an older file,
 *  migrated with them untrained, is offered. */
export function setNeutralTrained(c: PersonalCategorizer, on: boolean): SortResult {
  return c.neutralTrained === on ? { ok: true, categorizer: c } : done(() => PersonalCategorizerSchema.parse({ ...c, neutralTrained: on }));
}

/** The ids of the samples at `indices` (for a host that addresses holds by position). */
export const sampleIds = (c: PersonalCategorizer, indices: readonly number[]): string[] => indices.flatMap((i) => (c.samples[i] ? [c.samples[i].id] : []));

/** `c` with the pins that disagree with where their hold is dropped (a hand-edited or older file
 *  may carry some; a re-cut would otherwise move those holds without a word). */
export function consistentPins(c: PersonalCategorizer): PersonalCategorizer {
  if (!c.pins) return c;
  const kept = Object.fromEntries(Object.entries(c.pins).filter(([id, to]) => placeOf(c, id) === to));
  if (Object.keys(kept).length === Object.keys(c.pins).length) return c;
  const { pins: _p, ...rest } = c;
  void _p;
  return Object.keys(kept).length > 0 ? { ...rest, pins: kept } : rest;
}

/**
 * `c` with every NAMED category that holds no pinned hold anchored (its most typical hold pinned
 * to it), so a re-cut keeps its name: what a categorizer saved before pins existed needs, since
 * its names are the player's but nothing pins them. `named` picks which categories count
 * (every category with a label by default).
 */
export function anchorNames(c: PersonalCategorizer, named: (category: PersonalCategorizer['categories'][number]) => boolean = (x) => x.label.trim() !== ''): PersonalCategorizer {
  const pins = { ...(c.pins ?? {}) };
  let changed = false;
  for (const cat of c.categories) {
    if (!named(cat) || cat.members.some((m) => pins[m] === cat.id)) continue;
    const anchor = medoidOf(c, cat.id);
    if (anchor) {
      pins[anchor] = cat.id;
      changed = true;
    }
  }
  return changed ? { ...c, pins } : c;
}

/** Whether `c` keeps the E4 invariant: every pinned hold is where its pin says. */
export function pinsHold(c: PersonalCategorizer): boolean {
  return Object.entries(c.pins ?? {}).every(([id, to]) => placeOf(c, id) === to);
}

/** What turning the mirror on needs of a modality (#459): its mirror image, which side a vector
 *  leans to (the mirror image has the opposite sign), and its stick figure, if it draws one. */
export interface MirrorTools {
  image(vector: FeatureVector): FeatureVector;
  side(vector: FeatureVector): number;
  skeleton?(vector: FeatureVector): Skeleton | null;
}

export interface MirrorOnOptions extends RecutOptions {
  /** Which named categories' names a merged cut may carry (the player's own; default every
   *  named one). A name not carried is left empty, for the host to name in the mirror's words. */
  carry?: (category: PersonalCategorizer['categories'][number]) => boolean;
  /** The most categories the cut may make (default: no bound beyond the forest's). */
  maxCategories?: number;
}

/** A feature's mirror twin (one-to-one: the mirror image of a vector with only that feature has
 *  only the twin's key); the feature itself when the image keeps or drops it. */
function twinOf(tools: MirrorTools, feature: string): string {
  const keys = Object.keys(tools.image({ [feature]: 0.25 }));
  return keys.length === 1 ? keys[0] : feature;
}

/** A sample's supporting rows as vectors over `features` (null cells left out). */
function supportVectors(s: CategorizerSample, features: readonly string[]): FeatureVector[] | undefined {
  return s.support?.map((row) => {
    const v: FeatureVector = {};
    features.forEach((f, i) => {
      if (row[i] !== null && row[i] !== undefined) v[f] = row[i]!;
    });
    return v;
  });
}

/** A hold over the mirrored feature list `features`, read on the other side when `flip`: its
 *  vector, its supporting frames (rows over `features`) and its stick figure. */
function remappedSample(c: PersonalCategorizer, s: CategorizerSample, tools: MirrorTools, features: readonly string[], flip: boolean): CategorizerSample {
  const rows = supportVectors(s, c.features);
  if (!flip) return toSample({ id: s.id, vector: s.vector, t: s.t, cue: s.cue, support: rows, skeleton: s.skeleton ?? null }, features);
  const vector = tools.image(s.vector);
  const skeleton = s.skeleton ? tools.skeleton?.(vector) ?? null : null;
  return toSample({ id: s.id, vector, t: s.t, cue: s.cue, support: rows?.map((r) => tools.image(r)), skeleton }, features);
}

/**
 * Turn the mirror on after the take (#459): left and right become one pose, as if the take had been
 * recorded with the mirror on, which reads every hold on ONE side (`canonicalPose`): each hold that leans the other
 * way (`side < 0`) is replaced by its mirror image (vector, supporting frames, stick figure), the
 * feature list gains each feature's mirror twin, and the categorizer re-cut at the k its merge gaps suggest, so "left arm out" and "right arm out"
 * fall together. The bins (Neutral, set aside) keep their pins; the category pins are released,
 * since they kept apart the very sides that are now one (that is what a merge needs). A name
 * comes along only where it is unambiguous: a new category takes the name of the one named
 * category (`carry`) most of whose holds it now holds and that is most of it; a merged pair's
 * category is left unnamed, for the host to name (its general model then speaks of one side).
 * Turning it back off is not offered: which side each hold was on is not kept.
 */
export function mirrorOn(c: PersonalCategorizer, tools: MirrorTools, options: MirrorOnOptions = {}): SortResult {
  if (c.mirror) return fail('left and right are already the same pose');
  const { carry = (x) => x.label.trim() !== '', maxCategories = Infinity, ...recutOptions } = options;
  // The feature list gains each feature's twin: a feature picked on one
  // side (the moving arm's) would otherwise see only the still arm once its holds are mirrored,
  // and the categories would collapse onto each other (#459 review). Rows are kept over it.
  const features = [...c.features];
  const weights = { ...c.weights };
  for (const f of c.features) {
    const t = twinOf(tools, f);
    if (features.includes(t)) continue;
    features.push(t);
    // Its own noise weight when the take measured one, else its partner's.
    if (!Object.hasOwn(c.weights, t) && Object.hasOwn(c.weights, f)) weights[t] = c.weights[f];
  }
  const samples = c.samples.map((s) => remappedSample(c, s, tools, features, tools.side(s.vector) < 0));
  const binPins = Object.fromEntries(Object.entries(c.pins ?? {}).filter(([, to]) => isBin(to)));
  const { pins: _p, ...rest } = c;
  void _p;
  let base: PersonalCategorizer;
  try {
    base = PersonalCategorizerSchema.parse({ ...rest, features, weights, samples, mirror: true, ...(Object.keys(binPins).length > 0 ? { pins: binPins } : {}) });
  } catch (e) {
    return fail(e instanceof Error ? e.message.split('\n')[0] : String(e));
  }
  const { suggestedK } = recutRange(base, recutOptions);
  const cut = recut(base, Math.min(suggestedK, maxCategories), recutOptions);
  if (!cut.ok) return cut;
  // Names, one-to-one: old category -> the new one holding most of its holds, and back.
  const oldOf = placement(c);
  const named = c.categories.filter(carry);
  const home = new Map<string, string>();
  for (const old of named) {
    const counts = new Map<string, number>();
    for (const id of old.members) {
      const to = placeOf(cut.categorizer, id);
      if (to && !isBin(to)) counts.set(to, (counts.get(to) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] * 2 > old.members.length) home.set(old.id, best[0]);
  }
  const carried = cut.categorizer.categories.map((cat) => {
    const claims = named.filter((o) => home.get(o.id) === cat.id);
    if (claims.length !== 1) return { cat, from: null };
    const from = claims[0];
    const share = cat.members.filter((id) => oldOf.get(id) === from.id).length;
    return { cat, from: share * 2 > cat.members.length ? from : null };
  });
  // A carried name keeps its old category id too (what a host keys a name's origin and a size
  // by); a new category that happens to have that id makes way.
  const keptIds = new Set(carried.flatMap((x) => (x.from ? [x.from.id] : [])));
  const taken = new Set(keptIds);
  const categories = carried.map(({ cat, from }) => {
    if (from) return { ...cat, id: from.id, label: from.label };
    if (!keptIds.has(cat.id)) {
      taken.add(cat.id);
      return cat;
    }
    const id = freshCategoryId({ categories: cut.categorizer.categories }, taken);
    taken.add(id);
    return { ...cat, id };
  });
  return done(() => PersonalCategorizerSchema.parse({ ...cut.categorizer, categories }));
}
