/**
 * The instrument's pose categorizer, resolved off the tick (#384): the host side of the
 * `pose-categorizer` node, as `./categorizerPlay.ts` is for the face. It watches the
 * `poseCategorizer` dial, loads the saved pose categorizer it names from the one categorizer
 * collection (its body view), derives the live model under the record's own tuning
 * (`../lib/posePlay.ts`), and hands it to the DAG through the `poseCategorizerModel` transient.
 *
 * It re-resolves when the dial names another categorizer and when the saved categorizers change
 * (a correction saved in Your poses), and drops the answer to a request a later one has
 * overtaken. A record this device does not have publishes null: nothing plays, and the panel
 * says why.
 */
import { create } from 'zustand';
import { controls } from '@thoremin/sdk-ui/host';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { posePlay, type PoseCategorizerPlay, type TransportRole } from '../lib/posePlay';
import { playsPoses, type PoseCategorizerDial } from '../schema';
import { createCategorizerStore } from './categorizers';
import { onFaceModelsChanged, type FaceModelRecord } from './models';

/** The transient field the node reads (declared by the manifest, `../index.ts`). */
export const POSE_CATEGORIZER_MODEL_FIELD = 'poseCategorizerModel';

export interface PosePlayState {
  /** `none`: the dial names no categorizer. `loading`: reading the record. `ready`: it is in the
   *  graph. `missing`: this device has no such categorizer, so nothing plays. */
  phase: 'none' | 'loading' | 'ready' | 'missing';
  id: string | null;
  name: string | null;
  /** Its categories, in order. */
  categories: readonly { id: string; name: string }[];
  /** The category that states each conductor transport role (absent: the rule keeps it). */
  roles: Partial<Record<TransportRole, string>>;
}

const IDLE: PosePlayState = { phase: 'none', id: null, name: null, categories: [], roles: {} };

export const usePosePlay = create<PosePlayState>(() => IDLE);

export interface PosePlayDeps {
  load(id: string): Promise<FaceModelRecord | null>;
  dial(): Partial<PoseCategorizerDial> | undefined;
  subscribe(listener: () => void): () => void;
  onModelsChanged(listener: () => void): () => void;
  publish(play: PoseCategorizerPlay | null): void;
}

/** The browser's dependencies: the hot store through the SDK host and the body view of the one
 *  categorizer collection. */
export function browserPosePlayDeps(): PosePlayDeps {
  const models = createCategorizerStore(bodyModality);
  return {
    load: (id) => models.load(id),
    dial: () => controls().get().poseCategorizer as Partial<PoseCategorizerDial> | undefined,
    subscribe: (l) => controls().subscribe(l),
    onModelsChanged: onFaceModelsChanged,
    publish: (play) => controls().setTransient(POSE_CATEGORIZER_MODEL_FIELD, play),
  };
}

/** Start resolving; returns the stop. Resolves once at start. */
export function startPosePlay(deps: PosePlayDeps = browserPosePlayDeps()): () => void {
  let wanted: string | null | undefined;
  let seq = 0;
  let stopped = false;

  const resolve = async (force: boolean): Promise<void> => {
    const dial = deps.dial();
    const id = playsPoses(dial) ? (dial!.id as string) : null;
    if (!force && id === wanted) return;
    wanted = id;
    const mine = ++seq;
    if (id === null) {
      deps.publish(null);
      usePosePlay.setState(IDLE);
      return;
    }
    if (usePosePlay.getState().id !== id) usePosePlay.setState({ ...IDLE, phase: 'loading', id });
    let record: FaceModelRecord | null = null;
    try {
      record = await deps.load(id);
    } catch {
      record = null;
    }
    if (stopped || mine !== seq) return;
    if (!record || (record.model.categorizer.modality ?? 'face') !== bodyModality.id) {
      deps.publish(null);
      usePosePlay.setState({ ...IDLE, phase: 'missing', id });
      return;
    }
    const play = posePlay({ id: record.id, name: record.name, categorizer: record.model.categorizer, tuning: record.model.tuning });
    deps.publish(play);
    usePosePlay.setState({
      phase: 'ready',
      id,
      name: record.name,
      categories: play.live.model.categories.map((c) => ({ id: c.id, name: c.label })),
      roles: play.roles,
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
