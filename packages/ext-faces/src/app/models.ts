/**
 * The player's saved categorizers (#330 P2; every modality's since #385 E8, `./categorizers.ts`): a zodal named collection
 * (`createNamedCollectionStore`, localStorage by default, any `DataProvider` later: files, then
 * the cloud with accounts). The record carries the versioned categorizer file of P1
 * (`PersonalCategorizerSchema`: the samples are the source of truth, the model is derived), so
 * the collection and an exported file share one schema, plus the live tuning (P3). Its stills
 * are filed in IndexedDB under its samples' ids (#385 E3), so the record names no take.
 *
 * Several per player, each named; saving under an existing name replaces that one.
 */
import { z } from 'zod';
import { PersonalCategorizerSchema, migrateCategorizerV1, migrateCategorizerV2, v1SampleId } from '@thoremin/sdk/enroll/categorizer';
import type { DataProvider, NamedCollectionStore } from '@thoremin/sdk-ui/namedCollection';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { CATEGORIZERS_STORAGE_KEY, createCategorizerStore } from './categorizers';
import { QuizResultSchema } from '@thoremin/sdk/enroll/quiz';
import { EverydayResultSchema } from '@thoremin/sdk/enroll/everyday';
import { TuningSchema } from '../lib/live';
import { holdId } from './thumbnails';

/** What the player's checks found (#385 E7), kept with the record on this device like the
 *  tuning (local only: nothing is sent anywhere): the last quiz (per-category reproducibility)
 *  and the last everyday check (accidental fires). Not part of the exported file. */
export const CategorizerChecksSchema = z.object({
  quiz: QuizResultSchema.optional(),
  everyday: EverydayResultSchema.optional(),
});
export type CategorizerChecks = z.infer<typeof CategorizerChecksSchema>;

const SavedFaceModelShape = z.object({
  categorizer: PersonalCategorizerSchema,
  /** The live tuning set while testing (#330 P3): about this player's room and camera, so it is
   *  kept with the record on this device and is NOT part of the exported file. Absent = defaults. */
  tuning: TuningSchema.optional(),
  /** The quiz's and the everyday check's last results (#385 E7). Absent = never run. */
  checks: CategorizerChecksSchema.optional(),
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

export const SavedFaceModelSchema = z.preprocess(migrateSavedModel, SavedFaceModelShape);
export type SavedFaceModel = z.infer<typeof SavedFaceModelSchema>;

export const FaceModelRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number(),
  model: SavedFaceModelSchema,
});
export type FaceModelRecord = z.infer<typeof FaceModelRecordSchema>;

/** Where face categorizers are stored: the one collection of every modality since #385 E8 (the
 *  face collection before it, `thoremin.faceCategorizers`, is copied once and left; see
 *  `./categorizers.ts`). */
export const FACE_MODELS_STORAGE_KEY = CATEGORIZERS_STORAGE_KEY;

/** The face's view of the one collection (`provider`: where it lives; the browser's localStorage,
 *  with the one-time copy of the old face collection, by default). */
export function createFaceModelStore(provider?: DataProvider<FaceModelRecord>): NamedCollectionStore<FaceModelRecord, SavedFaceModel> {
  return createCategorizerStore(faceModality, provider ? { provider } : {});
}

/**
 * Saved categorizers changed (a save, a replace, a delete): the listeners re-read what they hold.
 * How an instrument playing a categorizer picks up a correction made in the tool (#330 P4)
 * without polling. In-page only; another tab's edit reaches this one on its next load.
 */
const changeListeners = new Set<() => void>();

export function onFaceModelsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** `store` with a change notice after every save and remove. */
export function withChangeNotice(store: NamedCollectionStore<FaceModelRecord, SavedFaceModel>): NamedCollectionStore<FaceModelRecord, SavedFaceModel> {
  const notify = () => {
    for (const l of [...changeListeners]) l();
  };
  return {
    ...store,
    save: async (name, payload, now) => {
      const out = await store.save(name, payload, now);
      notify();
      return out;
    },
    remove: async (id: string) => {
      await store.remove(id);
      notify();
    },
  };
}
