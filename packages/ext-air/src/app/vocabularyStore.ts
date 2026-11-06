/**
 * The air instruments' enrolled vocabularies (#249) — a zodal collection, and the small
 * React-facing store over it.
 *
 * One record per air instrument that reads a shape (the guitar now, the flute next),
 * named by that instrument's id: the player's enrolled entries, samples included
 * (`src/air/vocabulary.ts` is the schema and the training). The samples are the SSOT; the
 * classifier is derived from them on load and after every change, and handed to the
 * DAG through the hot store's transient model slot (`setTransient('airGuitarModel', …)`), never
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
import { createNamedCollectionStore, type NamedCollectionStore } from '@thoremin/sdk-ui/namedCollection';
import { VocabularySchema, emptyVocabulary, trainVocabulary, withEntry, withoutEntry, type TrainVocabularyOptions, type Vocabulary } from '../lib/vocabulary';
import { chordShapeFeatureIds } from '../lib/hand_shape';
import { recordedChordVocabulary } from '../lib/recorded_chords';
import { ALL_FEATURES } from '@thoremin/sdk/features/catalog';
import { MOUTH_GROUPS } from '../nodes/air_flute';
import { fuseWithPrior, priorOptionsFrom, type FingeringPriorSettings } from '../lib/fingering_prior';

/** The mouth gate's reject, in multiples of the enrolment's own reach (see
 *  `TrainVocabularyOptions.rejectScale`). */
export const MOUTH_REJECT_SCALE = 3;
import type { FeatureVector, TrainedModel } from '@thoremin/sdk/enroll';
import { airControls } from './controls';
import { AIR_STORES } from '../stores';

export const VOCABULARIES_STORAGE_KEY = AIR_STORES.vocabularies.legacyKey;

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
  /** Derive and publish the classifier again from the same samples: for when what the
   *  derivation depends on besides the samples (the flute's prior dial) has changed. */
  republish(): void;
  /** Put the seed's entries in (replacing entries of the same names, keeping the player's
   *  others): the guitar's "Use the recorded chords". A no-op without a seed. */
  useSeed(): Promise<void>;
}

export interface VocabularySpec {
  /** The record's name in the collection (the air instrument's id). */
  name: string;
  /** The feature ids a new vocabulary's samples carry. */
  features: readonly string[];
  /** Hand the derived classifier to the instrument (the hot store's transient slot). */
  publish: (model: TrainedModel | null) => void;
  /** How the classifier is trained (closed-set by default). */
  train?: TrainVocabularyOptions;
  /** The record this one replaced, read once while this one does not exist yet, through `turn`:
   *  the flute's fingerings were saved under `flute-fingers` while every hand instrument read the
   *  hand labels swapped (#995), and are kept, turned, under a new name, so a build that still
   *  reads the old record (a rollback, a stale tab) keeps its own and nothing is ever turned twice. */
  replaces?: { name: string; turn: (vocab: Vocabulary) => Vocabulary };
  /** The derivation itself, when it is more than `trainVocabulary` (the flute fuses the
   *  fingering prior in, #263). Receives the vocabulary; the default is `trainVocabulary`
   *  with `train`. */
  derive?: (vocab: Vocabulary) => TrainedModel | null;
  /** The vocabulary a player starts with when nothing is saved (the guitar's recorded chords,
   *  `recorded_chords.ts`); saved only once the player changes it. Absent: empty. */
  seed?: () => Vocabulary;
}

/**
 * One air instrument's vocabulary as a React-facing store: load it, enrol and forget
 * entries, and on every change persist the samples and publish the classifier derived
 * from them. The guitar is one call below; the flute is another.
 */
export function createVocabularyState({ name, features, publish, train = {}, derive, replaces, seed }: VocabularySpec) {
  const model = (vocab: Vocabulary): TrainedModel | null => (derive ? derive(vocab) : trainVocabulary(vocab, train));
  const start = (): Vocabulary => (seed ? seed() : emptyVocabulary(features));
  return create<VocabularyState>()((set, get) => {
    const commit = async (vocab: Vocabulary): Promise<void> => {
      set({ vocab });
      publish(model(vocab));
      try {
        await getStore().save(name, vocab);
        set({ error: null });
      } catch (e) {
        set({ error: `Could not save (${e instanceof Error ? e.message : 'storage failed'}): it plays now, but will be forgotten on reload.` });
      }
    };
    return {
      vocab: start(),
      loaded: false,
      error: null,
      async load() {
        const rec = await getStore().load(name);
        const old = !rec && replaces ? await getStore().load(replaces.name) : null;
        const vocab = rec?.vocabulary ?? (old ? replaces!.turn(old.vocabulary) : start());
        set({ vocab, loaded: true });
        publish(model(vocab));
        if (old) await commit(vocab);
      },
      enrol: (label, samples) => commit(withEntry(get().vocab, label, samples)),
      remove: (label) => commit(withoutEntry(get().vocab, label)),
      republish: () => publish(model(get().vocab)),
      async useSeed() {
        if (!seed) return;
        const given = seed();
        const names = new Set(given.entries.map((e) => e.label));
        await commit({ ...given, entries: [...given.entries, ...get().vocab.entries.filter((e) => !names.has(e.label))] });
      },
    };
  });
}

/** The air guitar's record name in the collection. */
export const GUITAR_VOCABULARY = 'guitar';

/** The air guitar's chords: the recorded ones until the player teaches their own. */
export const useGuitarVocabulary = createVocabularyState({
  name: GUITAR_VOCABULARY,
  features: chordShapeFeatureIds(),
  seed: recordedChordVocabulary,
  publish: (model) => airControls.setTransient('airGuitarModel', model),
});

/** The flute's finger features: both hands' shapes, prefixed by the player's hand. */
export const FLUTE_FINGER_FEATURES: readonly string[] = ['l.', 'r.'].flatMap((p) => chordShapeFeatureIds().map((id) => p + id));

/** The flute's finger model: the enrolment fused with the fingering prior the `airFlute.prior`
 *  dial names (#263), or the enrolment alone when the prior is off. */
export function deriveFluteFingerModel(vocab: Vocabulary, prior: Partial<FingeringPriorSettings> | undefined): TrainedModel | null {
  const options = priorOptionsFrom(prior);
  return options ? fuseWithPrior(vocab, options) : trainVocabulary(vocab);
}

/** A fingering vocabulary with its hands' prefixes swapped (`l.` <-> `r.`): a fingering enrolled
 *  before #995, when the hand labels were read swapped, so its `l.` samples are the player's right. */
export function swapFingeringHands(vocab: Vocabulary): Vocabulary {
  const swap = (k: string) => (k.startsWith('l.') ? `r.${k.slice(2)}` : k.startsWith('r.') ? `l.${k.slice(2)}` : k);
  return {
    ...vocab,
    features: vocab.features.map(swap),
    entries: vocab.entries.map((e) => ({ ...e, samples: e.samples.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [swap(k), v]))) })),
  };
}

/** The air flute's fingerings: both hands' shapes, prefixed by the player's hand. */
export const useFluteFingerVocabulary = createVocabularyState({
  // `flute-fingers` until #995 (the hands named swapped): read once and turned, see `replaces`.
  name: 'flute-fingers-hands',
  replaces: { name: 'flute-fingers', turn: swapFingeringHands },
  features: FLUTE_FINGER_FEATURES,
  publish: (model) => airControls.setTransient('airFluteFingerModel', model),
  derive: (vocab) => deriveFluteFingerModel(vocab, airControls.store().getState().airFlute?.prior),
});

/**
 * Keep the flute's finger model in step with the prior dial: when `airFlute.prior`
 * changes (a settings edit, a loaded instrument), derive the model again from the same
 * samples. Returns the unsubscribe. The comparison is by value, so a re-render of an
 * unchanged dial does not retrain.
 */
/** The slice of the controls the prior sync reads: the flute's dial, its prior. */
type PriorState = { airFlute?: { prior?: Partial<FingeringPriorSettings> } };

export function startFlutePriorSync(
  store: { getState(): PriorState; subscribe(l: (s: PriorState) => void): () => void } = airControls.store(),
  vocabulary: { getState(): Pick<VocabularyState, 'republish'> } = useFluteFingerVocabulary,
): () => void {
  let last = JSON.stringify(store.getState().airFlute?.prior ?? null);
  return store.subscribe((s) => {
    const key = JSON.stringify(s.airFlute?.prior ?? null);
    if (key === last) return;
    last = key;
    vocabulary.getState().republish();
  });
}

/** The air flute's two mouth states (blowing, resting), over the face's mouth features. */
export const useFluteMouthVocabulary = createVocabularyState({
  name: 'flute-mouth',
  features: ALL_FEATURES.filter((f) => (MOUTH_GROUPS as readonly string[]).includes(f.group)).map((f) => f.id),
  publish: (model) => airControls.setTransient('airFluteMouthModel', model),
  // A gate, so open-set: a mouth like neither state (talking, a smile) is not blowing.
  train: { rejectScale: MOUTH_REJECT_SCALE },
});

/** Every air instrument's vocabulary, for the app to load once at start. */
export const AIR_VOCABULARIES = [useGuitarVocabulary, useFluteFingerVocabulary, useFluteMouthVocabulary] as const;

/** Load every air vocabulary (App start), so each classifier is live before anyone opens
 *  its instrument's settings. */
export function loadAirVocabularies(): Promise<void[]> {
  return Promise.all(AIR_VOCABULARIES.map((v) => v.getState().load()));
}
