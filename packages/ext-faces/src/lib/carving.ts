/**
 * What the category grid shows for one carve of a face take (#330 P2), computed purely: the
 * model at k in the chosen mode, a name per category, and the exemplar samples to show.
 *
 * - **Carving** is `createCarver` (the SDK): `partition` carves every held face, so k counts
 *   neutral too; `reject` sets the faces inside the rest cloud aside first, so k counts the
 *   expressions and neutral is "none of these". A carver is built once per mode and re-cut at
 *   any k without recording again.
 * - **Names**, in order of authority: the names the player typed (carried onto the nearest new
 *   category when k changes, `carryLabels`, and never proposed twice); in partition mode,
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
import { modelFromCategorizer, type CategorizerMode, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { carryLabels } from '@thoremin/sdk/enroll/from_model';
import { exemplarsByCategory, selectExemplars, type Exemplar } from '@thoremin/sdk/enroll/exemplars';
import type { FeatureVector, TrainedModel } from '@thoremin/sdk/enroll/types';
import type { Session } from '@thoremin/sdk/enroll/session';
import { generalFaceLabeling } from '@thoremin/sdk/features/face_labels';

/** The default name of the category that is mostly the player's resting face (partition mode). */
export const NEUTRAL_LABEL = 'neutral';
/** The name nothing else fits: `expression 3`. */
export const fallbackName = (i: number): string => `expression ${i + 1}`;

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

export interface CarveInput {
  session: Pick<Session, 'points' | 'features' | 'weights' | 'modelFor'>;
  restVectors: readonly FeatureVector[];
  /** A carver per mode, cached by the caller (`carverFor`). */
  carver: Carver;
  k: number;
  /** The previous carve's named model, whose EDITED names carry over. */
  previous?: TrainedModel | null;
  /** The names the player typed, by category id of `previous` (or of this k, after an edit). */
  edited?: ReadonlySet<string>;
  /** Exemplars per category. */
  exemplarCount?: number;
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
  const edited = input.edited ?? new Set<string>();

  // 1. The player's names, carried onto the nearest new category (one-to-one).
  const sources = new Map<string, NameSource>();
  let model = fresh;
  const previous = input.previous;
  if (previous && edited.size > 0) {
    const mine = { categories: previous.categories.filter((c) => edited.has(c.id) && c.label.trim()) };
    if (mine.categories.length > 0) {
      // Only the categories that took one of the player's names; the rest stay unnamed (the
      // matcher's fallback names would read as the player's).
      const carried = carryLabels(mine, fresh, { maxDistance: Number.POSITIVE_INFINITY }).filter((m) => m.source === 'matched');
      model = applyLabels(fresh, carried);
      for (const m of carried) sources.set(m.id, 'edited');
    }
  }

  // 2. Partition mode: the category that is mostly resting face is "neutral" by default.
  if (carver.mode === 'partition' && !model.categories.some((c) => c.label.trim().toLowerCase() === NEUTRAL_LABEL)) {
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
        model = applyLabels(model, [{ id: best.id, label: NEUTRAL_LABEL }]);
        sources.set(best.id, 'neutral');
      }
    }
  }

  // 3. The general model names the rest, one-to-one, on full-space means.
  const labeling = generalFaceLabeling();
  const scored = model.categories.map((c) => ({ id: c.id, label: c.label, centroid: fullMean(vectors, c.members) }));
  const matches = matchLabels(scored, { ...labeling, fallback: fallbackName });
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

/** Rename one category (the player's edit). Returns the renamed model; the caller marks the id edited. */
export function renameCategory(model: TrainedModel, id: string, label: string): TrainedModel {
  return applyLabels(model, [{ id, label: label.trim() }]);
}

/**
 * The grid for a SAVED categorizer (no take to re-cut): its derived model, its names as saved,
 * its exemplars from its samples, and in `reject` mode the samples no category claims as the
 * neutral row.
 */
export function savedView(categorizer: PersonalCategorizer, { exemplarCount }: { exemplarCount?: number } = {}): CarveView {
  const model = modelFromCategorizer(categorizer);
  const vectors = categorizer.samples.map((s) => s.vector);
  const exemplars = exemplarsByCategory(model, vectors, { count: exemplarCount });
  const claimed = new Set(model.categories.flatMap((c) => c.members));
  const members = vectors.map((_, i) => i).filter((i) => !claimed.has(i));
  let neutral: CarveView['neutral'] = { count: 0, exemplars: [] };
  if (categorizer.mode === 'reject' && members.length > 0) {
    const ex = selectExemplars(model, { centroid: fullMean(vectors, members), members }, vectors, { count: exemplarCount });
    neutral = { count: members.length, exemplars: ex.map((e) => e.index) };
  }
  return {
    mode: categorizer.mode,
    k: model.categories.length,
    suggestedK: model.categories.length,
    maxK: model.categories.length,
    neutralKnown: true,
    model,
    categories: model.categories.map((c) => ({ id: c.id, label: c.label, source: 'kept', matched: null, size: c.size, exemplars: exemplars[c.id] ?? [] })),
    neutral,
  };
}

/** A saved categorizer with its categories renamed from `model` (same ids). */
export function relabelCategorizer(categorizer: PersonalCategorizer, model: Pick<TrainedModel, 'categories'>, name?: string): PersonalCategorizer {
  const label = new Map(model.categories.map((c) => [c.id, c.label]));
  return {
    ...categorizer,
    ...(name ? { name } : {}),
    categories: categorizer.categories.map((c) => ({ ...c, label: label.get(c.id) ?? c.label })),
  };
}
