/**
 * The `pose-categorizer` node (#384, body-movement B4): a saved pose categorizer, read live in the
 * instrument. The body source's feature vector, read the way the tool's live test reads it (the
 * categorizer's own side under the mirror, "cannot see you" below its trained features' coverage,
 * the classifier and its hysteresis), to two outputs:
 *
 * - `category`: the reading as `CategoryScores`, which the overlay's category cues draw (its
 *   `learnedCategories` input) and a take records;
 * - `transportPose`: the conductor's start / hold / cut-off predicates from the categories named
 *   `ready`, `fermata` and `cut-off` (`../lib/posePlay.ts`), only while the dial's `transport` is
 *   on; otherwise nothing, and the conductor's rules decide.
 *
 * The model is a transient the host resolves off the tick (`../app/posePlay.ts`); only the model
 * the dial names plays. The engine ticks faster than the camera, so a vector seen already is not a
 * new reading (the hysteresis counts camera frames).
 */
import { z } from 'zod';
import { defineNode, type NodeContext } from '@thoremin/dag';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import { createLiveReader, type LiveReader } from '../lib/live';
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

    const bind = (play: PoseCategorizerPlay | null): void => {
      if (play === current) return;
      current = play;
      reader = play ? createLiveReader(play.live) : null;
      lastVector = undefined;
      lastId = null;
      lastCategory = play ? absentPoseScores(play) : NOTHING;
    };

    /** One camera frame: absent without a body, or with too little of the trained pose in view. */
    const read = (vector: FeatureVector | undefined): void => {
      if (!current || !reader) return;
      const projected = vector ? current.live.project(vector) : null;
      if (!projected || !current.live.inView(projected)) {
        reader.reset();
        lastId = null;
        lastCategory = absentPoseScores(current);
        return;
      }
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
        const transportPose: PoseTransport | undefined = config?.transport === true ? poseTransport(current, lastId) : undefined;
        return { category: lastCategory, transportPose };
      },
    };
  },
});
