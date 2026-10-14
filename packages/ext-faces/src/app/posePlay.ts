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
 *
 * While the dial names a categorizer it CLAIMS the pose feature groups (#163's feature demand,
 * owner {@link POSE_PLAY_DEMAND_OWNER}): `body-feature-vector` computes only what something
 * claims, and in the app the Lab is closed, so without the claim the node would read an empty
 * vector and see nobody, every unit test green.
 */
import { create } from 'zustand';
import { controls } from '@thoremin/sdk-ui/host';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { posePlay, transportRolesOf, type PoseCategorizerPlay, type TransportRole } from '../lib/posePlay';
import { playsPoses, type PoseCategorizerDial } from '../schema';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { onFaceModelsChanged, type FaceModelRecord } from './models';

/** The transient field the node reads (declared by the manifest, `../index.ts`). */
export const POSE_CATEGORIZER_MODEL_FIELD = 'poseCategorizerModel';

/** The feature-demand owner of the playing instrument's pose groups. */
export const POSE_PLAY_DEMAND_OWNER = 'poses-play';

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
  /** Claim (`on`) or release the pose feature groups the node reads. */
  claim(on: boolean): void;
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
    claim: (on) => (on ? appFeatureDemand.claim(POSE_PLAY_DEMAND_OWNER, bodyModality.groups) : appFeatureDemand.release(POSE_PLAY_DEMAND_OWNER)),
  };
}

/** Start resolving; returns the stop. Resolves once at start. */
export function startPosePlay(deps: PosePlayDeps = browserPosePlayDeps()): () => void {
  let wanted: string | null | undefined;
  let seq = 0;
  let stopped = false;
  /** What was last published, by record (a save of something else must not reset the reading). */
  let publishedKey: string | null = null;
  const publish = (play: PoseCategorizerPlay | null, key: string | null) => {
    if (key !== null && key === publishedKey) return;
    publishedKey = key;
    deps.publish(play);
  };

  const resolve = async (force: boolean): Promise<void> => {
    const dial = deps.dial();
    const id = playsPoses(dial) ? (dial!.id as string) : null;
    if (!force && id === wanted) return;
    wanted = id;
    const mine = ++seq;
    deps.claim(id !== null);
    if (id === null) {
      publish(null, null);
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
      publish(null, null);
      usePosePlay.setState({ ...IDLE, phase: 'missing', id });
      return;
    }
    // What the play is made of: the bindings and the checks ride the record too (#371) but change
    // nothing about the reading, so an edit of them must not reset it.
    const key = JSON.stringify([record.id, record.name, record.model.categorizer, record.model.tuning]);
    // The same record as the graph already has (a save of something else): keep its model, so
    // the reading is not reset; the state still says it plays.
    const play = key === publishedKey ? null : posePlay({ id: record.id, name: record.name, categorizer: record.model.categorizer, tuning: record.model.tuning });
    if (play) publish(play, key);
    const { categories } = record.model.categorizer;
    const roles = transportRolesOf(record.model.categorizer);
    usePosePlay.setState({
      phase: 'ready',
      id,
      name: record.name,
      categories: categories.map((c) => ({ id: c.id, name: c.label })),
      roles,
    });
  };

  const unsubscribe = deps.subscribe(() => void resolve(false));
  const unwatch = deps.onModelsChanged(() => void resolve(true));
  void resolve(true);
  return () => {
    stopped = true;
    unsubscribe();
    unwatch();
    deps.claim(false);
  };
}
