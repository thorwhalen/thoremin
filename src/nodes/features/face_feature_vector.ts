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
 * Which groups compute is, in priority order: the live lab config
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

const Params = z.object({
  /** Which feature groups to compute (default: all face groups). A live lab
   *  config overrides this per-tick without a graph rebuild. */
  groups: z.array(z.string()).optional(),
});
type Params = z.infer<typeof Params>;

/** The live lab config slice the vector nodes read off the control snapshot. */
interface LiveLabConfig {
  show?: boolean;
  groups?: string[];
}
type ControlsGetter = () => { overlay?: { featureLab?: LiveLabConfig } } | undefined;

/** Resolve the active flag + enabled-group predicate from live config or params. */
function resolveGroups(p: Params, ctx: NodeContext): { active: boolean; enabled: (group: string) => boolean } {
  const live = (ctx.resources.controls as ControlsGetter | undefined)?.()?.overlay?.featureLab;
  // Headless (no live config): always active, groups from params.
  const active = live ? live.show === true : true;
  const groups = live?.groups ?? p.groups;
  const set = groups ? new Set(groups) : null;
  return { active, enabled: (group: string) => (set ? set.has(group) : true) };
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
