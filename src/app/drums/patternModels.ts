/**
 * Pattern models (#269) — what a training take taught, one record per pattern, a zodal
 * named collection like the pad layouts.
 *
 * The record's name is the pattern's id, so training a pattern again replaces its model
 * (the fit is over one take; a better take is the whole answer, not an average). The
 * playback mode reads the model for the pattern the `airDrum.pattern` dial names; the
 * trainer writes it. Default target localStorage; tests pass an in-memory provider.
 */
import { z } from 'zod';
import type { DataProvider } from '@zodal/store';
import { PatternModelSchema, type PatternModel } from '@/drums/pattern_fit';
import { createNamedCollectionStore, type NamedCollectionStore } from '@/settings/namedCollection';

export const PATTERN_MODELS_STORAGE_KEY = 'thoremin-drum-pattern-models';

export const PatternModelRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number(),
  model: PatternModelSchema,
});
export type PatternModelRecord = z.infer<typeof PatternModelRecordSchema>;
export type PatternModelStore = NamedCollectionStore<PatternModelRecord, PatternModel>;

export const createPatternModelStore = createNamedCollectionStore<PatternModelRecord, 'model'>({
  schema: PatternModelRecordSchema,
  storageKey: PATTERN_MODELS_STORAGE_KEY,
  payloadKey: 'model',
  idFallback: 'pattern',
});

let store: PatternModelStore | null = null;
const getStore = (): PatternModelStore => (store ??= createPatternModelStore());

/** Swap the persistence target (tests: an in-memory provider); null restores the default. */
export function usePatternModelStore(provider: DataProvider<PatternModelRecord> | null): void {
  store = provider ? createPatternModelStore(provider) : null;
}

/** The model trained for a pattern, or null. */
export async function loadPatternModel(patternId: string): Promise<PatternModel | null> {
  const rec = await getStore().load(patternId);
  return rec?.model ?? null;
}

/** Save (replace) the model for its pattern. */
export async function savePatternModel(model: PatternModel): Promise<void> {
  await getStore().save(model.patternId, model);
}

export function removePatternModel(patternId: string): Promise<void> {
  return getStore().remove(patternId);
}

/** The ids of every pattern with a model. */
export async function trainedPatternIds(): Promise<string[]> {
  return (await getStore().list()).map((s) => s.id);
}
