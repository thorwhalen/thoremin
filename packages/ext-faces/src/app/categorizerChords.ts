/**
 * The instrument's categorizer chords, resolved off the tick (#450): the host side of the
 * `categorizer-chord` node, as `./posePlay.ts` is for the pose categorizer. It watches the
 * `categorizerChords` dial, loads the saved hand-shape or pose categorizer it names from the one
 * categorizer collection (the view of the id's modality), derives the live model under the
 * record's own tuning (`../lib/categorizerChord.ts`), and hands it to the DAG through the
 * `categorizerChordsModel` transient.
 *
 * It re-resolves when the dial names another categorizer and when the saved categorizers change,
 * and drops the answer to a request a later one has overtaken. A record this device does not have
 * publishes null: nothing plays, and the panel says why.
 *
 * While the dial names a categorizer it CLAIMS that modality's feature groups (#163's feature
 * demand, owner {@link CATEGORIZER_CHORDS_DEMAND_OWNER}): the hand and body vector nodes compute
 * only what something claims, so without the claim the node would read an empty vector.
 */
import { create } from 'zustand';
import { controls } from '@thoremin/sdk-ui/host';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { CHORD_MODALITY, categorizerChordPlay, type CategorizerChordPlay } from '../lib/categorizerChord';
import { chordModalityOf, type CategorizerChordsDial, type ChordModality } from '../schema';
import { onFaceModelsChanged, type FaceModelRecord } from './models';

/** The transient field the node reads (declared by the manifest, `../index.ts`). */
export const CATEGORIZER_CHORDS_MODEL_FIELD = 'categorizerChordsModel';

/** The feature-demand owner of the playing categorizer's groups. */
export const CATEGORIZER_CHORDS_DEMAND_OWNER = 'categorizer-chords';

export interface CategorizerChordsState {
  /** `none`: the dial names no categorizer. `loading`: reading the record. `ready`: it is in the
   *  graph. `missing`: this device has no such categorizer, so nothing plays. */
  phase: 'none' | 'loading' | 'ready' | 'missing';
  id: string | null;
  modality: ChordModality | null;
  name: string | null;
  /** Its categories, in order. */
  categories: readonly { id: string; name: string }[];
}

const IDLE: CategorizerChordsState = { phase: 'none', id: null, modality: null, name: null, categories: [] };

export const useCategorizerChords = create<CategorizerChordsState>(() => IDLE);

export interface CategorizerChordsDeps {
  load(modality: ChordModality, id: string): Promise<FaceModelRecord | null>;
  dial(): Partial<CategorizerChordsDial> | undefined;
  subscribe(listener: () => void): () => void;
  onModelsChanged(listener: () => void): () => void;
  publish(play: CategorizerChordPlay | null): void;
  /** Claim the feature groups of `modality`, or release them (null). */
  claim(modality: ChordModality | null): void;
}

/** The browser's dependencies: the hot store through the SDK host and the one categorizer
 *  collection, viewed by the id's modality. */
export function browserCategorizerChordsDeps(): CategorizerChordsDeps {
  const stores = { hand: createCategorizerStore(CHORD_MODALITY.hand), body: createCategorizerStore(CHORD_MODALITY.body) };
  return {
    load: (modality, id) => stores[modality].load(id),
    dial: () => controls().get().categorizerChords as Partial<CategorizerChordsDial> | undefined,
    subscribe: (l) => controls().subscribe(l),
    onModelsChanged: onFaceModelsChanged,
    publish: (play) => controls().setTransient(CATEGORIZER_CHORDS_MODEL_FIELD, play),
    claim: (modality) =>
      modality ? appFeatureDemand.claim(CATEGORIZER_CHORDS_DEMAND_OWNER, CHORD_MODALITY[modality].groups) : appFeatureDemand.release(CATEGORIZER_CHORDS_DEMAND_OWNER),
  };
}

/** Start resolving; returns the stop. Resolves once at start. */
export function startCategorizerChords(deps: CategorizerChordsDeps = browserCategorizerChordsDeps()): () => void {
  let wanted: string | null | undefined;
  let seq = 0;
  let stopped = false;
  /** What was last published, by record (a save of something else must not reset the reading). */
  let publishedKey: string | null = null;
  const publish = (play: CategorizerChordPlay | null, key: string | null) => {
    if (key !== null && key === publishedKey) return;
    publishedKey = key;
    deps.publish(play);
  };

  const resolve = async (force: boolean): Promise<void> => {
    const dial = deps.dial();
    const modality = chordModalityOf(dial?.id);
    const id = modality ? (dial!.id as string) : null;
    if (!force && id === wanted) return;
    wanted = id;
    const mine = ++seq;
    deps.claim(modality);
    if (id === null || modality === null) {
      publish(null, null);
      useCategorizerChords.setState(IDLE);
      return;
    }
    if (useCategorizerChords.getState().id !== id) useCategorizerChords.setState({ ...IDLE, phase: 'loading', id, modality });
    let record: FaceModelRecord | null = null;
    try {
      record = await deps.load(modality, id);
    } catch {
      record = null;
    }
    if (stopped || mine !== seq) return;
    if (!record || (record.model.categorizer.modality ?? 'face') !== CHORD_MODALITY[modality].id) {
      publish(null, null);
      useCategorizerChords.setState({ ...IDLE, phase: 'missing', id, modality });
      return;
    }
    // What the play is made of: bindings and checks ride the record too (#371) but change nothing
    // about the reading, so an edit of them must not reset it.
    const key = JSON.stringify([record.id, record.name, record.model.categorizer, record.model.tuning]);
    const play = key === publishedKey ? null : categorizerChordPlay({ id: record.id, name: record.name, modality, categorizer: record.model.categorizer, tuning: record.model.tuning });
    if (play) publish(play, key);
    useCategorizerChords.setState({
      phase: 'ready',
      id,
      modality,
      name: record.name,
      categories: record.model.categorizer.categories.map((c) => ({ id: c.id, name: c.label })),
    });
  };

  const unsubscribe = deps.subscribe(() => void resolve(false));
  const unwatch = deps.onModelsChanged(() => void resolve(true));
  void resolve(true);
  return () => {
    stopped = true;
    unsubscribe();
    unwatch();
    deps.claim(null);
  };
}
