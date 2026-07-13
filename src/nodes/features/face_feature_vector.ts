/**
 * `face-feature-vector` node — turns a raw {@link FaceFrame} (blendshapes + the
 * 478-point mesh + head pose) into a flat `Record<string, number>` of the enabled
 * catalog features, emitted on a `feature-vector` output port for the lab overlay
 * and the recorder.
 *
 * Pure and deterministic (given the frame + the enabled group set) → fixture-
 * replay tested against the recorded face video. Only FINITE feature values are
 * emitted: a feature returns `NaN` when its inputs are absent (missing landmark,
 * degenerate scale, no face) and is dropped here, so the recorder never stores a
 * NaN and the online normalizer never sees one (one NaN permanently poisons a
 * running mean — see the #119 appendix).
 *
 * Which groups compute is, in priority order: the live lab config (read off the control
 * store — the top-level `featureLab`, since #136)
 * (`ctx.resources.controls().overlay.featureLab`), then the static `groups`
 * param, then ALL face groups. The lab is "active" when its overlay element is
 * shown; when hidden (and a live config is present) the node emits an empty
 * vector, so features accumulate + record only while the lab is open. Headless
 * (no controls resource) it is always active and computes from params — keeping
 * it deterministic for tests.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { FaceFrame } from '../domain';
import { buildFaceCtx, FACE_FEATURES, type FeatureVector } from '@/features/catalog';
import { resolveLabGate, type LabControlsSnapshot } from '@/features/labConfig';

const Params = z.object({
  /** Which feature groups to compute (default: all face groups). A live lab
   *  config overrides this per-tick without a graph rebuild. */
  groups: z.array(z.string()).optional(),
});
type Params = z.infer<typeof Params>;

type ControlsGetter = () => LabControlsSnapshot | undefined;

/** Resolve the active flag + enabled-group predicate. The rule itself lives in
 *  `@/features/labConfig` — it is shared with the hand/face twin, and keeping two copies
 *  of it is how #136 silently un-gated the whole catalog. */
function resolveGroups(p: Params, ctx: NodeContext): { active: boolean; enabled: (group: string) => boolean } {
  return resolveLabGate(p, (ctx.resources.controls as ControlsGetter | undefined)?.());
}

export const faceFeatureVectorNode = defineNode<Params>({
  type: 'face-feature-vector',
  roles: ['feature'],
  title: 'Face Feature Vector',
  description: 'Face blendshapes + mesh + head pose -> a flat vector of enabled catalog features.',
  inputs: [{ name: 'face', kind: 'face-frame' }],
  outputs: [{ name: 'vector', kind: 'feature-vector' }],
  params: Params,
  process(inputs, p, ctx) {
    const { active, enabled } = resolveGroups(p, ctx);
    if (!active) return { vector: {} };
    const frame = inputs.face as FaceFrame | undefined;
    const vector: FeatureVector = {};
    if (!frame || !frame.present) return { vector };
    const fctx = buildFaceCtx(frame);
    for (const feat of FACE_FEATURES) {
      if (!enabled(feat.group)) continue;
      const v = feat.compute(fctx);
      if (Number.isFinite(v)) vector[feat.id] = v;
    }
    return { vector };
  },
});
