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
 * DETECTED single-hand frames before the assignment switches (the same
 * leave-counter dwell idiom as `face-expression`; brief dropouts within the
 * dwell window between those frames do not reset the count — detection
 * confidence dips at exactly the moments labels flicker). Two-hand frames pass
 * raw labels through untouched, and — because a "second hand" can itself be a
 * one-frame phantom detection of the same physical hand mid-turn — the
 * single-hand tracker is only cleared after a full dwell window of consecutive
 * multi-hand frames, not by the first one.
 *
 * DELIBERATE DIVERGENCE: the sound path (`hand-features`) still keys strictly
 * by the raw per-frame label, so during a flicker the audible instrument can
 * glitch while these Lab meters stay steady. Adopting the dwell there changes
 * what the INSTRUMENT plays and needs its own decision + live test — tracked
 * separately (see the follow-up issue referenced from #144).
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
import { resolveLabGate, type LabControlsSnapshot } from '@/features/labConfig';

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
  handednessDwellFrames: z.number().int().min(1).max(30).default(3),
});
type Params = z.infer<typeof Params>;

type ControlsGetter = () => LabControlsSnapshot | undefined;

/** Resolve the active flag + enabled-group predicate. The rule itself lives in
 *  `@/features/labConfig` — it is shared with the hand/face twin, and keeping two copies
 *  of it is how #136 silently un-gated the whole catalog. */
function resolveGroups(p: Params, ctx: NodeContext): { active: boolean; enabled: (group: string) => boolean } {
  return resolveLabGate(p, (ctx.resources.controls as ControlsGetter | undefined)?.());
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
    // Handedness->namespace hysteresis state (single-hand regime only). Policy
    // across hand-count changes, each direction thought through:
    //  - 1 -> 2+: raw labels pass through untouched. The tracker is cleared only
    //    after a FULL dwell window of consecutive multi-hand frames: a sustained
    //    two-hand regime means MediaPipe disambiguated two real hands against
    //    each other (nothing for hysteresis to protect, and carrying single-hand
    //    state across the interlude could pin the surviving hand to the wrong
    //    side afterwards — we cannot know which physical hand remained), but a
    //    ONE-frame "second hand" is often a phantom duplicate detection of the
    //    same physical hand mid-turn — exactly the regime that flickers labels —
    //    and letting it wipe the tracker would reopen the bug through a rarer
    //    door (the next single-hand frame would cold-commit a flickered label).
    //    (A phantom frame still fires pair features against the hand and itself
    //    for that frame — indistinguishable from a real second hand in a single
    //    frame; accepted.)
    //  - sustained 2 -> 1: tracker was cleared during the interlude, so the
    //    remaining hand cold-commits to its own raw label immediately (its label
    //    was just disambiguated), and the dwell protects it from that point on.
    //  - 1 -> 0 -> 1: a dropout no longer than the dwell window KEEPS the
    //    assignment (and the disagreement count — the switch dwell counts
    //    DETECTED frames) — detection confidence dips at the same moment labels
    //    flicker (while the hand turns), so resetting on a one-frame dropout
    //    would reopen the bug. A longer absence clears the tracker, so a
    //    genuinely new hand commits to its own label at once.
    let committedSide: HandSide | null = null;
    let switchCount = 0; // consecutive DETECTED single-hand frames disagreeing with committedSide
    let absentCount = 0; // consecutive frames with no detected hands
    let multiCount = 0; // consecutive frames with 2+ detected hands

    const reset = () => {
      committedSide = null;
      switchCount = 0;
    };

    /** Dwell-filter the single-hand raw side into the committed namespace. */
    const commitSide = (raw: HandSide): HandSide => {
      if (committedSide === null || raw === committedSide) {
        committedSide = raw;
        switchCount = 0;
      } else if (++switchCount >= p.handednessDwellFrames) {
        committedSide = raw;
        switchCount = 0;
      }
      return committedSide;
    };

    return {
      process(inputs, ctx) {
        const { active, enabled } = resolveGroups(p, ctx);
        if (!active) {
          // Unobserved stream: drop the tracker so a much-later reshow
          // cold-commits to the then-current label instead of a stale one.
          reset();
          absentCount = 0;
          multiCount = 0;
          return { vector: {} };
        }
        const frame = inputs.hands as HandsFrame | undefined;
        const vector: FeatureVector = {};
        if (!frame || !frame.hands?.length) {
          if (++absentCount > p.handednessDwellFrames) reset();
          multiCount = 0;
          return { vector };
        }
        absentCount = 0;

        const hands = frame.hands as Hand[];
        const single = hands.length === 1;
        if (single) {
          multiCount = 0;
        } else if (++multiCount >= p.handednessDwellFrames) {
          reset(); // a sustained (not phantom) multi-hand regime — see the policy above
        }

        // Per-hand features, keyed by the assigned side (dwell-committed when a
        // single hand is present, raw otherwise).
        const bySide: Partial<Record<HandSide, HandCtx>> = {};
        for (const hand of hands) {
          const raw = resolveSide(hand.handedness, p.mirrorHandedness);
          // The committed side also labels the HandCtx (not just the keys):
          // during a flicker the physical hand is unchanged, so side-tagged
          // consumers must see the same side the features are keyed under.
          const side = single ? commitSide(raw) : raw;
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
    };
  },
});
