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
 * A sample may belong to no category, in either mode: a held pose the player left out (or
 * one outside every category in `reject` mode) is still evidence they gave, and re-carving
 * the samples may use it. The mode is about LIVE vectors, below, not about the samples.
 *
 * ## Partition or reject: stated, not inferred
 *
 * `mode: 'partition'` means every vector belongs to some category (k counts the player's
 * neutral as a category); `mode: 'reject'` means a vector beyond `rejectRadius` belongs to
 * none (k counts only the expressions). The derived model's `rejectRadius` is
 * `Number.MAX_VALUE` in partition mode (finite, so the derived model still persists under
 * `TrainedModelSchema`, whose `z.number()` refuses `Infinity`).
 *
 * ## Versions and migration
 *
 * Every file carries `format` and `version`. {@link importCategorizer} reads a file of an
 * older version through a chain of migrations (`migrations[n]` takes a version-n document
 * to version n+1), refuses a NEWER version with a message saying so (never a silent
 * partial read), and validates the result against the current schema. Bump
 * {@link CATEGORIZER_VERSION} and add `CATEGORIZER_MIGRATIONS[old]` together.
 *
 * Non-finite feature values (a feature not measurable on that frame) are DROPPED on the way
 * in: JSON cannot carry NaN, and a missing key is exactly how every distance in `enroll/`
 * already treats a non-finite value.
 */
import { z } from 'zod';
import { trainModel } from './classify';
import type { FeatureVector, StillPoint, TrainedModel } from './types';

export const CATEGORIZER_FORMAT = 'thoremin.categorizer';
/** The version this build writes. */
export const CATEGORIZER_VERSION = 1;
export const CATEGORIZER_MODES = ['partition', 'reject'] as const;
export type CategorizerMode = (typeof CATEGORIZER_MODES)[number];

/** The derived model's reject radius in partition mode: nothing is ever rejected. */
export const NO_REJECT_RADIUS = Number.MAX_VALUE;

const SampleSchema = z.object({
  vector: z.record(z.string(), z.number()),
  t: z.number(),
  cue: z.string(),
});

const CategorizerCategorySchema = z.object({
  /** Stable id: what a binding refers to. */
  id: z.string().min(1),
  label: z.string(),
  /** Indices into `samples`, ascending. */
  members: z.array(z.number().int().nonnegative()).min(1),
});

export const PersonalCategorizerSchema = z
  .object({
    format: z.literal(CATEGORIZER_FORMAT),
    version: z.literal(CATEGORIZER_VERSION),
    name: z.string(),
    /** What the features describe (`face`, `hands`, ...). Informational. */
    modality: z.string().min(1).optional(),
    /** ISO time of creation. Informational. */
    createdAt: z.string().optional(),
    /** The feature space: the ids distances use, in order. */
    features: z.array(z.string().min(1)).min(1),
    /** Per-feature distance weight (1/sigma x nuisance for a session model). */
    weights: z.record(z.string(), z.number().nonnegative()),
    mode: z.enum(CATEGORIZER_MODES),
    /** The number of categories (equals `categories.length`). */
    k: z.number().int().positive(),
    /** Required in `reject` mode; ignored in `partition` mode. */
    rejectRadius: z.number().positive().optional(),
    samples: z.array(SampleSchema),
    categories: z.array(CategorizerCategorySchema).min(1),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
    if (c.k !== c.categories.length) issue(`k is ${c.k} but there are ${c.categories.length} categories`, ['k']);
    if (c.mode === 'reject' && c.rejectRadius === undefined) issue('reject mode needs a rejectRadius', ['rejectRadius']);
    const ids = new Set<string>();
    const seen = new Set<number>();
    c.categories.forEach((cat, i) => {
      if (ids.has(cat.id)) issue(`duplicate category id "${cat.id}"`, ['categories', i, 'id']);
      ids.add(cat.id);
      const own = new Set<number>();
      for (const j of cat.members) {
        if (j >= c.samples.length) issue(`member ${j} is out of range (${c.samples.length} samples)`, ['categories', i, 'members']);
        else if (own.has(j)) issue(`sample ${j} is listed twice in category "${cat.id}"`, ['categories', i, 'members']);
        else if (seen.has(j)) issue(`sample ${j} belongs to two categories`, ['categories', i, 'members']);
        own.add(j);
        seen.add(j);
      }
    });
  });

export type PersonalCategorizer = z.infer<typeof PersonalCategorizerSchema>;
export type CategorizerSample = z.infer<typeof SampleSchema>;

/** A copy of `v` without its non-finite entries (JSON cannot carry them). */
function finiteOnly(v: FeatureVector): FeatureVector {
  const out: FeatureVector = {};
  for (const [k, x] of Object.entries(v)) if (Number.isFinite(x)) out[k] = x;
  return out;
}

/** A still-point as a stored sample. */
export function toSample(p: Pick<StillPoint, 'vector' | 't' | 'cue'>): CategorizerSample {
  return { vector: finiteOnly(p.vector), t: Number.isFinite(p.t) ? p.t : 0, cue: p.cue };
}

export interface CategorizerMeta {
  name: string;
  mode: CategorizerMode;
  modality?: string;
  createdAt?: string;
}

/**
 * Capture a trained model as a categorizer. `samples` is the pool the model's `members`
 * index (the session's `points()`). Throws if the result does not validate.
 */
export function categorizerFromModel(
  model: TrainedModel,
  samples: readonly Pick<StillPoint, 'vector' | 't' | 'cue'>[],
  meta: CategorizerMeta,
): PersonalCategorizer {
  return PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: meta.name,
    ...(meta.modality ? { modality: meta.modality } : {}),
    ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
    features: [...model.features],
    weights: { ...model.weights },
    mode: meta.mode,
    k: model.categories.length,
    ...(meta.mode === 'reject' ? { rejectRadius: model.rejectRadius } : {}),
    samples: samples.map(toSample),
    categories: model.categories.map((c) => ({ id: c.id, label: c.label, members: [...c.members].sort((a, b) => a - b) })),
  });
}

/**
 * The live model a categorizer describes: centroids and radii recomputed from its samples,
 * its ids and labels kept, its cue counts filled, its reject radius from its mode. The input
 * is validated first (throws if invalid): an unvalidated empty category would otherwise
 * shift every later category's id and label onto its neighbour's members.
 */
export function modelFromCategorizer(input: PersonalCategorizer): TrainedModel {
  const c = PersonalCategorizerSchema.parse(input);
  const vectors = c.samples.map((s) => s.vector);
  const trained = trainModel(
    vectors,
    c.categories.map((cat) => cat.members),
    c.features,
    c.weights,
  );
  // No category is empty (the schema refuses it), so `trainModel` kept them all, in order.
  const categories = trained.categories.map((cat, i) => {
    const cues: Record<string, number> = {};
    for (const j of cat.members) cues[c.samples[j].cue] = (cues[c.samples[j].cue] ?? 0) + 1;
    return { ...cat, id: c.categories[i].id, label: c.categories[i].label, cues };
  });
  return {
    ...trained,
    categories,
    rejectRadius: c.mode === 'reject' ? c.rejectRadius! : NO_REJECT_RADIUS,
  };
}

/** Takes a version-n document to version n+1. */
export type CategorizerMigration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** The shipped migrations, keyed by the version they read. Empty while v1 is the only one. */
export const CATEGORIZER_MIGRATIONS: Readonly<Record<number, CategorizerMigration>> = {};

export type ImportResult =
  | { ok: true; categorizer: PersonalCategorizer; migratedFrom: number | null }
  | { ok: false; error: string };

export interface ImportOptions {
  migrations?: Readonly<Record<number, CategorizerMigration>>;
}

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
  // Drop non-finite feature values a hand-edited file may carry as null.
  if (Array.isArray(d.samples)) {
    d = {
      ...d,
      samples: d.samples.map((s) =>
        s && typeof s === 'object' && 'vector' in s && s.vector && typeof s.vector === 'object'
          ? { ...s, vector: Object.fromEntries(Object.entries(s.vector as Record<string, unknown>).filter(([, x]) => typeof x === 'number' && Number.isFinite(x))) }
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
