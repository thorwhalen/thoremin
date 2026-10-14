/**
 * A saved personal categorizer as the ONE collection stores it (#385 E8, #387 C5, #371): the
 * record shapes of `thoremin.categorizers`, shared by the tools that make categorizers (the
 * faces extension's carve tools, the host's Trainer) and the host's command bindings that read
 * them. Pure schemas and ids; where the collection lives is `@thoremin/sdk-ui/enroll/categorizers`.
 *
 * Two kinds of record, one envelope (`id`, `name`, `createdAt`, `model`):
 *
 * - **A carved categorizer** (`model.categorizer`): P1's versioned file, whose samples are the
 *   source of truth and whose model is derived, plus what is kept on this device only and never
 *   exported: the live tuning (P3), the checks' results (E7) and, since #371, the command
 *   bindings. Its kind is the file's modality (`face`, `hand`, `body`; absent = `face`).
 * - **A trained model** (`model.trained`, kind {@link TRAINED_KIND}): a model kept as it is, with
 *   no samples to derive it from, so it cannot be re-carved, only played and bound. The
 *   Trainer's "Save and bind" makes these, and the bound sets saved before #371 that no carved
 *   categorizer can take over are migrated as these (`read` says how such a copy reads the live
 *   vector, as it did).
 *
 * Bindings are keyed by category id and live on the record they name, so deleting a categorizer
 * deletes its bindings and an edit carries them by name (`rekeyBindings`).
 */
import { z } from 'zod';
import { slugId } from '../util/ids';
import { CategoryBindingSchema, CategoryReadSchema, TrainedModelSchema, type NamedCategory } from './bind';
import { PersonalCategorizerSchema, migrateCategorizerV1, migrateCategorizerV2, v1SampleId } from './categorizer';
import { EverydayResultSchema } from './everyday';
import { TuningSchema } from './live';
import { QuizResultSchema } from './quiz';

/** A hold's id, which is also its still's key: `<takeId>:<n>` (#385 E3). */
export const holdId = (takeId: string, n: number): string => `${takeId}:${n}`;

/** Category id -> its command binding (#160), kept with the record on this device. */
export const RecordBindingsSchema = z.record(z.string(), CategoryBindingSchema);
export type RecordBindings = z.infer<typeof RecordBindingsSchema>;

/** What the player's checks found (#385 E7), kept with the record on this device like the
 *  tuning (local only: nothing is sent anywhere): the last quiz (per-category reproducibility)
 *  and the last everyday check (accidental fires). Not part of the exported file. */
export const CategorizerChecksSchema = z.object({
  quiz: QuizResultSchema.optional(),
  everyday: EverydayResultSchema.optional(),
});
export type CategorizerChecks = z.infer<typeof CategorizerChecksSchema>;

const SavedCategorizerShape = z.object({
  categorizer: PersonalCategorizerSchema,
  /** The live tuning set while testing (#330 P3): about this player's room and camera, so it is
   *  kept with the record on this device and is NOT part of the exported file. Absent = defaults. */
  tuning: TuningSchema.optional(),
  /** The quiz's and the everyday check's last results (#385 E7). Absent = never run. */
  checks: CategorizerChecksSchema.optional(),
  /** Its categories' command bindings (#371). Absent = none. */
  bindings: RecordBindingsSchema.optional(),
});

/**
 * A record saved before #385 E3 carries a version-1 categorizer and the take id its stills are
 * filed under (`<takeId>:<index>`). Its samples are given exactly those keys as ids, so every
 * still is found where it is, never re-filed; without a take id they get the file migration's
 * ids. A version-2 categorizer (before #385 E5) migrates to version 3 with its Neutral holds
 * untrained, as they were. A record at the current version passes through (a leftover `takeId`
 * is stripped).
 */
export function migrateSavedModel(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const { takeId, ...rest } = value as { takeId?: unknown; categorizer?: unknown };
  let c = rest.categorizer;
  if (!c || typeof c !== 'object') return rest;
  if ((c as { version?: unknown }).version === 1) {
    const idFor = typeof takeId === 'string' && takeId.length > 0 ? (i: number) => holdId(takeId, i) : v1SampleId;
    c = migrateCategorizerV1(c as Record<string, unknown>, { idFor });
  }
  if ((c as { version?: unknown }).version === 2) c = migrateCategorizerV2(c as Record<string, unknown>);
  return { ...rest, categorizer: c };
}

/** A carved categorizer's payload (older records migrate on the way in). */
export const SavedCategorizerSchema = z.preprocess(migrateSavedModel, SavedCategorizerShape);
export type SavedCategorizer = z.infer<typeof SavedCategorizerSchema>;

const envelope = { id: z.string().min(1), name: z.string().min(1), createdAt: z.number() };

export const CategorizerRecordSchema = z.object({ ...envelope, model: SavedCategorizerSchema });
export type CategorizerRecord = z.infer<typeof CategorizerRecordSchema>;

/** The kind of a record that keeps a trained model as it is (no samples). */
export const TRAINED_KIND = 'trained';

export const TrainedPayloadSchema = z.object({
  trained: TrainedModelSchema,
  /** How it reads the live vector (a migrated copy of a carved categorizer); absent: as is. */
  read: CategoryReadSchema.optional(),
  bindings: RecordBindingsSchema.default({}),
});
export type TrainedPayload = z.infer<typeof TrainedPayloadSchema>;

export const TrainedRecordSchema = z.object({ ...envelope, model: TrainedPayloadSchema });
export type TrainedRecord = z.infer<typeof TrainedRecordSchema>;

export type AnyCategorizerRecord = CategorizerRecord | TrainedRecord;

/** A record's kind, read from its RAW shape (so a record that no longer validates still belongs
 *  to a view, which lists it and can delete it): {@link TRAINED_KIND}, else its file's modality
 *  (`face` for a file that does not say). */
export function recordKind(raw: unknown): string {
  const model = (raw as { model?: { trained?: unknown; categorizer?: { modality?: unknown } } } | null)?.model;
  if (model && model.trained !== undefined && model.categorizer === undefined) return TRAINED_KIND;
  const m = model?.categorizer?.modality;
  return typeof m === 'string' ? m : 'face';
}

/** Whether a validated record keeps a trained model (else it is a carved categorizer). */
export const isTrainedRecord = (r: AnyCategorizerRecord): r is TrainedRecord => 'trained' in r.model;

/** Parse a stored record of either kind (null when it does not validate). */
export function parseRecord(raw: unknown): AnyCategorizerRecord | null {
  const parsed = recordKind(raw) === TRAINED_KIND ? TrainedRecordSchema.safeParse(raw) : CategorizerRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The categories a record's bindings name. */
export function recordCategories(r: AnyCategorizerRecord): readonly NamedCategory[] {
  return isTrainedRecord(r) ? r.model.trained.categories : r.model.categorizer.categories;
}

/** A record's bindings (none when it has none). */
export const recordBindings = (r: AnyCategorizerRecord): RecordBindings => r.model.bindings ?? {};

/** The id a categorizer named `name` gets in `modality`'s view: a face keeps the bare slug of its
 *  name (an instrument's `faceCategorizer` dial names it, so it must not move), every other kind
 *  is prefixed (`hand:fist`). A slug never contains `:`, so no two kinds collide. */
export function categorizerId(modality: { id: string; words: { slug: string } }, name: string): string {
  return modality.id === 'face' ? slugId(name, modality.words.slug) : `${modality.id}:${slugId(name, modality.words.slug)}`;
}

/** The words of the trained kind (its view's ids and copy). */
export const TRAINED_WORDS = { slug: 'categories' } as const;

/** The id a trained model saved under `name` gets: `trained:<slug>`. */
export const trainedId = (name: string): string => categorizerId({ id: TRAINED_KIND, words: TRAINED_WORDS }, name);
