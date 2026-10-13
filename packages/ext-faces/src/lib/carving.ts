/**
 * What the category grid shows for one carve of a face take (#330 P2), computed purely: the
 * model at k in the chosen mode, a name per category, and the exemplar samples to show.
 *
 * - **Carving** is `createCarver` (the SDK): `partition` carves every held face, so k counts
 *   neutral too; `reject` sets the faces inside the rest cloud aside first, so k counts the
 *   expressions and neutral is "none of these". A carver is built once per mode and re-cut at
 *   any k without recording again.
 * - **Names**, in order of authority: the names the player typed ({@link TypedName}: kept by
 *   the caller OUTSIDE any one view, each with the centroid it was typed on, and carried onto
 *   the nearest category of every carve, one-to-one, so a name dropped at a small k comes back
 *   at a larger one); in partition mode,
 *   "neutral" for the category that is mostly rest-cloud faces; then the general expression
 *   model's one-to-one proposal (`matchLabels` over `generalFaceLabeling`), scored on each
 *   category's FULL-space mean (the model's own centroid keeps only its chosen features, which
 *   may drop the very blendshapes the general model reads); then `expression n`.
 * - **Exemplars** are the SDK's (the medoid first, then members toward the edge), indices into
 *   the session's still-points; the neutral faces get a row of their own in `reject` mode.
 */
// Deep imports, never the `enroll` barrel: the barrel re-exports the trainer's projection
// (umap-js), which this extension does not use.
import { applyLabels, matchLabels, type LabelMatch } from '@thoremin/sdk/enroll/match';
import { createCarver, neutralIndices, type Carver } from '@thoremin/sdk/enroll/carve';
import { categorizerMode, modelFromCategorizer, type CategorizerMode, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { carryLabels } from '@thoremin/sdk/enroll/from_model';
import { weightedDistance } from '@thoremin/sdk/enroll/cluster';
import { exemplarsByCategory, selectExemplars, type Exemplar } from '@thoremin/sdk/enroll/exemplars';
import type { FeatureVector, TrainedModel } from '@thoremin/sdk/enroll/types';
import type { Session } from '@thoremin/sdk/enroll/session';
import { isNeutralLabel, type CarveModality, type GeneralLabeling } from '@thoremin/sdk/enroll/modality';
import { faceModality } from '@thoremin/sdk/features/modalities/face';

/** The default name of the category that is mostly the player's resting face (partition mode). */
export const NEUTRAL_LABEL = faceModality.words.neutral;
/** The name nothing else fits: `expression 3`. */
export const fallbackName = (i: number): string => faceModality.words.fallback(i);

/** No general model: every category the player did not name gets its fallback name. */
const NO_GENERAL: GeneralLabeling = { labels: [], score: () => ({}) };

/** How a category's name came about, for the grid (an edited name is the player's). */
export type NameSource = 'edited' | 'neutral' | LabelMatch['source'];

export interface CarvedCategory {
  id: string;
  label: string;
  source: NameSource;
  /** The general model's label this name came from (null when it did not). */
  matched: string | null;
  size: number;
  exemplars: readonly Exemplar[];
}

export interface CarveView {
  mode: CategorizerMode;
  k: number;
  suggestedK: number;
  maxK: number;
  /** `reject` only: whether a rest take decided what neutral is. */
  neutralKnown: boolean;
  /** The model at k, named. */
  model: TrainedModel;
  categories: readonly CarvedCategory[];
  /** `reject`: the faces set aside as neutral, and the few to show. Empty in `partition`. */
  neutral: { count: number; exemplars: readonly number[] };
}

/** A name the player typed, with the centroid (session units) of the category it was typed on. */
export interface TypedName {
  label: string;
  centroid: FeatureVector;
}

export interface CarveInput {
  session: Pick<Session, 'points' | 'features' | 'weights' | 'modelFor'>;
  restVectors: readonly FeatureVector[];
  /** A carver per mode, cached by the caller (`carverFor`). */
  carver: Carver;
  k: number;
  /** The names the player typed, distinct (case-insensitively); each lands on the nearest
   *  category of this carve, one-to-one, or waits for a carve with room for it. */
  typed?: readonly TypedName[];
  /** Exemplars per category. */
  exemplarCount?: number;
  /** What was carved (the face by default): its neutral name, general model and fallback names. */
  modality?: CarveModality;
}

/** A carver for a built take, one per mode. */
export function carverFor(session: CarveInput['session'], restVectors: readonly FeatureVector[], mode: CategorizerMode): Carver {
  return createCarver(session, { mode, restVectors });
}

/** The mean of the raw vectors at `indices`, over every finite key they carry. */
export function fullMean(vectors: readonly FeatureVector[], indices: readonly number[]): FeatureVector {
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  for (const i of indices) {
    const v = vectors[i];
    if (!v) continue;
    for (const [k, x] of Object.entries(v)) {
      if (!Number.isFinite(x)) continue;
      sum[k] = (sum[k] ?? 0) + x;
      n[k] = (n[k] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.keys(sum).map((k) => [k, sum[k] / n[k]]));
}

export function carveView(input: CarveInput): CarveView {
  const { session, carver, restVectors } = input;
  const points = session.points();
  const vectors = points.map((p) => p.vector);
  const fresh = carver.modelAt(input.k);
  const typed = input.typed ?? [];
  const modality = input.modality ?? faceModality;
  const neutralLabel = modality.words.neutral;

  // 1. The player's names, carried onto the nearest category (one-to-one).
  const sources = new Map<string, NameSource>();
  let model = fresh;
  if (typed.length > 0) {
    const mine = { categories: typed.map((t, i) => ({ id: `typed-${i}`, label: t.label, centroid: t.centroid, size: 0, radius: 0, members: [] })) };
    // Only the categories that took one of the player's names; the rest stay unnamed (the
    // matcher's fallback names would read as the player's).
    const carried = carryLabels(mine, fresh, { maxDistance: Number.POSITIVE_INFINITY }).filter((m) => m.source === 'matched');
    model = applyLabels(fresh, carried);
    for (const m of carried) sources.set(m.id, 'edited');
  }

  // 2. Partition mode: the category that is mostly resting face is "neutral" by default.
  if (carver.mode === 'partition' && !model.categories.some((c) => isNeutralLabel(modality, c.label))) {
    const rest = neutralIndices(vectors, restVectors, session.features(), session.weights());
    if (rest && rest.length > 0) {
      const isRest = new Set(rest);
      let best: { id: string; share: number } | null = null;
      for (const c of model.categories) {
        if (sources.has(c.id)) continue;
        const share = c.members.filter((j) => isRest.has(j)).length / Math.max(1, c.members.length);
        if (share >= 0.5 && (!best || share > best.share)) best = { id: c.id, share };
      }
      if (best) {
        model = applyLabels(model, [{ id: best.id, label: neutralLabel }]);
        sources.set(best.id, 'neutral');
      }
    }
  }

  // 3. The modality's general model names the rest, one-to-one, on full-space means.
  const labeling = modality.general?.() ?? NO_GENERAL;
  const scored = model.categories.map((c) => ({ id: c.id, label: c.label, centroid: fullMean(vectors, c.members) }));
  const matches = matchLabels(scored, { ...labeling, fallback: modality.words.fallback });
  model = applyLabels(model, matches);
  const byId = new Map(matches.map((m) => [m.id, m]));

  const exemplars = exemplarsByCategory(model, vectors, { count: input.exemplarCount });
  const categories: CarvedCategory[] = model.categories.map((c) => {
    const m = byId.get(c.id);
    return {
      id: c.id,
      label: c.label,
      source: sources.get(c.id) ?? m?.source ?? 'fallback',
      matched: sources.has(c.id) ? null : (m?.matched ?? null),
      size: c.size,
      exemplars: exemplars[c.id] ?? [],
    };
  });

  let neutral: CarveView['neutral'] = { count: 0, exemplars: [] };
  if (carver.mode === 'reject' && carver.neutral.length > 0) {
    const members = [...carver.neutral];
    const centroid = fullMean(vectors, members);
    const ex = selectExemplars(model, { centroid, members }, vectors, { count: input.exemplarCount });
    neutral = { count: members.length, exemplars: ex.map((e) => e.index) };
  }

  return {
    mode: carver.mode,
    k: model.categories.length,
    suggestedK: carver.suggestedK(),
    maxK: carver.maxK(),
    neutralKnown: carver.neutralKnown,
    model,
    categories,
    neutral,
  };
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The typed names after the player names category `id` of `view` as `label`: the category's old
 * typed name (if it had one) and any typed name equal to `label` are replaced by the new one, on
 * this category's centroid. `null` when another category of this view already carries `label`
 * as the player's name: two categories of one player never share a name.
 */
export function withTypedName(typed: readonly TypedName[], view: Pick<CarveView, 'model' | 'categories'>, id: string, label: string): TypedName[] | null {
  const name = label.trim();
  const cat = view.model.categories.find((c) => c.id === id);
  if (!name || !cat) return null;
  if (view.categories.some((c) => c.id !== id && c.source === 'edited' && same(c.label, name))) return null;
  const old = view.categories.find((c) => c.id === id);
  return [
    ...typed.filter((t) => !same(t.label, name) && !(old?.source === 'edited' && same(t.label, old.label))),
    { label: name, centroid: cat.centroid },
  ];
}

/** How each category of the working categorizer got its name (by category id), for the grid. */
export type NameSources = ReadonlyMap<string, { source: NameSource; matched: string | null }>;

export interface NameCarveInput {
  /** What was carved (the face by default). */
  modality?: CarveModality;
  /** The sources known so far: a category keeps its entry while its label is kept. */
  sources?: NameSources;
  /** A fresh take's rest cloud (hold ids): under `strangers: nearest` the unnamed category that
   *  is mostly these is called neutral, as `carveView` does. */
  restCloud?: ReadonlySet<string>;
}

/**
 * Name the UNNAMED categories of a working categorizer (#385 E4: a re-cut, a split or a new
 * category leaves its new categories with an empty label): the neutral rule, then the modality's
 * general model one-to-one on full-space means, then the fallback, never a name another category
 * has. A named category keeps its name and its source (`kept` when none is known).
 */
export function nameCarve(c: PersonalCategorizer, input: NameCarveInput = {}): { categorizer: PersonalCategorizer; sources: Map<string, { source: NameSource; matched: string | null }> } {
  const modality = input.modality ?? faceModality;
  const known = input.sources ?? new Map();
  const sources = new Map<string, { source: NameSource; matched: string | null }>();
  for (const cat of c.categories) if (cat.label.trim()) sources.set(cat.id, known.get(cat.id) ?? { source: 'kept', matched: null });
  if (sources.size === c.categories.length) return { categorizer: c, sources };
  const vectors = c.samples.map((s) => s.vector);
  const at = new Map(c.samples.map((s, i) => [s.id, i]));
  const labels = new Map(c.categories.map((cat) => [cat.id, cat.label]));
  if (c.strangers === 'nearest' && input.restCloud && input.restCloud.size > 0 && !c.categories.some((cat) => isNeutralLabel(modality, cat.label))) {
    let best: { id: string; share: number } | null = null;
    for (const cat of c.categories) {
      if (cat.label.trim()) continue;
      const share = cat.members.filter((m) => input.restCloud!.has(m)).length / cat.members.length;
      if (share >= 0.5 && (!best || share > best.share)) best = { id: cat.id, share };
    }
    if (best) {
      labels.set(best.id, modality.words.neutral);
      sources.set(best.id, { source: 'neutral', matched: null });
    }
  }
  const labeling = modality.general?.() ?? NO_GENERAL;
  const scored = c.categories.map((cat) => ({ id: cat.id, label: labels.get(cat.id)!, centroid: fullMean(vectors, cat.members.map((m) => at.get(m)!)) }));
  for (const m of matchLabels(scored, { ...labeling, fallback: modality.words.fallback })) {
    if (sources.has(m.id)) continue;
    labels.set(m.id, m.label);
    sources.set(m.id, { source: m.source, matched: m.matched });
  }
  return { categorizer: { ...c, categories: c.categories.map((cat) => ({ ...cat, label: labels.get(cat.id)! })) }, sources };
}

/** One bin of the sorting view: its holds (indices into the samples), most typical first. */
export interface SortedBin {
  count: number;
  exemplars: readonly number[];
}

/** The sorting view (#385 E4): every hold shown, the bins, the pins and the range of k. */
export interface SortingView extends CarveView {
  /** The smallest k a re-cut allows (the pinned categories). */
  minK: number;
  aside: SortedBin;
  /** Sample indices the player placed (pinned). */
  pinned: ReadonlySet<number>;
  /** Every sample's id, by index (what the indices above, and the stills, are keyed by). */
  ids: readonly string[];
  /** Whether k can be re-cut here (false when the pool is too large to re-cut at once). */
  recutable: boolean;
}

/** Above this many holds a bin or category is ordered by distance from its centre alone: the
 *  medoid is quadratic in its size, and a bin can hold a categorizer's whole bound. */
export const MEDOID_LIMIT = 200;

/** The holds of a bin or category, medoid first (up to {@link MEDOID_LIMIT}), then by distance
 *  from its centre. */
function ordered(model: Pick<TrainedModel, 'features' | 'weights'>, vectors: readonly FeatureVector[], members: readonly number[]): Exemplar[] {
  if (members.length === 0) return [];
  const centroid = fullMean(vectors, members);
  if (members.length <= MEDOID_LIMIT) return selectExemplars(model, { centroid, members: [...members] }, vectors, { count: members.length });
  return members
    .map((index) => ({ index, distance: weightedDistance(vectors[index], centroid, model.features, model.weights as Record<string, number>), role: 'spread' as const }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
}

/**
 * The grid for the working categorizer: its derived model, every category's holds in order
 * (medoid first), the Neutral and Set-aside bins likewise, which holds are pinned, and the range
 * a re-cut allows. `range` comes from the caller (`recutRange`), which knows whether a take is
 * in hand.
 */
export function sortingView(
  c: PersonalCategorizer,
  { sources, range, neutralKnown = true }: { sources: NameSources; range: { minK: number; maxK: number; suggestedK: number; recutable?: boolean }; neutralKnown?: boolean },
): SortingView {
  const model = modelFromCategorizer(c);
  const vectors = c.samples.map((s) => s.vector);
  const at = new Map(c.samples.map((s, i) => [s.id, i]));
  const bin = (ids: readonly string[]): SortedBin => {
    const members = ids.map((id) => at.get(id)!);
    return { count: members.length, exemplars: ordered(model, vectors, members).map((e) => e.index) };
  };
  return {
    mode: categorizerMode(c),
    k: model.categories.length,
    minK: range.minK,
    suggestedK: range.suggestedK,
    maxK: range.maxK,
    neutralKnown,
    model,
    categories: model.categories.map((cat) => {
      const s = sources.get(cat.id);
      return { id: cat.id, label: cat.label, source: s?.source ?? 'kept', matched: s?.matched ?? null, size: cat.size, exemplars: ordered(model, vectors, cat.members) };
    }),
    neutral: bin(c.neutral),
    aside: bin(c.aside ?? []),
    pinned: new Set(Object.keys(c.pins ?? {}).flatMap((id) => (at.has(id) ? [at.get(id)!] : []))),
    ids: c.samples.map((s) => s.id),
    recutable: range.recutable ?? true,
  };
}
