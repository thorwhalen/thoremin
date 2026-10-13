/**
 * `hand-feature-vector` node — turns a raw {@link HandsFrame} (image + world
 * landmarks per hand) into a flat `Record<string, number>` of the enabled catalog
 * features, keyed `hand.{side}.{feature}` per detected hand plus `hand.pair.*`
 * two-hand relational features, emitted on a `feature-vector` port for the lab
 * overlay and the recorder.
 *
 * Deterministic and fixture-replay tested against the recorded hand videos.
 * Stateful only for the handedness->namespace hysteresis (below); the feature
 * math itself is pure. Uses world landmarks (metric, pose-invariant) when
 * present, falling back to image landmarks otherwise (the recorded fixtures +
 * the synthetic source have no world frames, so the angle/orientation features
 * are in-plane approximations there — still finite, still responsive). Only
 * FINITE values are emitted (a degenerate/absent feature returns `NaN` and is
 * dropped, protecting the recorder and the online normalizer from NaN
 * poisoning).
 *
 * Handedness hysteresis (#144): MediaPipe relabels a single physical hand
 * Left->Right->Left when it turns (the back of a hand looks like the other
 * hand). Keying by the raw label split one hand's stream across the
 * `hand.left.*` / `hand.right.*` namespaces for a frame or two, blanking the
 * Lab meters. So while exactly ONE hand is detected the namespace is a
 * COMMITTED side: a new label must persist `handednessDwellFrames` consecutive
 * DETECTED single-hand frames before the assignment switches. The tracker is
 * the shared `createHandednessDwell` (`@thoremin/sdk/features/handedness`,
 * whose header states the full policy: dropouts, phantom second hands, the
 * sustained two-hand reset). Since #148 the sound path (`hand-features`) runs
 * the same tracker, with its dwell on the `hands.handednessDwell` dial — default
 * 0, the raw label, because the re-route latency is audible there; this Lab
 * default stays at {@link LAB_HANDEDNESS_DWELL_FRAMES} so the meters stay steady.
 *
 * Group + activity resolution mirrors `face-feature-vector`: live lab config
 * first, then the static `groups` param, then all hand groups; inactive (lab
 * hidden) emits an empty vector; headless is always active from params.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import type { Hand, HandsFrame } from '@thoremin/sdk/nodes/domain';
import {
  buildHandCtx,
  HAND_PAIR_FEATURES,
  HAND_SIDE_FEATURES,
  resolveSide,
  type FeatureVector,
  type HandCtx,
  type HandSide,
} from '@thoremin/sdk/features/catalog';
import type { DemandedGroups } from '@thoremin/sdk/features/demand';
import { createHandednessDwell, MAX_HANDEDNESS_DWELL_FRAMES } from '@thoremin/sdk/features/handedness';
import { resolveLabGate, type LabControlsSnapshot } from '@/features/labConfig';

/** The Lab's dwell: three frames absorbs the measured 1-2 frame flicker (#144). */
export const LAB_HANDEDNESS_DWELL_FRAMES = 3;

const Params = z.object({
  /** Mirror image-x so moving right increases x (selfie view), matching hand-features. */
  mirrorX: z.boolean().default(true),
  /** Swap reported Left/Right handedness (the mirrored webcam reports the opposite hand). */
  mirrorHandedness: z.boolean().default(true),
  /** Which feature groups to compute (default: all hand groups). Live lab config overrides. */
  groups: z.array(z.string()).optional(),
  /** Single-hand only: consecutive DETECTED single-hand frames a NEW handedness
   *  label must persist before the `hand.{side}.*` namespace switches (brief
   *  dropouts within the dwell window between them don't reset the count).
   *  Absorbs MediaPipe's Left/Right relabel flicker when a hand turns; also the
   *  window of consecutive multi-hand frames required before the single-hand
   *  tracker is cleared (a one-frame phantom second hand must not strip the
   *  dwell protection). 1 = no hysteresis. */
  handednessDwellFrames: z.number().int().min(1).max(MAX_HANDEDNESS_DWELL_FRAMES).default(LAB_HANDEDNESS_DWELL_FRAMES),
});
type Params = z.infer<typeof Params>;

type ControlsGetter = () => LabControlsSnapshot | undefined;
/** The live feature demand (#163): groups some non-Lab consumer needs computed. */
type DemandGetter = () => DemandedGroups;

/** Resolve the active flag + enabled-group predicate. The rule itself lives in
 *  `@/features/labConfig` — it is shared with the hand/face twin, and keeping two copies
 *  of it is how #136 silently un-gated the whole catalog. */
function resolveGroups(p: Params, ctx: NodeContext): { active: boolean; enabled: (group: string) => boolean } {
  return resolveLabGate(
    p,
    (ctx.resources.controls as ControlsGetter | undefined)?.(),
    (ctx.resources.featureDemand as DemandGetter | undefined)?.() ?? null,
  );
}

export const handFeatureVectorNode = defineNode<Params>({
  type: 'hand-feature-vector',
  roles: ['feature'],
  title: 'Hand Feature Vector',
  description: 'Hand image + world landmarks -> a flat vector of enabled per-hand + two-hand catalog features.',
  inputs: [{ name: 'hands', kind: 'hands-frame' }],
  outputs: [{ name: 'vector', kind: 'feature-vector' }],
  params: Params,
  make(p) {
    // Handedness->namespace hysteresis (single-hand regime only): the shared tracker.
    // The policy across hand-count changes (1 -> 2+, sustained 2 -> 1, 1 -> 0 -> 1) is
    // stated once, in the tracker's module header, and pinned by this node's tests.
    const dwell = createHandednessDwell({ dwellFrames: p.handednessDwellFrames });

    return {
      process(inputs, ctx) {
        const { active, enabled } = resolveGroups(p, ctx);
        if (!active) {
          // Unobserved stream: drop the tracker so a much-later reshow
          // cold-commits to the then-current label instead of a stale one.
          dwell.reset();
          return { vector: {} };
        }
        const frame = inputs.hands as HandsFrame | undefined;
        const vector: FeatureVector = {};
        const hands = (frame?.hands ?? []) as Hand[];
        // One committed side per hand (dwell-committed when a single hand is present,
        // raw otherwise); an empty frame still steps the tracker (it counts the dropout).
        const sides = dwell.step(hands.map((hand) => resolveSide(hand.handedness, p.mirrorHandedness)));
        if (!hands.length) return { vector };

        // Per-hand features, keyed by the assigned side.
        const bySide: Partial<Record<HandSide, HandCtx>> = {};
        for (const [i, hand] of hands.entries()) {
          // The committed side also labels the HandCtx (not just the keys):
          // during a flicker the physical hand is unchanged, so side-tagged
          // consumers must see the same side the features are keyed under.
          const side = sides[i];
          const hctx = buildHandCtx(hand, frame!, { mirrorX: p.mirrorX, side });
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
    };
  },
});
