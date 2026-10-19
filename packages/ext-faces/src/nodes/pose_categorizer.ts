/**
 * The `pose-categorizer` node (#384, body-movement B4): a saved pose categorizer, read live in the
 * instrument. The body source's feature vector, read the way the tool's live test reads it (the
 * categorizer's own side under the mirror, "cannot see you" below its trained features' coverage,
 * the classifier and its hysteresis), to two outputs:
 *
 * - `category`: the reading as `CategoryScores`, which the overlay's category cues draw (a
 *   categorizer reader its branch declares, #600 S10b) and a take records;
 * - `transportPose`: while the dial's `transport` is on and one of the categories named `ready`,
 *   `fermata` or `cut-off` is the settled one, that role stated true (`../lib/posePlay.ts`);
 *   otherwise nothing, and the conductor's rules decide (out of view too: A5's stop when the
 *   player leaves needs the cut-off unstated).
 *
 * The model is a transient the host resolves off the tick (`../app/posePlay.ts`); only the model
 * the dial names plays. The engine ticks faster than the camera, so a vector seen already is not a
 * new reading (the hysteresis counts camera frames). The vector's identity is the camera frame's
 * here, with no `frame` input (#492): `body-feature-vector` keeps its vector for a body frame it
 * has seen, the webcam source hands out one frame object per video frame, and out of view the
 * reader is reset every tick, which counts nothing. `test/faces/pose_play.test.ts` replays the
 * graph at two ticks per frame to hold that.
 */
import { z } from 'zod';
import { defineNode, type NodeContext } from '@thoremin/dag';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import { createLiveReader, type LiveReader } from '@thoremin/sdk/enroll/live';
import { absentPoseScores, poseTransport, toPoseScores, type PoseCategorizerPlay, type PoseTransport } from '../lib/posePlay';
import type { PoseCategorizerDial } from '../schema';

const Params = z.object({});
type Params = z.infer<typeof Params>;

const NOTHING: CategoryScores = { present: false, label: null, labels: [], scores: [] };

export const poseCategorizerNode = defineNode<Params>({
  type: 'pose-categorizer',
  roles: ['feature'],
  title: 'Pose Categorizer',
  description:
    'Your own pose categorizer (#384), read live: the body to one of your saved poses, drawn on the video, and optionally the body conductor\'s start, hold and cut-off from your ready, fermata and cut-off poses.',
  inputs: [
    // The body source's feature vector (`body.*`).
    { name: 'vector', kind: 'feature-vector' },
    // The resolved categorizer (a transient the host sets off the tick), or null.
    { name: 'model', kind: 'pose-categorizer-model' },
    // The instrument's dial: which categorizer, and whether it conducts the transport.
    { name: 'config', kind: 'pose-categorizer-config' },
  ],
  outputs: [
    { name: 'category', kind: 'category-scores' },
    { name: 'transportPose', kind: 'transport-pose' },
  ],
  params: Params,
  make() {
    let current: PoseCategorizerPlay | null = null;
    let reader: LiveReader | null = null;
    let lastVector: FeatureVector | undefined;
    let lastCategory: CategoryScores = NOTHING;
    let lastId: string | null = null;
    /** The body is in view (a stale id never states a role while it is not). */
    let seen = false;

    const bind = (play: PoseCategorizerPlay | null): void => {
      if (play === current) return;
      current = play;
      reader = play ? createLiveReader(play.live) : null;
      lastVector = undefined;
      lastId = null;
      seen = false;
      lastCategory = play ? absentPoseScores(play) : NOTHING;
    };

    /** One camera frame: absent without a body, or with too little of the trained pose in view. */
    const read = (vector: FeatureVector | undefined): void => {
      if (!current || !reader) return;
      const projected = vector ? current.live.project(vector) : null;
      if (!projected || !current.live.inView(projected)) {
        reader.reset();
        lastId = null;
        seen = false;
        lastCategory = absentPoseScores(current);
        return;
      }
      seen = true;
      const reading = reader.push(projected);
      lastId = reading.categoryId;
      lastCategory = toPoseScores(current, reading);
    };

    return {
      process(inputs, _ctx: NodeContext) {
        const config = inputs.config as Partial<PoseCategorizerDial> | undefined;
        const model = (inputs.model as PoseCategorizerPlay | null | undefined) ?? null;
        bind(model && config?.id === model.id ? model : null);
        if (!current) return { category: NOTHING, transportPose: undefined };
        const vector = inputs.vector as FeatureVector | undefined;
        if (vector !== lastVector) {
          lastVector = vector;
          read(vector);
        }
        const transportPose: PoseTransport | undefined = config?.transport === true && seen ? poseTransport(current, lastId) : undefined;
        return { category: lastCategory, transportPose };
      },
    };
  },
});
