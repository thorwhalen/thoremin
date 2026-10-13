/**
 * The player's saved face categorizers (#330 P2): a zodal named collection
 * (`createNamedCollectionStore`, localStorage by default, any `DataProvider` later: files, then
 * the cloud with accounts). The record carries the versioned categorizer file of P1
 * (`PersonalCategorizerSchema`: the samples are the source of truth, the model is derived), so
 * the collection and an exported file share one schema, plus the live tuning (P3). Its stills
 * are filed in IndexedDB under its samples' ids (#385 E3), so the record names no take.
 *
 * Several per player, each named; saving under an existing name replaces that one.
 */
import { z } from 'zod';
import { PersonalCategorizerSchema, migrateCategorizerV1, v1SampleId } from '@thoremin/sdk/enroll/categorizer';
import { createNamedCollectionStore, type NamedCollectionStore } from '@thoremin/sdk-ui/namedCollection';
import { TuningSchema } from '../lib/live';
import { holdId } from './thumbnails';

const SavedFaceModelShape = z.object({
  categorizer: PersonalCategorizerSchema,
  /** The live tuning set while testing (#330 P3): about this player's room and camera, so it is
   *  kept with the record on this device and is NOT part of the exported file. Absent = defaults. */
  tuning: TuningSchema.optional(),
});

/**
 * A record saved before #385 E3 carries a version-1 categorizer and the take id its stills are
 * filed under (`<takeId>:<index>`). Its samples are given exactly those keys as ids, so every
 * still is found where it is, never re-filed; without a take id they get the file migration's
 * ids. A record already at version 2 passes through (a leftover `takeId` is stripped).
 */
export function migrateSavedModel(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const { takeId, ...rest } = value as { takeId?: unknown; categorizer?: unknown };
  const c = rest.categorizer;
  if (!c || typeof c !== 'object' || (c as { version?: unknown }).version !== 1) return rest;
  const idFor = typeof takeId === 'string' && takeId.length > 0 ? (i: number) => holdId(takeId, i) : v1SampleId;
  return { ...rest, categorizer: migrateCategorizerV1(c as Record<string, unknown>, { idFor }) };
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

/** localStorage key (the browser default target). */
export const FACE_MODELS_STORAGE_KEY = 'thoremin.faceCategorizers';

export const createFaceModelStore: (provider?: Parameters<ReturnType<typeof createNamedCollectionStore<FaceModelRecord, 'model'>>>[0]) => NamedCollectionStore<FaceModelRecord, SavedFaceModel> =
  createNamedCollectionStore<FaceModelRecord, 'model'>({
    schema: FaceModelRecordSchema,
    storageKey: FACE_MODELS_STORAGE_KEY,
    payloadKey: 'model',
    idFallback: 'faces',
  });

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
