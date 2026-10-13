/**
 * The instrument's categorizer, resolved off the tick (#330 P4): the host side of the
 * `face-categorizer` node. It watches the `faceCategorizer` dial, loads the saved record the dial
 * names, derives the live model under the record's own tuning (`../lib/play.ts`), and hands it
 * to the DAG through the `faceCategorizerModel` transient. The air vocabularies' precedent: the
 * samples are the source of truth, the model is derived, the tick never awaits a provider.
 *
 * It re-resolves when the dial names another categorizer (a settings edit, an instrument
 * switch) and when the saved categorizers change (a correction saved in the tool), and drops
 * the answer to a request a later one has overtaken. A record this device does not have
 * publishes null: the node then plays the general model, and the panel says why.
 *
 * Every dependency is injected ({@link CategorizerPlayDeps}); {@link startCategorizerPlay} with
 * no argument binds the browser's (the hot store through the SDK's controls host, the
 * localStorage collection, and for a `shared:` id the shipped shared categorizers, #330 P5,
 * which play with no tuning).
 */
import { create } from 'zustand';
import { controls } from '@thoremin/sdk-ui/host';
import type { ExpressionLabel } from '@thoremin/sdk/music/expression';
import { categorizerPlay, type FaceCategorizerPlay } from '../lib/play';
import { isPersonal, type FaceCategorizerDial } from '../schema';
import { isSharedId } from '../lib/shared';
import { createFaceModelStore, onFaceModelsChanged, type FaceModelRecord } from './models';
import { sharedSource, type SharedSource } from './sharedModels';

/** The transient field the node reads (declared by the manifest, `../index.ts`). */
export const FACE_CATEGORIZER_MODEL_FIELD = 'faceCategorizerModel';

export interface PlayedCategory {
  id: string;
  name: string;
  standsFor: ExpressionLabel;
}

export interface CategorizerPlayState {
  /** `general`: the dial names the general model. `loading`: reading the record. `ready`:
   *  the personal model is in the graph. `missing`: this device has no such categorizer, so
   *  the general model plays. */
  phase: 'general' | 'loading' | 'ready' | 'missing';
  /** The categorizer id the dial names (null for the general model). */
  id: string | null;
  /** Its name, once loaded. */
  name: string | null;
  /** Its categories, in order, with the expression each stands in for. */
  categories: readonly PlayedCategory[];
}

const IDLE: CategorizerPlayState = { phase: 'general', id: null, name: null, categories: [] };

export const useCategorizerPlay = create<CategorizerPlayState>(() => IDLE);

export interface CategorizerPlayDeps {
  /** Load a saved record by id (null when it does not exist). */
  load(id: string): Promise<FaceModelRecord | null>;
  /** The dial's current value. */
  dial(): Partial<FaceCategorizerDial> | undefined;
  /** Subscribe to changes of the settings the dial lives in. */
  subscribe(listener: () => void): () => void;
  /** Subscribe to changes of the saved categorizers. */
  onModelsChanged(listener: () => void): () => void;
  /** Hand the resolved model (or null) to the DAG. */
  publish(play: FaceCategorizerPlay | null): void;
}

/** The browser's dependencies: the hot store through the SDK host, the localStorage collection,
 *  and the shipped shared categorizers (#330 P5) for a `shared:` id. */
export function browserPlayDeps(shared: SharedSource = sharedSource()): CategorizerPlayDeps {
  const models = createFaceModelStore();
  return {
    load: (id) => (isSharedId(id) ? shared.load(id) : models.load(id)),
    dial: () => controls().get().faceCategorizer as Partial<FaceCategorizerDial> | undefined,
    subscribe: (l) => controls().subscribe(l),
    onModelsChanged: onFaceModelsChanged,
    publish: (play) => controls().setTransient(FACE_CATEGORIZER_MODEL_FIELD, play),
  };
}

/** Start resolving; returns the stop. Resolves once at start. */
export function startCategorizerPlay(deps: CategorizerPlayDeps = browserPlayDeps()): () => void {
  let wanted: string | null | undefined;
  let seq = 0;
  let stopped = false;

  const resolve = async (force: boolean): Promise<void> => {
    const dial = deps.dial();
    const id = isPersonal(dial) ? (dial!.id as string) : null;
    if (!force && id === wanted) return;
    wanted = id;
    const mine = ++seq;
    if (id === null) {
      deps.publish(null);
      useCategorizerPlay.setState(IDLE);
      return;
    }
    if (useCategorizerPlay.getState().id !== id) useCategorizerPlay.setState({ phase: 'loading', id, name: null, categories: [] });
    let record: FaceModelRecord | null = null;
    try {
      record = await deps.load(id);
    } catch {
      record = null;
    }
    if (stopped || mine !== seq) return;
    if (!record) {
      deps.publish(null);
      useCategorizerPlay.setState({ phase: 'missing', id, name: null, categories: [] });
      return;
    }
    const play = categorizerPlay({ id: record.id, name: record.name, categorizer: record.model.categorizer, tuning: record.model.tuning });
    deps.publish(play);
    useCategorizerPlay.setState({
      phase: 'ready',
      id,
      name: record.name,
      categories: play.live.model.categories.map((c, i) => ({ id: c.id, name: c.label, standsFor: play.standsFor[i] })),
    });
  };

  const unsubscribe = deps.subscribe(() => void resolve(false));
  const unwatch = deps.onModelsChanged(() => void resolve(true));
  void resolve(true);
  return () => {
    stopped = true;
    unsubscribe();
    unwatch();
  };
}
