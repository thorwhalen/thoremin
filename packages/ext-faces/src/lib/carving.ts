/**
 * What the category grid shows for one carve of a face take (#330 P2), computed purely: the
 * model at k in the chosen mode, a name per category, and the exemplar samples to show.
 *
 * The tool itself no longer carves this way: since #385 E4 a fresh take is carved by
 * {@link carveTake} (the rest cloud in Neutral, in either setting of the strangers switch, #385
 * E5) and shown by {@link sortingView}; names come from {@link nameCarve}, and a name the player
 * gives is a pin (`nameCategory` in the SDK's sorting), so a re-cut keeps it. `carveView` and its
 * `partition` / `reject` modes below are the P2 path from a `Session` to a named model, kept as
 * the tests' fixture path (#422 retired its typed names: no caller kept one since E4).
 *
 * - **Carving** is `createCarver` (the SDK): `partition` carves every held face, so k counts
 *   neutral too; `reject` sets the faces inside the rest cloud aside first, so k counts the
 *   expressions and neutral is "none of these". A carver is built once per mode and re-cut at
 *   any k without recording again.
 * - **Names**, in order of authority: in partition mode, "neutral" for the category that is
 *   mostly rest-cloud faces; then the general expression
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
import { categorizerMode, modelFromCategorizer, type CategorizerMode, type CategorizerStrangers, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { recut, recutRange, type SortResult } from '@thoremin/sdk/enroll/sorting';
import { weightedDistance } from '@thoremin/sdk/enroll/cluster';
import { carveQuality, qualityHint, type CarveQuality, type QualityHint } from '@thoremin/sdk/enroll/quality';
import { exemplarsByCategory, selectExemplars, type Exemplar } from '@thoremin/sdk/enroll/exemplars';
import type { FeatureVector, TrainedModel } from '@thoremin/sdk/enroll/types';
import type { Session } from '@thoremin/sdk/enroll/session';
import { isNeutralLabel, type CarveModality, type GeneralContext, type GeneralLabeling } from '@thoremin/sdk/enroll/modality';
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

export interface CarveInput {
  session: Pick<Session, 'points' | 'features' | 'weights' | 'modelFor'>;
  restVectors: readonly FeatureVector[];
  /** A carver per mode, cached by the caller (`carverFor`). */
  carver: Carver;
  k: number;
  /** Exemplars per category. */
  exemplarCount?: number;
  /** What was carved (the face by default): its neutral name, general model and fallback names. */
  modality?: CarveModality;
  /** What the general model names by beyond the take's features (#383: the mirror, a vocabulary). */
  context?: Omit<GeneralContext, 'features'>;
}

/** What a categorizer's general model names by (#383): its trained features, its mirror, the
 *  vocabulary it was made for and the mean of its Neutral (rest) holds. */
export function generalContextOf(c: Pick<PersonalCategorizer, 'features' | 'mirror' | 'vocabulary' | 'samples' | 'neutral'>): GeneralContext {
  const at = new Map(c.samples.map((s, i) => [s.id, i]));
  const rest = c.neutral.flatMap((id) => (at.has(id) ? [at.get(id)!] : []));
  const vectors = c.samples.map((s) => s.vector);
  return {
    features: c.features,
    ...(c.mirror ? { mirror: true } : {}),
    ...(c.vocabulary ? { vocabulary: c.vocabulary } : {}),
    ...(rest.length > 0 ? { rest: fullMean(vectors, rest) } : {}),
  };
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
  let model = carver.modelAt(input.k);
  const modality = input.modality ?? faceModality;
  const neutralLabel = modality.words.neutral;

  const sources = new Map<string, NameSource>();

  // 1. Partition mode: the category that is mostly resting face is "neutral" by default.
  if (carver.mode === 'partition' && !model.categories.some((c) => isNeutralLabel(modality, c.label))) {
    const rest = neutralIndices(vectors, restVectors, session.features(), session.weights());
    if (rest && rest.length > 0) {
      const isRest = new Set(rest);
      let best: { id: string; share: number } | null = null;
      for (const c of model.categories) {
        const share = c.members.filter((j) => isRest.has(j)).length / Math.max(1, c.members.length);
        if (share >= 0.5 && (!best || share > best.share)) best = { id: c.id, share };
      }
      if (best) {
        model = applyLabels(model, [{ id: best.id, label: neutralLabel }]);
        sources.set(best.id, 'neutral');
      }
    }
  }

  // 2. The modality's general model names the rest, one-to-one, on full-space means.
  const rest = restVectors.length > 0 ? fullMean(restVectors, restVectors.map((_, i) => i)) : undefined;
  const labeling = modality.general?.({ features: session.features(), ...(rest ? { rest } : {}), ...input.context }) ?? NO_GENERAL;
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
  const labeling = modality.general?.(generalContextOf(c)) ?? NO_GENERAL;
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
  /** What a face nobody taught reads as (#385 E5): the strangers switch. */
  strangers: CategorizerStrangers;
  /** Whether the Neutral holds are trained as the null class (false: an older file, migrated). */
  neutralTrained: boolean;
  /** The smallest k a re-cut allows (the pinned categories). */
  minK: number;
  aside: SortedBin;
  /** Sample indices the player placed (pinned). */
  pinned: ReadonlySet<number>;
  /** Every sample's id, by index (what the indices above, and the stills, are keyed by). */
  ids: readonly string[];
  /** Whether k can be re-cut here (false when the pool is too large to re-cut at once). */
  recutable: boolean;
  /** How distinct each category is, and the suspect holds (#385 E6). */
  quality: CarveQuality;
  /** The hint for each CLOSE category, in the modality's words, by category id. */
  hints: ReadonlyMap<string, QualityHint>;
  /** The suspect holds by sample index: where each looks like it belongs (a category id or
   *  `neutral`). */
  suspects: ReadonlyMap<number, string>;
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
  {
    sources,
    range,
    neutralKnown = true,
    modality = faceModality,
  }: { sources: NameSources; range: { minK: number; maxK: number; suggestedK: number; recutable?: boolean }; neutralKnown?: boolean; modality?: CarveModality },
): SortingView {
  const model = modelFromCategorizer(c);
  const vectors = c.samples.map((s) => s.vector);
  const quality = carveQuality(model, vectors);
  // As the grid names a category with no label: its id.
  const label = (id: string): string => model.categories.find((x) => x.id === id)?.label || id;
  const hints = new Map<string, QualityHint>();
  for (const q of quality.categories) {
    const hint = q.closeTo ? qualityHint(model, q.id, q.closeTo, { describe: (f) => modality.describe(f), label, neutralName: `your ${modality.words.neutral} ${modality.words.many}` }) : null;
    if (hint) hints.set(q.id, hint);
  }
  const at = new Map(c.samples.map((s, i) => [s.id, i]));
  const pinned = new Set(Object.keys(c.pins ?? {}).flatMap((id) => (at.has(id) ? [at.get(id)!] : [])));
  const bin = (ids: readonly string[]): SortedBin => {
    const members = ids.map((id) => at.get(id)!);
    return { count: members.length, exemplars: ordered(model, vectors, members).map((e) => e.index) };
  };
  return {
    mode: categorizerMode(c),
    strangers: c.strangers,
    neutralTrained: c.neutralTrained,
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
    pinned,
    ids: c.samples.map((s) => s.id),
    recutable: range.recutable ?? true,
    quality,
    hints,
    // A hold the player placed is where they want it: no "looks more like" on it.
    suspects: new Map(quality.suspects.filter((x) => !pinned.has(x.index)).map((x) => [x.index, x.nearer])),
  };
}

/** What {@link carveTake} needs besides the take's categorizer. */
export interface CarveTakeInput {
  /** The rest cloud (hold ids): what seeds Neutral. Null when there was too little rest to say. */
  cloud: ReadonlySet<string> | null;
  /** The rest take's frames: what the reject radius is trained from. */
  rest: readonly FeatureVector[];
  /** The reject radius when there is no rest to train it from. */
  baseRejectRadius?: number;
  /** The most categories the carve makes. */
  maxCategories: number;
}

/**
 * A fresh take carved at the suggested k (#385 E4, E5): the rest cloud seeds Neutral, in either
 * setting of the strangers switch (Neutral is taught by example; the switch says only what a face
 * nobody taught reads as), and every other hold is carved. When every hold is close to the rest
 * there is nothing else to carve: then every hold is carved (`allNearRest`), for the player to
 * move their resting faces to Neutral, rather than an empty grid.
 */
export function carveTake(base: PersonalCategorizer, input: CarveTakeInput): { result: SortResult; allNearRest: boolean } {
  const carve = (neutral: ReadonlySet<string>): SortResult => {
    const options = { rest: input.rest, baseRejectRadius: input.baseRejectRadius, neutral };
    return recut(base, Math.min(recutRange(base, options).suggestedK, input.maxCategories), options);
  };
  const seeded = carve(input.cloud ?? new Set<string>());
  if (seeded.ok || !input.cloud || input.cloud.size === 0) return { result: seeded, allNearRest: false };
  return { result: carve(new Set<string>()), allNearRest: true };
}
