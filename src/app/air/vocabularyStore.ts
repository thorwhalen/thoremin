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
import type { FeatureVector } from '@/enroll';
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

/** The air guitar's record name in the collection. */
export const GUITAR_VOCABULARY = 'guitar';

let store: VocabularyStore | null = null;
const getStore = (): VocabularyStore => (store ??= createVocabularyStore());

/** Swap the persistence target (tests: an in-memory provider); null restores the default. */
export function useVocabularyStore(provider: DataProvider<VocabularyRecord> | null): void {
  store = provider ? createVocabularyStore(provider) : null;
}

export interface GuitarVocabularyState {
  vocab: Vocabulary;
  /** False until the stored vocabulary has been read once. */
  loaded: boolean;
  /** Read the stored vocabulary and hand its classifier to the instrument. */
  load(): Promise<void>;
  /** Save `samples` as the chord named `label` (replacing an entry of that name). */
  enrol(label: string, samples: readonly FeatureVector[]): Promise<void>;
  /** Forget the chord named `label`. */
  remove(label: string): Promise<void>;
}

/** Commit a vocabulary: persist it, and hand its (derived) classifier to the DAG. */
async function commit(vocab: Vocabulary): Promise<void> {
  await getStore().save(GUITAR_VOCABULARY, vocab);
  useControls.getState().setAirGuitarModel(trainVocabulary(vocab));
}

export const useGuitarVocabulary = create<GuitarVocabularyState>()((set, get) => ({
  vocab: emptyVocabulary(chordShapeFeatureIds()),
  loaded: false,
  async load() {
    const rec = await getStore().load(GUITAR_VOCABULARY);
    // A vocabulary taken with another feature set (the featurizer changed) is kept, but
    // its feature ids are what the model trains on, so it still classifies what it can.
    const vocab = rec?.vocabulary ?? emptyVocabulary(chordShapeFeatureIds());
    set({ vocab, loaded: true });
    useControls.getState().setAirGuitarModel(trainVocabulary(vocab));
  },
  async enrol(label, samples) {
    const vocab = withEntry(get().vocab, label, samples);
    set({ vocab });
    await commit(vocab);
  },
  async remove(label) {
    const vocab = withoutEntry(get().vocab, label);
    set({ vocab });
    await commit(vocab);
  },
}));
