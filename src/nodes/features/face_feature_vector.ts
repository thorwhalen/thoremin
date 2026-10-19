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
 * Which groups compute is the feature gate's (`resolveFeatureGate`, `@/features/groups`): with a
 * live host, only the groups a feature demand claims (the Trainer's cue, a bound categorizer, the
 * open Lab's shown groups, #600 S16a), so with nothing claimed the node emits an empty vector and
 * features accumulate and record only while something wants them. Headless (no controls resource)
 * it is always active and computes from the static `groups` param, else ALL face groups, keeping it
 * deterministic for tests.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import type { FaceFrame } from '@thoremin/sdk/nodes/domain';
import { buildFaceCtx, FACE_FEATURES, type FeatureVector } from '@thoremin/sdk/features/catalog';
import type { DemandedGroups } from '@thoremin/sdk/features/demand';
import { resolveFeatureGate } from '@/features/groups';

const Params = z.object({
  /** Which feature groups to compute (default: all face groups). A live lab
   *  config overrides this per-tick without a graph rebuild. */
  groups: z.array(z.string()).optional(),
});
type Params = z.infer<typeof Params>;

type ControlsGetter = () => unknown;
/** The live feature demand (#163): groups some non-Lab consumer needs computed. */
type DemandGetter = () => DemandedGroups;

/** Resolve the active flag + enabled-group predicate. The rule itself lives in
 *  `@/features/groups` — it is shared with the hand/face twin, and keeping two copies
 *  of it is how #136 silently un-gated the whole catalog. */
function resolveGroups(p: Params, ctx: NodeContext): { active: boolean; enabled: (group: string) => boolean } {
  return resolveFeatureGate(
    p,
    (ctx.resources.controls as ControlsGetter | undefined)?.(),
    (ctx.resources.featureDemand as DemandGetter | undefined)?.() ?? null,
  );
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
