/**
 * The air instruments' enrolled vocabularies (#249) — a zodal collection, and the small
 * React-facing store over it.
 *
 * One record per air instrument that reads a shape (the guitar now, the flute next),
 * named by that instrument's id: the player's enrolled entries, samples included
 * (`src/air/vocabulary.ts` is the schema and the training). The samples are the SSOT; the
 * classifier is derived from them on load and after every change, and handed to the
 * DAG through the hot store's transient model slot (`setAirGuitarModel`), never
 * persisted there.
 *
 * Default target is localStorage, through the {@link createNamedCollectionStore} facade
 * the cues, routines and lab views use; tests pass an in-memory provider through
 * {@link useVocabularyStore}. Persistence is async and off the tick: enrolment saves and
 * re-trains; the node reads only the synchronous hot store.
 *
 * Enrolled vocabularies are per BROWSER, not per instrument profile: they describe the
 * player's hands, and a player's G is the same G in every instrument they save.
 */
import { z } from 'zod';
import { create } from 'zustand';
import type { DataProvider } from '@zodal/store';
import { createNamedCollectionStore, type NamedCollectionStore } from '@/settings/namedCollection';
import { VocabularySchema, emptyVocabulary, trainVocabulary, withEntry, withoutEntry, type Vocabulary } from '@/air/vocabulary';
import { chordShapeFeatureIds } from '@/features/hand_shape';
import type { FeatureVector, TrainedModel } from '@/enroll';
import { useControls } from '@/app/store';

export const VOCABULARIES_STORAGE_KEY = 'thoremin-air-vocabularies';

export const VocabularyRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number(),
  vocabulary: VocabularySchema,
});
export type VocabularyRecord = z.infer<typeof VocabularyRecordSchema>;
export type VocabularyStore = NamedCollectionStore<VocabularyRecord, Vocabulary>;

export const createVocabularyStore = createNamedCollectionStore<VocabularyRecord, 'vocabulary'>({
  schema: VocabularyRecordSchema,
  storageKey: VOCABULARIES_STORAGE_KEY,
  payloadKey: 'vocabulary',
  idFallback: 'vocabulary',
});

let store: VocabularyStore | null = null;
const getStore = (): VocabularyStore => (store ??= createVocabularyStore());

/** Swap the persistence target (tests: an in-memory provider); null restores the default. */
export function useVocabularyStore(provider: DataProvider<VocabularyRecord> | null): void {
  store = provider ? createVocabularyStore(provider) : null;
}

export interface VocabularyState {
  vocab: Vocabulary;
  /** False until the stored vocabulary has been read once. */
  loaded: boolean;
  /** The last save's failure (a full localStorage), or null. The model is updated
   *  either way, so the session plays what was just learned. */
  error: string | null;
  /** Read the stored vocabulary and publish its classifier. */
  load(): Promise<void>;
  /** Save `samples` as the entry named `label` (replacing an entry of that name). */
  enrol(label: string, samples: readonly FeatureVector[]): Promise<void>;
  /** Forget the entry named `label`. */
  remove(label: string): Promise<void>;
}

export interface VocabularySpec {
  /** The record's name in the collection (the air instrument's id). */
  name: string;
  /** The feature ids a new vocabulary's samples carry. */
  features: readonly string[];
  /** Hand the derived classifier to the instrument (the hot store's transient slot). */
  publish: (model: TrainedModel | null) => void;
}

/**
 * One air instrument's vocabulary as a React-facing store: load it, enrol and forget
 * entries, and on every change persist the samples and publish the classifier derived
 * from them. The guitar is one call below; the flute is another.
 */
export function createVocabularyState({ name, features, publish }: VocabularySpec) {
  return create<VocabularyState>()((set, get) => {
    const commit = async (vocab: Vocabulary): Promise<void> => {
      set({ vocab });
      publish(trainVocabulary(vocab));
      try {
        await getStore().save(name, vocab);
        set({ error: null });
      } catch (e) {
        set({ error: `Could not save (${e instanceof Error ? e.message : 'storage failed'}): it plays now, but will be forgotten on reload.` });
      }
    };
    return {
      vocab: emptyVocabulary(features),
      loaded: false,
      error: null,
      async load() {
        const rec = await getStore().load(name);
        const vocab = rec?.vocabulary ?? emptyVocabulary(features);
        set({ vocab, loaded: true });
        publish(trainVocabulary(vocab));
      },
      enrol: (label, samples) => commit(withEntry(get().vocab, label, samples)),
      remove: (label) => commit(withoutEntry(get().vocab, label)),
    };
  });
}

/** The air guitar's record name in the collection. */
export const GUITAR_VOCABULARY = 'guitar';

/** The air guitar's chords. */
export const useGuitarVocabulary = createVocabularyState({
  name: GUITAR_VOCABULARY,
  features: chordShapeFeatureIds(),
  publish: (model) => useControls.getState().setAirGuitarModel(model),
});

/** Every air instrument's vocabulary, for the app to load once at start. */
export const AIR_VOCABULARIES = [useGuitarVocabulary] as const;

/** Load every air vocabulary (App start), so each classifier is live before anyone opens
 *  its instrument's settings. */
export function loadAirVocabularies(): Promise<void[]> {
  return Promise.all(AIR_VOCABULARIES.map((v) => v.getState().load()));
}
