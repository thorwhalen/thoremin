/**
 * A personal categorizer as a file (#330): the versioned schema a player's model is saved,
 * exported and imported under, and the derivation of a live {@link TrainedModel} from it.
 *
 * ## Samples are the SSOT; the model is derived
 *
 * What is stored is what the player DID: the held still-points (`samples`), which of them
 * form each category, the names they gave, and the feature space (ids and weights) the
 * distances are measured in. Centroids, radii and cue counts are not stored; they are
 * recomputed by {@link modelFromCategorizer} with the same `trainModel` the session uses,
 * so a saved model can never disagree with its own data, and a later change to how
 * centroids are computed reaches old files for free. This is the air vocabularies'
 * precedent (`packages/ext-air/src/app/vocabularyStore.ts`). The one tuned number that is
 * not derivable from the samples, the reject radius, is stored as data.
 *
 * ## Every hold has an id and a place (version 2, #385 E3)
 *
 * Each sample carries a stable `id` (a hold's is `<takeId>:<n>`), and everything that points
 * at a sample names its id, never its position: a category's `members`, the `neutral` and
 * `aside` bins, E4's `pins`, and the still a picture is filed under. So a merge, a move or a
 * re-cut never renumbers anything, and a still is filed once. Every sample is in exactly one
 * place: a category, `neutral` (the player's "none of these": the rest cloud, or a face moved
 * out of every category) or `aside` (kept, not trained: "not sure yet"). Neither bin is
 * trained on; a re-carve of the samples may still use them.
 *
 * ## Strangers: stated, not inferred
 *
 * `strangers: 'nearest'` (the carve's `partition`) means every vector belongs to some
 * category (k counts the player's neutral as a category); `strangers: 'neutral'` (the carve's
 * `reject`) means a vector beyond `rejectRadius` belongs to none (k counts only the
 * expressions). The derived model's `rejectRadius` is `Number.MAX_VALUE` for `nearest`
 * (finite, so the derived model still persists under `TrainedModelSchema`, whose
 * `z.number()` refuses `Infinity`).
 *
 * ## Neutral, taught (version 3, #385 E5)
 *
 * `neutralTrained: true` trains the Neutral holds as a null class (`trainNeutral`): a vector
 * nearest them reads as no category in either setting of `strangers`, so "this face means
 * nothing" is said by example, and `strangers` only says what a face nobody taught reads as.
 * Every file this build makes says `true`. Files of versions 1 and 2 migrate to `false`, which
 * is exactly how they classified (their Neutral holds were never trained); the player turns it
 * on, as an edit, and only then do they classify differently.
 *
 * ## Versions and migration
 *
 * Every file carries `format` and `version`. {@link importCategorizer} reads a file of an
 * older version through a chain of migrations (`migrations[n]` takes a version-n document
 * to version n+1), refuses a NEWER version with a message saying so (never a silent
 * partial read), and validates the result against the current schema. Bump
 * {@link CATEGORIZER_VERSION} and add `CATEGORIZER_MIGRATIONS[old]` together.
 *
 * Version 1 (positions, `mode`, `k`) migrates by {@link migrateCategorizerV1}; version 2 by
 * {@link migrateCategorizerV2}.
 *
 * Non-finite feature values (a feature not measurable on that frame) are DROPPED on the way
 * in: JSON cannot carry NaN, and a missing key is exactly how every distance in `enroll/`
 * already treats a non-finite value.
 */
import { HAND_CHOICES, type HandChoice, type Skeleton } from './modality';
import { z } from 'zod';
import { trainModel, trainNeutral } from './classify';
import type { FeatureVector, StillPoint, TrainedModel } from './types';

export const CATEGORIZER_FORMAT = 'thoremin.categorizer';
/** The version this build writes. */
export const CATEGORIZER_VERSION = 3;
/** How a carve treats the player's resting face; the UI's two settings (the file says it as
 *  {@link CategorizerStrangers}). */
const CATEGORIZER_MODES = ['partition', 'reject'] as const;
export type CategorizerMode = (typeof CATEGORIZER_MODES)[number];
/** What a vector far from every category reads as: `neutral` ("none of these", beyond
 *  `rejectRadius`), or the `nearest` category (nothing is ever rejected). */
const CATEGORIZER_STRANGERS = ['neutral', 'nearest'] as const;
export type CategorizerStrangers = (typeof CATEGORIZER_STRANGERS)[number];

/** The file's `strangers` for a carve mode: `reject` reads strangers as neutral. */
export const strangersFor = (mode: CategorizerMode): CategorizerStrangers => (mode === 'reject' ? 'neutral' : 'nearest');
/** The carve mode a file's `strangers` stands for. */
export const categorizerMode = (c: Pick<PersonalCategorizer, 'strangers'>): CategorizerMode => (c.strangers === 'neutral' ? 'reject' : 'partition');

/** The derived model's reject radius in partition mode: nothing is ever rejected. */
export const NO_REJECT_RADIUS = Number.MAX_VALUE;

/**
 * The most samples an IMPORTED file may carry, and the most a correction may grow a
 * categorizer to. An import is untrusted and its stages run on the main thread, so a size
 * bound is a responsiveness bound. Exemplar selection is no longer the limit (the medoid is
 * estimated past 300 members, #398); the re-cut's forest (quadratic) and merging a take (validating
 * and re-deriving every sample) run in a worker since #587, so they no longer count.
 * `scripts/bench_categorizer_size.ts` times what is left on the page, at 52 features (ms at 2000 /
 * 3000 / 5000 samples on one server core): model 126 / 147 / 208, quality chips 109 / 158 / 283, a re-cut
 * once its forest is cached 79 / 123 / 200, the strangers switch 41 / 66 / 117, and in the worker the
 * forest 322 / 897 / 2676 and a merge of 40 holds 221 / 280 / 489. The slowest page stage stays under the
 * ~200 ms a click may take through 3000 (quality chips, 158), and passes it by 4000, so the bound is 3000.
 * Generous for any real take, which holds tens to a few hundred still-points.
 *
 * The bound is enforced at the untrusted door ({@link importCategorizer}) and by the edits
 * that grow a categorizer, NOT by {@link PersonalCategorizerSchema}: that schema also
 * validates the player's saved records, and a record saved before the bound existed must
 * still load rather than silently vanish.
 */
export const MAX_CATEGORIZER_SAMPLES = 3000;
/** The most feature ids a file may name: well above the whole feature catalog (a few
 *  hundred ids), of which a session model keeps only its most distinctive few. */
export const MAX_CATEGORIZER_FEATURES = 1024;
/** The most supporting frames one sample may carry (#385 E3: a hold's dwell window, thinned). */
export const MAX_SAMPLE_SUPPORT = 8;
/** Decimal places a supporting frame keeps (blendshapes are 0..1, their jitter about 1e-3). */
export const SUPPORT_DECIMALS = 5;

const VectorSchema = z.record(z.string(), z.number());

/** The most joints a sample's stick figure may name (the body's has 15). */
export const MAX_SKELETON_POINTS = 64;

/** A hold's stick figure (#382): named `[x, y]` joints in torso lengths (`Skeleton`). */
/** The largest joint coordinate, in torso lengths (a figure spans a few). */
export const MAX_SKELETON_COORD = 100;

const SkeletonCoord = z.number().min(-MAX_SKELETON_COORD).max(MAX_SKELETON_COORD);
const SkeletonSchema = z
  .record(z.string().min(1), z.tuple([SkeletonCoord, SkeletonCoord]))
  .refine((s) => Object.keys(s).length >= 1 && Object.keys(s).length <= MAX_SKELETON_POINTS, { message: `a skeleton names between 1 and ${MAX_SKELETON_POINTS} joints` });

const SampleSchema = z.object({
  /** Stable id (#385 E3): what a category, a bin, a pin and a still refer to. A hold's id is
   *  `<takeId>:<n>`, unique across takes, so stills are keyed by it and never re-filed. */
  id: z.string().min(1),
  vector: VectorSchema,
  t: z.number(),
  cue: z.string(),
  /** Frames from the hold's dwell window (thinned): more than one vector per hold for a radius
   *  or a spread, while the carve still clusters one point per hold. Each frame is a ROW aligned
   *  with `features` (null where the feature was not measurable), rounded to
   *  {@link SUPPORT_DECIMALS} places: keyed vectors would repeat every feature's name per frame
   *  and multiply a saved record's size for evidence. An edit that changes `features` must
   *  re-project or drop them. The derived model reads them only when `radiusFrom` is `frames` (#413). */
  support: z.array(z.array(z.number().nullable())).max(MAX_SAMPLE_SUPPORT).optional(),
  /** The hold's stick figure (#382: a body pose's picture, which shows no one), drawn from its
   *  vector at capture by the modality and kept here so an imported or shared file still shows
   *  what each category looks like. Optional and additive: a build before it drops the field. */
  skeleton: SkeletonSchema.optional(),
  /** In a mirrored categorizer (#529): whether this hold was read as its mirror image (`true`) or
   *  as shown (`false`), so turning the mirror off can put each hold back on its own side. Written
   *  only where the side is known (a take or merge read with the mirror on, `mirrorOn`); a hold
   *  without it (an older file, a live correction) keeps the mirror on. Optional and additive. */
  mirrored: z.boolean().optional(),
});

const CategorizerCategorySchema = z.object({
  /** Stable id: what a binding refers to. */
  id: z.string().min(1),
  label: z.string(),
  /** Sample ids, in sample order. */
  members: z.array(z.string().min(1)).min(1),
});

/** The bins a sample can be in besides a category (E4's moves name them in `pins`). */
export const NEUTRAL_BIN = 'neutral';
export const ASIDE_BIN = 'aside';

export const PersonalCategorizerSchema = z
  .object({
    format: z.literal(CATEGORIZER_FORMAT),
    version: z.literal(CATEGORIZER_VERSION),
    name: z.string(),
    /** What the features describe (`face`, `hand`, ...): the tool that carves it and plays it. */
    modality: z.string().min(1).optional(),
    /** Which hand a `hand` categorizer reads (#385 E8): `either` (absent) makes the same category
     *  with whichever hand is in view; `left` / `right` read only that one. Ignored otherwise.
     *  Optional and additive: a build before it ignores the field and reads either hand. */
    hand: z.enum(HAND_CHOICES).optional(),
    /** A body categorizer reads a pose and its mirror image as one (#382, #387 B10): its samples
     *  were taken, and live poses are read, on a canonical side. Absent: left and right differ (the
     *  default). Optional and additive, like `hand`. */
    mirror: z.literal(true).optional(),
    /** The default-name vocabulary it was made for (#383): the body's `conductor` when made from
     *  the Conductor tool. Absent: chosen by coverage. Optional and additive, like `hand`. */
    vocabulary: z.string().min(1).optional(),
    /** Where a category's radius is measured (#413): `holds` (absent; the still-points only, as every
     *  file before it classified) or `frames` (the holds' supporting frames too, which also floors the
     *  reject radius on every frame). Optional and additive: a build before it reads `holds`. */
    radiusFrom: z.enum(['holds', 'frames']).optional(),
    /** ISO time of creation. Informational. */
    createdAt: z.string().optional(),
    /** The feature space: the ids distances use, in order. */
    features: z.array(z.string().min(1)).min(1),
    /** Per-feature distance weight (1/sigma x nuisance for a session model). */
    weights: z.record(z.string(), z.number().nonnegative()),
    /** What a vector far from every category reads as (the carve's `reject` / `partition`). */
    strangers: z.enum(CATEGORIZER_STRANGERS),
    /** Required when `strangers` is `neutral`; ignored otherwise. */
    rejectRadius: z.number().positive().optional(),
    samples: z.array(SampleSchema),
    categories: z.array(CategorizerCategorySchema).min(1),
    /** The player's "none of these" holds (the rest cloud, or a face moved out of every
     *  category), by sample id. */
    neutral: z.array(z.string().min(1)),
    /** The `neutral` holds that arrived by merging a whole category into Neutral (#536), by
     *  sample id: a deliberate act, so `trainNeutral` does not fold them into a larger group
     *  as it would a stray hold. Optional and additive (an older build drops it); an id no
     *  longer in `neutral` is ignored ({@link mergedNeutralIndices}). */
    mergedNeutral: z.array(z.string().min(1)).optional(),
    /** Whether the `neutral` holds are trained as a null class (#385 E5): a face nearest them
     *  reads as none of these. False only for a file made before version 3 (it classified so);
     *  absent from a version-3 document, true (the migrations always write it). */
    neutralTrained: z.boolean().default(true),
    /** Holds kept but not trained on ("not sure yet"), by sample id. */
    aside: z.array(z.string().min(1)).optional(),
    /** The player's moves, kept so a re-cut honours them (#385 E4): sample id -> a category id,
     *  `neutral` or `aside`. */
    pins: z.record(z.string(), z.string().min(1)).optional(),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
    if (c.strangers === 'neutral' && c.rejectRadius === undefined) issue('strangers "neutral" needs a rejectRadius', ['rejectRadius']);
    // A feature listed twice would count twice in every distance (doubling its weight).
    const features = new Set<string>();
    c.features.forEach((f, i) => {
      if (features.has(f)) issue(`feature "${f}" is listed twice`, ['features', i]);
      features.add(f);
    });
    const sampleIds = new Set<string>();
    c.samples.forEach((s, i) => {
      if (sampleIds.has(s.id)) issue(`sample id "${s.id}" is used twice`, ['samples', i, 'id']);
      sampleIds.add(s.id);
      if (s.support?.some((row) => row.length !== c.features.length)) issue(`sample "${s.id}" has a supporting frame that is not one value per feature`, ['samples', i, 'support']);
    });
    // Every sample is in exactly one place: a category, neutral or aside.
    const placed = new Map<string, string>();
    const place = (id: string, where: string, path: (string | number)[]) => {
      if (!sampleIds.has(id)) issue(`${where} names sample "${id}", which is not in samples`, path);
      else if (placed.has(id)) issue(`sample "${id}" is in ${placed.get(id)} and in ${where}`, path);
      else placed.set(id, where);
    };
    const ids = new Set<string>();
    c.categories.forEach((cat, i) => {
      if (ids.has(cat.id)) issue(`duplicate category id "${cat.id}"`, ['categories', i, 'id']);
      if (cat.id === NEUTRAL_BIN || cat.id === ASIDE_BIN) issue(`category id "${cat.id}" is a bin's name`, ['categories', i, 'id']);
      ids.add(cat.id);
      for (const j of cat.members) place(j, `category "${cat.id}"`, ['categories', i, 'members']);
    });
    for (const j of c.neutral) place(j, NEUTRAL_BIN, [NEUTRAL_BIN]);
    for (const j of c.aside ?? []) place(j, ASIDE_BIN, [ASIDE_BIN]);
    for (const s of c.samples) if (!placed.has(s.id)) issue(`sample "${s.id}" is in no category, neutral or aside`, ['samples']);
    for (const [j, to] of Object.entries(c.pins ?? {})) {
      if (!sampleIds.has(j)) issue(`pin names sample "${j}", which is not in samples`, ['pins']);
      if (to !== NEUTRAL_BIN && to !== ASIDE_BIN && !ids.has(to)) issue(`pin of "${j}" names "${to}", which is no category or bin`, ['pins']);
    }
  });

export type PersonalCategorizer = z.infer<typeof PersonalCategorizerSchema>;
export type CategorizerSample = z.infer<typeof SampleSchema>;

/** Sample id -> index into `samples`. */
export function sampleIndex(c: Pick<PersonalCategorizer, 'samples'>): Map<string, number> {
  return new Map(c.samples.map((s, i) => [s.id, i]));
}

/** Each category's members as indices into `samples`, in the order stored. */
export function memberIndices(c: Pick<PersonalCategorizer, 'samples' | 'categories'>): number[][] {
  const at = sampleIndex(c);
  return c.categories.map((cat) => cat.members.map((id) => at.get(id)!));
}

/** The neutral holds as indices into `samples`, in sample order. */
export function neutralSampleIndices(c: Pick<PersonalCategorizer, 'samples' | 'neutral'>): number[] {
  const neutral = new Set(c.neutral);
  return c.samples.flatMap((s, i) => (neutral.has(s.id) ? [i] : []));
}

/** The Neutral holds that a whole-category merge put there (#536), as indices into `samples`,
 *  in sample order; only those still in Neutral. */
export function mergedNeutralIndices(c: Pick<PersonalCategorizer, 'samples' | 'neutral' | 'mergedNeutral'>): number[] {
  const merged = new Set(c.mergedNeutral ?? []);
  const neutral = new Set(c.neutral);
  return c.samples.flatMap((s, i) => (merged.has(s.id) && neutral.has(s.id) ? [i] : []));
}

/** A copy of `v` without its non-finite entries (JSON cannot carry them). */
function finiteOnly(v: FeatureVector): FeatureVector {
  const out: FeatureVector = {};
  for (const [k, x] of Object.entries(v)) if (Number.isFinite(x)) out[k] = x;
  return out;
}

/** What a sample is made from: a still-point with its id, and its supporting frames. */
export type SampleInput = Pick<StillPoint, 'vector' | 't' | 'cue'> & { id: string; support?: readonly FeatureVector[]; skeleton?: Skeleton | null; mirrored?: boolean };

const roundSupport = (x: number | undefined): number | null => (x !== undefined && Number.isFinite(x) ? Number(x.toFixed(SUPPORT_DECIMALS)) : null);

/** A still-point as a stored sample. Its supporting frames are kept only given the
 *  categorizer's `features` (they are stored as rows over them), at most
 *  {@link MAX_SAMPLE_SUPPORT}. */
export function toSample(p: SampleInput, features?: readonly string[]): CategorizerSample {
  const support = features ? p.support?.slice(0, MAX_SAMPLE_SUPPORT).map((f) => features.map((k) => roundSupport(f[k]))) : undefined;
  const skeleton = p.skeleton ? finiteSkeleton(p.skeleton) : null;
  return {
    id: p.id,
    vector: finiteOnly(p.vector),
    t: Number.isFinite(p.t) ? p.t : 0,
    cue: p.cue,
    ...(support && support.length > 0 ? { support } : {}),
    ...(skeleton ? { skeleton } : {}),
    ...(typeof p.mirrored === 'boolean' ? { mirrored: p.mirrored } : {}),
  };
}

/** The skeleton's finite joints (JSON cannot carry the others), or null when none is. */
function finiteSkeleton(s: Skeleton): Record<string, [number, number]> | null {
  const out: Record<string, [number, number]> = {};
  for (const [k, [x, y]] of Object.entries(s)) if (Number.isFinite(x) && Number.isFinite(y)) out[k] = [x, y];
  return Object.keys(out).length > 0 ? out : null;
}

export interface CategorizerMeta {
  name: string;
  /** What a face nobody taught reads as. A sample no category claims is Neutral. */
  strangers?: CategorizerStrangers;
  /** The carve mode, v1's vocabulary, when `strangers` is not given: `reject` reads strangers
   *  as neutral and puts the unclaimed samples in Neutral; `partition` reads strangers as the
   *  nearest category and sets the unclaimed aside. */
  mode?: CategorizerMode;
  /** Whether the Neutral holds are trained as a null class (default true). */
  neutralTrained?: boolean;
  modality?: string;
  /** Which hand (a hand categorizer only; `either` is written as absent). */
  hand?: HandChoice;
  /** A pose and its mirror image read as one (a body categorizer; false is written as absent). */
  mirror?: boolean;
  /** The default-name vocabulary it was made for (absent: chosen by coverage). */
  vocabulary?: string;
  createdAt?: string;
}

/**
 * Capture a trained model as a categorizer. `points` is the pool the model's `members`
 * index (the session's `points()`, each with its hold id; a point without one is `s-<index>`).
 * A sample no category claims is Neutral, except in v1's `partition` mode, which sets it aside.
 * Throws if the result does not validate, or if neither `strangers` nor `mode` is given.
 */
export function categorizerFromModel(
  model: TrainedModel,
  points: readonly (Omit<SampleInput, 'id'> & { id?: string })[],
  meta: CategorizerMeta,
): PersonalCategorizer {
  const samples: SampleInput[] = points.map((p, i) => ({ ...p, id: p.id ?? v1SampleId(i) }));
  const claimed = new Set(model.categories.flatMap((c) => c.members));
  const unclaimed = samples.flatMap((s, i) => (claimed.has(i) ? [] : [s.id]));
  const strangers = meta.strangers ?? (meta.mode ? strangersFor(meta.mode) : undefined);
  if (!strangers) throw new Error('categorizerFromModel needs strangers (or a mode)');
  const aside = !meta.strangers && meta.mode === 'partition';
  return PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: meta.name,
    ...(meta.modality ? { modality: meta.modality } : {}),
    ...(meta.hand && meta.hand !== 'either' ? { hand: meta.hand } : {}),
    ...(meta.mirror ? { mirror: true } : {}),
    ...(meta.vocabulary ? { vocabulary: meta.vocabulary } : {}),
    ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
    features: [...model.features],
    weights: { ...model.weights },
    strangers,
    ...(strangers === 'neutral' ? { rejectRadius: model.rejectRadius } : {}),
    samples: samples.map((s) => toSample(s, model.features)),
    categories: model.categories.map((c) => ({ id: c.id, label: c.label, members: [...c.members].sort((a, b) => a - b).map((j) => samples[j].id) })),
    neutral: aside ? [] : unclaimed,
    neutralTrained: meta.neutralTrained ?? true,
    ...(aside && unclaimed.length > 0 ? { aside: unclaimed } : {}),
  });
}

/** `trainModel`'s `supports` option for a categorizer that measures its radii from frames (#413);
 *  empty for one that does not, so its model is the one it always had. */
export function supportOption(c: Pick<PersonalCategorizer, 'samples' | 'features' | 'radiusFrom'>): { supports?: (FeatureVector[] | undefined)[] } {
  if (c.radiusFrom !== 'frames') return {};
  return {
    supports: c.samples.map((s) =>
      s.support?.map((row) => {
        const v: FeatureVector = {};
        c.features.forEach((f, i) => {
          if (row[i] !== null && row[i] !== undefined) v[f] = row[i]!;
        });
        return v;
      }),
    ),
  };
}

/**
 * The live model a categorizer describes: centroids and radii recomputed from its samples,
 * its ids and labels kept, its cue counts filled, its reject radius from `strangers`, its
 * Neutral class trained when `neutralTrained` says so. The model's `members` index `samples`.
 * The input is validated first (throws if invalid): an unvalidated empty category would
 * otherwise shift every later category's id and label onto its neighbour's members. Set-aside
 * holds are never trained on.
 */
export function modelFromCategorizer(input: PersonalCategorizer, { renormalize = false }: { renormalize?: boolean } = {}): TrainedModel {
  const c = PersonalCategorizerSchema.parse(input);
  const vectors = c.samples.map((s) => s.vector);
  const members = memberIndices(c);
  // `renormalize` (#458): the radii measured as the live model reads (the body's poses).
  const trained = trainModel(vectors, members, c.features, c.weights, { ...(renormalize ? { renormalize } : {}), ...supportOption(c) });
  // No category is empty (the schema refuses it), so `trainModel` kept them all, in order.
  const categories = trained.categories.map((cat, i) => {
    // Counted in a Map: a cue named `toString` would read as present on a `{}` (#338).
    const cues = new Map<string, number>();
    for (const j of cat.members) cues.set(c.samples[j].cue, (cues.get(c.samples[j].cue) ?? 0) + 1);
    return { ...cat, id: c.categories[i].id, label: c.categories[i].label, cues: Object.fromEntries(cues) };
  });
  const neutral = c.neutralTrained ? trainNeutral(vectors, neutralSampleIndices(c), c.features, c.weights, categories, { merged: mergedNeutralIndices(c) }) : [];
  return {
    ...trained,
    categories,
    rejectRadius: c.strangers === 'neutral' ? c.rejectRadius! : NO_REJECT_RADIUS,
    ...(neutral.length > 0 ? { neutral } : {}),
  };
}

/** Takes a version-n document to version n+1. */
export type CategorizerMigration = (doc: Record<string, unknown>) => Record<string, unknown>;

export interface MigrateV1Options {
  /** The id sample `index` gets (default `s-<index>`). A saved record passes its take's still
   *  keys (`<takeId>:<index>`), so its stills are found under the new ids without re-filing. */
  idFor?: (index: number) => string;
}

/** The ids a v1 file's samples get when nothing better is known. */
export const v1SampleId = (index: number): string => `s-${index}`;

/**
 * Version 1 to version 2 (#385 E3): samples get ids, members name them, `mode` becomes
 * `strangers`, `k` is dropped (it is `categories.length`), and the samples no category claims
 * are placed: neutral under `reject` (they were "none of these"), set aside under `partition`
 * (kept, not trained, as before). The derived model is unchanged: member order is kept, and
 * neither bin is trained on. A malformed v1 document is passed through as far as it can be,
 * for the v2 validation to name what is wrong.
 */
export function migrateCategorizerV1(doc: Record<string, unknown>, options: MigrateV1Options = {}): Record<string, unknown> {
  const idFor = options.idFor ?? v1SampleId;
  const { mode, k: _k, ...rest } = doc;
  void _k;
  const samples = Array.isArray(doc.samples) ? doc.samples : [];
  const idAt = (j: unknown): unknown => (typeof j === 'number' && Number.isInteger(j) && j >= 0 && j < samples.length ? idFor(j) : j);
  // Version 1 allowed a category id that version 2 keeps for a bin: such a category is renamed.
  const ids = new Set(Array.isArray(doc.categories) ? doc.categories.map((c) => (c && typeof c === 'object' ? (c as { id?: unknown }).id : undefined)) : []);
  const unbinned = (id: unknown): unknown => {
    if (id !== NEUTRAL_BIN && id !== ASIDE_BIN) return id;
    let n = 1;
    while (ids.has(`${id}-${n}`)) n++;
    ids.add(`${id}-${n}`);
    return `${id}-${n}`;
  };
  const categories = Array.isArray(doc.categories)
    ? doc.categories.map((c) =>
        c && typeof c === 'object' && Array.isArray((c as { members?: unknown }).members)
          ? { ...c, id: unbinned((c as { id?: unknown }).id), members: (c as { members: unknown[] }).members.map(idAt) }
          : c,
      )
    : doc.categories;
  const claimed = new Set<number>();
  if (Array.isArray(doc.categories)) {
    for (const c of doc.categories) {
      const m = c && typeof c === 'object' ? (c as { members?: unknown }).members : undefined;
      if (Array.isArray(m)) for (const j of m) if (typeof j === 'number') claimed.add(j);
    }
  }
  const unclaimed = samples.flatMap((_, i) => (claimed.has(i) ? [] : [idFor(i)]));
  const reject = mode === 'reject';
  return {
    ...rest,
    version: 2,
    strangers: reject ? 'neutral' : mode === 'partition' ? 'nearest' : mode,
    samples: Array.isArray(doc.samples) ? samples.map((s, i) => (s && typeof s === 'object' ? { ...s, id: idFor(i) } : s)) : doc.samples,
    categories,
    neutral: reject ? unclaimed : [],
    ...(!reject && unclaimed.length > 0 ? { aside: unclaimed } : {}),
  };
}

/**
 * Version 2 to version 3 (#385 E5): `neutralTrained: false`, because a version-2 file's Neutral
 * holds were never trained on, so it classifies exactly as it did.
 */
export function migrateCategorizerV2(doc: Record<string, unknown>): Record<string, unknown> {
  return { ...doc, version: 3, neutralTrained: false };
}

/** The shipped migrations, keyed by the version they read. */
export const CATEGORIZER_MIGRATIONS: Readonly<Record<number, CategorizerMigration>> = {
  1: (doc) => migrateCategorizerV1(doc),
  2: (doc) => migrateCategorizerV2(doc),
};

export type ImportResult =
  | { ok: true; categorizer: PersonalCategorizer; migratedFrom: number | null }
  | { ok: false; error: string };

export interface ImportOptions {
  migrations?: Readonly<Record<number, CategorizerMigration>>;
}

/** The finite numeric entries of a parsed object (a hand-edited file may carry null). */
const finiteEntries = (v: object): Record<string, number> =>
  Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])));

/** The categorizer as a file's text (validated first; throws if it does not validate). */
export function exportCategorizer(c: PersonalCategorizer): string {
  return JSON.stringify(PersonalCategorizerSchema.parse(c), null, 2);
}

/**
 * Read a categorizer from a file's text (or an already-parsed value): migrate an older
 * version forward, refuse a newer one, validate. Never throws; the error says what is wrong.
 */
export function importCategorizer(input: string | unknown, options: ImportOptions = {}): ImportResult {
  const migrations = options.migrations ?? CATEGORIZER_MIGRATIONS;
  let doc: unknown = input;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input);
    } catch (e) {
      return { ok: false, error: `not JSON (${e instanceof Error ? e.message : String(e)})` };
    }
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { ok: false, error: 'not a categorizer (expected an object)' };
  let d = doc as Record<string, unknown>;
  if (d.format !== CATEGORIZER_FORMAT) return { ok: false, error: `not a categorizer (format is ${JSON.stringify(d.format)}, expected "${CATEGORIZER_FORMAT}")` };
  const from = d.version;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) return { ok: false, error: `bad version ${JSON.stringify(from)}` };
  if (from > CATEGORIZER_VERSION) {
    return { ok: false, error: `made by a newer thoremin (version ${from}); this one reads up to version ${CATEGORIZER_VERSION}` };
  }
  for (let v = from; v < CATEGORIZER_VERSION; v++) {
    const step = migrations[v];
    if (!step) return { ok: false, error: `no migration from version ${v}` };
    try {
      const next: unknown = step(d);
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        return { ok: false, error: `migration from version ${v} returned no document` };
      }
      d = next as Record<string, unknown>;
    } catch (e) {
      return { ok: false, error: `migration from version ${v} failed (${e instanceof Error ? e.message : String(e)})` };
    }
    if (d.version !== v + 1) return { ok: false, error: `migration from version ${v} produced version ${JSON.stringify(d.version)}` };
  }
  // The size bounds, before any per-sample work (an untrusted file; see MAX_CATEGORIZER_SAMPLES).
  for (const [key, max] of [
    ['samples', MAX_CATEGORIZER_SAMPLES],
    ['features', MAX_CATEGORIZER_FEATURES],
  ] as const) {
    const list = d[key];
    if (Array.isArray(list) && list.length > max) {
      return { ok: false, error: `invalid categorizer: ${key}: too many (${list.length}; at most ${max})` };
    }
  }
  // Drop non-finite feature values a hand-edited file may carry as null.
  if (Array.isArray(d.samples)) {
    d = {
      ...d,
      samples: d.samples.map((s) =>
        s && typeof s === 'object' && 'vector' in s && s.vector && typeof s.vector === 'object'
          ? { ...s, vector: finiteEntries(s.vector) }
          : s,
      ),
    };
  }
  const parsed = PersonalCategorizerSchema.safeParse(d);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `invalid categorizer: ${first.path.join('.') || '(root)'}: ${first.message}` };
  }
  return { ok: true, categorizer: parsed.data, migratedFrom: from === CATEGORIZER_VERSION ? null : from };
}
