/**
 * The player's saved categorizers (#330 P2; every modality's since #385 E8, `@thoremin/sdk-ui/enroll/categorizers`): a zodal named collection
 * (`createNamedCollectionStore`, localStorage by default, any `DataProvider` later: files, then
 * the cloud with accounts). The record carries the versioned categorizer file of P1
 * (`PersonalCategorizerSchema`: the samples are the source of truth, the model is derived), so
 * the collection and an exported file share one schema, plus the live tuning (P3). Its stills
 * are filed in IndexedDB under its samples' ids (#385 E3), so the record names no take.
 *
 * Several per player, each named; saving under an existing name replaces that one.
 */
import type { DataProvider, NamedCollectionStore } from '@thoremin/sdk-ui/namedCollection';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { CategorizerRecordSchema, SavedCategorizerSchema, type CategorizerRecord, type SavedCategorizer } from '@thoremin/sdk/enroll/record';
import { CATEGORIZERS_STORAGE_KEY, createCategorizerStore, onCategorizersChanged, withChangeNotice as withNotice } from '@thoremin/sdk-ui/enroll/categorizers';

// The record shapes are the SDK's since #371 (the host's command bindings read the same records);
// these are the names this extension has always used for them.
export { CategorizerChecksSchema, migrateSavedModel, type CategorizerChecks } from '@thoremin/sdk/enroll/record';
export const SavedFaceModelSchema = SavedCategorizerSchema;
export type SavedFaceModel = SavedCategorizer;
export const FaceModelRecordSchema = CategorizerRecordSchema;
export type FaceModelRecord = CategorizerRecord;

/** Where face categorizers are stored: the one collection of every modality since #385 E8 (the
 *  face collection before it, `thoremin.faceCategorizers`, is copied once and left; see
 *  `./categorizers.ts`). */
export const FACE_MODELS_STORAGE_KEY = CATEGORIZERS_STORAGE_KEY;

/** The face's view of the one collection (`provider`: where it lives; the browser's localStorage,
 *  with the one-time copy of the old face collection, by default). */
export function createFaceModelStore(provider?: DataProvider<FaceModelRecord>): NamedCollectionStore<FaceModelRecord, SavedFaceModel> {
  return createCategorizerStore(faceModality, provider ? { provider } : {});
}

/** Saved categorizers changed (a save, a replace, a delete): the listeners re-read what they hold.
 *  How an instrument playing a categorizer picks up a correction made in the tool (#330 P4)
 *  without polling. The collection's notice (`@thoremin/sdk-ui/enroll/categorizers`). */
export const onFaceModelsChanged = onCategorizersChanged;

/** `store` with a change notice after every save and remove. */
export function withChangeNotice(store: NamedCollectionStore<FaceModelRecord, SavedFaceModel>): NamedCollectionStore<FaceModelRecord, SavedFaceModel> {
  return withNotice(store);
}
