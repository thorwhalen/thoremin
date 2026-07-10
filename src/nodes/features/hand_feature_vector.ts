/**
 * `hand-feature-vector` node — turns a raw {@link HandsFrame} (image + world
 * landmarks per hand) into a flat `Record<string, number>` of the enabled catalog
 * features, keyed `hand.{side}.{feature}` per detected hand plus `hand.pair.*`
 * two-hand relational features, emitted on a `feature-vector` port for the lab
 * overlay and the recorder.
 *
 * Pure and deterministic → fixture-replay tested against the recorded hand videos.
 * Uses world landmarks (metric, pose-invariant) when present, falling back to
 * image landmarks otherwise (the recorded fixtures + the synthetic source have no
 * world frames, so the angle/orientation features are in-plane approximations
 * there — still finite, still responsive). Only FINITE values are emitted (a
 * degenerate/absent feature returns `NaN` and is dropped, protecting the recorder
 * and the online normalizer from NaN poisoning).
 *
 * Group + activity resolution mirrors `face-feature-vector`: live lab config
 * first, then the static `groups` param, then all hand groups; inactive (lab
 * hidden) emits an empty vector; headless is always active from params.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { Hand, HandsFrame } from '../domain';
import {
  buildHandCtx,
  HAND_PAIR_FEATURES,
  HAND_SIDE_FEATURES,
  resolveSide,
  type FeatureVector,
  type HandCtx,
  type HandSide,
} from '@/features/catalog';

const Params = z.object({
  /** Mirror image-x so moving right increases x (selfie view), matching hand-features. */
  mirrorX: z.boolean().default(true),
  /** Swap reported Left/Right handedness (the mirrored webcam reports the opposite hand). */
  mirrorHandedness: z.boolean().default(true),
  /** Which feature groups to compute (default: all hand groups). Live lab config overrides. */
  groups: z.array(z.string()).optional(),
});
type Params = z.infer<typeof Params>;

interface LiveLabConfig {
  show?: boolean;
  groups?: string[];
}
type ControlsGetter = () => { overlay?: { featureLab?: LiveLabConfig } } | undefined;

function resolveGroups(p: Params, ctx: NodeContext): { active: boolean; enabled: (group: string) => boolean } {
  const live = (ctx.resources.controls as ControlsGetter | undefined)?.()?.overlay?.featureLab;
  const active = live ? live.show === true : true;
  const groups = live?.groups ?? p.groups;
  const set = groups ? new Set(groups) : null;
  return { active, enabled: (group: string) => (set ? set.has(group) : true) };
}

export const handFeatureVectorNode = defineNode<Params>({
  type: 'hand-feature-vector',
  roles: ['feature'],
  title: 'Hand Feature Vector',
  description: 'Hand image + world landmarks -> a flat vector of enabled per-hand + two-hand catalog features.',
  inputs: [{ name: 'hands', kind: 'hands-frame' }],
  outputs: [{ name: 'vector', kind: 'feature-vector' }],
  params: Params,
  process(inputs, p, ctx) {
    const { active, enabled } = resolveGroups(p, ctx);
    if (!active) return { vector: {} };
    const frame = inputs.hands as HandsFrame | undefined;
    const vector: FeatureVector = {};
    if (!frame || !frame.hands?.length) return { vector };

    // Per-hand features, keyed by resolved side.
    const bySide: Partial<Record<HandSide, HandCtx>> = {};
    for (const hand of frame.hands as Hand[]) {
      const side = resolveSide(hand.handedness, p.mirrorHandedness);
      const hctx = buildHandCtx(hand, frame, { mirrorX: p.mirrorX, side });
      bySide[side] = hctx;
      for (const feat of HAND_SIDE_FEATURES) {
        if (!enabled(feat.group)) continue;
        const v = feat.compute(hctx);
        if (Number.isFinite(v)) vector[`hand.${side}.${feat.id}`] = v;
      }
    }

    // Two-hand relational features (need both hands present).
    if (bySide.left && bySide.right) {
      const tctx = { left: bySide.left, right: bySide.right, mirrorX: p.mirrorX };
      for (const feat of HAND_PAIR_FEATURES) {
        if (!enabled(feat.group)) continue;
        const v = feat.compute(tctx);
        if (Number.isFinite(v)) vector[`hand.${feat.id}`] = v;
      }
    }

    return { vector };
  },
});
