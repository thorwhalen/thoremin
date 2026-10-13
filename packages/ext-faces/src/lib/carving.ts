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
import { categorizerMode, modelFromCategorizer, neutralSampleIndices, type CategorizerMode, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { carryLabels } from '@thoremin/sdk/enroll/from_model';
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

/**
 * The grid for a SAVED categorizer (no take to re-cut): its derived model, its names as saved,
 * its exemplars from its samples, and in `reject` mode its neutral holds as the neutral row.
 */
export function savedView(categorizer: PersonalCategorizer, { exemplarCount }: { exemplarCount?: number } = {}): CarveView {
  const model = modelFromCategorizer(categorizer);
  const vectors = categorizer.samples.map((s) => s.vector);
  const exemplars = exemplarsByCategory(model, vectors, { count: exemplarCount });
  const members = neutralSampleIndices(categorizer);
  const mode = categorizerMode(categorizer);
  let neutral: CarveView['neutral'] = { count: 0, exemplars: [] };
  if (mode === 'reject' && members.length > 0) {
    const ex = selectExemplars(model, { centroid: fullMean(vectors, members), members }, vectors, { count: exemplarCount });
    neutral = { count: members.length, exemplars: ex.map((e) => e.index) };
  }
  return {
    mode,
    k: model.categories.length,
    suggestedK: model.categories.length,
    maxK: model.categories.length,
    neutralKnown: true,
    model,
    categories: model.categories.map((c) => ({ id: c.id, label: c.label, source: 'kept', matched: null, size: c.size, exemplars: exemplars[c.id] ?? [] })),
    neutral,
  };
}
