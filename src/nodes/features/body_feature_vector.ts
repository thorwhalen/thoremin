/**
 * `body-feature-vector` node (#186) — turns a raw {@link BodyFrame} into a flat
 * `Record<string, number>` of the enabled body catalog features (angles,
 * positions, kinematics, shape, Laban effort, relations), emitted on a
 * `feature-vector` port for the Lab overlay, the trainer's live-vector tap and
 * the recorder — exactly what `hand-feature-vector` does for hands.
 *
 * Stateful only for the **history window** the kinematic and effort features
 * read: the last `windowSeconds` of samples (image point getters + image torso +
 * timing), kept per instance so a swap into a running graph starts clean. The
 * feature math itself is pure (`src/features/body_catalog.ts`). Only FINITE
 * values are emitted; a degenerate feature (no torso, missing landmark, no
 * history yet) returns NaN and is dropped. The window is cleared on an absent
 * frame, so a dancer stepping out and back does not get a spurious teleport speed.
 *
 * Two guards the synthetic tests cannot see but a live camera needs: the SAME
 * frame object arriving again (the engine ticking faster than inference — the
 * source returns its cache until the next video frame) is not a new sample, so it
 * re-emits the last vector and touches no history (otherwise every speed would
 * alternate between 0 and double); and the window is capped by COUNT as well as
 * by time, so a stalled engine clock (dt = 0) cannot grow it without bound.
 *
 * Group + activity resolution mirrors the face/hand twins (`resolveLabGate`):
 * inactive (Lab hidden, nothing demanded) emits an empty vector and keeps no
 * history; headless is always active from params.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { BodyFrame } from '../domain';
import { BODY_FEATURES, buildBodyCtx, type BodyHistorySample, type FeatureVector, type PulseStateLike } from '@/features/catalog';
import type { DemandedGroups } from '@/features/demand';
import { resolveLabGate, type LabControlsSnapshot } from '@/features/labConfig';

const Params = z.object({
  /** Mirror image-x so moving right increases x (selfie view), matching the hand features. */
  mirrorX: z.boolean().default(true),
  /** Which feature groups to compute (default: all body groups). Live lab config overrides. */
  groups: z.array(z.string()).optional(),
  /** Seconds of history the kinematic/effort features see (the Laban window). */
  windowSeconds: z.number().positive().max(5).default(1),
});
type Params = z.infer<typeof Params>;

type ControlsGetter = () => LabControlsSnapshot | undefined;
type DemandGetter = () => DemandedGroups;

function resolveGroups(p: Params, ctx: NodeContext): { active: boolean; enabled: (group: string) => boolean } {
  return resolveLabGate(
    p,
    (ctx.resources.controls as ControlsGetter | undefined)?.(),
    (ctx.resources.featureDemand as DemandGetter | undefined)?.() ?? null,
  );
}

export const bodyFeatureVectorNode = defineNode<Params>({
  type: 'body-feature-vector',
  roles: ['feature'],
  title: 'Body Feature Vector',
  description: 'Body pose landmarks -> a flat vector of enabled body catalog features (angles, kinematics, shape, effort, relations).',
  inputs: [
    { name: 'body', kind: 'body-frame' },
    // The dancer's pulse (#186 PR F), folded into the same vector as `body.rhythm.*`.
    { name: 'pulse', kind: 'pulse-state' },
  ],
  outputs: [{ name: 'vector', kind: 'feature-vector' }],
  params: Params,
  make(p) {
    // Oldest first. Each entry's `dtS` is the gap to the NEXT entry (the current
    // frame for the last one), which is what a velocity across that gap divides by.
    let history: BodyHistorySample[] = [];
    let lastTime: number | null = null;
    let lastFrame: BodyFrame | undefined;
    let lastVector: FeatureVector = {};
    // Count cap: a window of `windowSeconds` at any plausible frame rate (120 Hz), plus
    // the three samples acceleration and jerk need.
    const maxSamples = Math.ceil(p.windowSeconds * 120) + 3;

    return {
      process(inputs, ctx) {
        const { active, enabled } = resolveGroups(p, ctx);
        if (!active) {
          history = [];
          lastTime = null;
          lastFrame = undefined;
          lastVector = {};
          return { vector: {} };
        }
        const frame = inputs.body as BodyFrame | undefined;
        const vector: FeatureVector = {};
        if (!frame || !frame.present || frame.landmarks.length < 33) {
          history = [];
          lastTime = null;
          lastFrame = undefined;
          lastVector = {};
          return { vector };
        }
        // The same frame again (no new inference since last tick): not a new sample.
        if (frame === lastFrame) return { vector: lastVector };
        const dtS = lastTime === null ? NaN : ctx.time - lastTime;
        if (history.length) history[history.length - 1] = { ...history[history.length - 1], dtS };
        const pulse = inputs.pulse as PulseStateLike | undefined;
        const bctx = buildBodyCtx(frame, { mirrorX: p.mirrorX, dtS, history, pulse });
        for (const feat of BODY_FEATURES) {
          if (!enabled(feat.group)) continue;
          const v = feat.compute(bctx);
          if (Number.isFinite(v)) vector[feat.id] = v;
        }
        // Push this frame as the newest sample; its dtS is filled in next tick.
        const com = Number.isFinite(vector['body.shape.com.x']) && Number.isFinite(vector['body.shape.com.y'])
          ? { x: vector['body.shape.com.x'], y: vector['body.shape.com.y'] }
          : undefined;
        // Kinematics read the IMAGE set (see the catalog header): the world set is
        // hip-centred per frame and cannot see the body move through the frame.
        history.push({ pt: bctx.P, vis: bctx.vis, torso: bctx.torsoImg, dtS: NaN, com });
        lastTime = ctx.time;
        lastFrame = frame;
        lastVector = vector;
        if (history.length > maxSamples) history = history.slice(history.length - maxSamples);
        // Trim to the window by elapsed time (sum of the gaps), keeping at least three
        // samples so acceleration and jerk stay computable at any frame rate.
        let span = 0;
        let keep = history.length;
        for (let k = history.length - 2; k >= 0; k--) {
          span += history[k].dtS;
          if (span > p.windowSeconds && history.length - k > 3) {
            keep = history.length - k - 1;
            break;
          }
        }
        if (keep < history.length) history = history.slice(history.length - keep);
        return { vector };
      },
    };
  },
});
