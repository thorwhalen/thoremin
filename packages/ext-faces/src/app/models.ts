/**
 * The player's saved face categorizers (#330 P2): a zodal named collection
 * (`createNamedCollectionStore`, localStorage by default, any `DataProvider` later: files, then
 * the cloud with accounts). The record carries the versioned categorizer file of P1
 * (`PersonalCategorizerSchema`: the samples are the source of truth, the model is derived), so
 * the collection and an exported file share one schema, plus the take id its stills are filed
 * under in IndexedDB, and the live tuning (P3).
 *
 * Several per player, each named; saving under an existing name replaces that one.
 */
import { z } from 'zod';
import { PersonalCategorizerSchema } from '@thoremin/sdk/enroll/categorizer';
import { createNamedCollectionStore, type NamedCollectionStore } from '@thoremin/sdk-ui/namedCollection';
import { TuningSchema } from '../lib/live';

export const SavedFaceModelSchema = z.object({
  categorizer: PersonalCategorizerSchema,
  /** The take whose stills (`<takeId>:<index>`) show this categorizer's exemplars; null without. */
  takeId: z.string().min(1).nullable(),
  /** The live tuning set while testing (#330 P3): about this player's room and camera, so it is
   *  kept with the record on this device and is NOT part of the exported file. Absent = defaults. */
  tuning: TuningSchema.optional(),
});
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
