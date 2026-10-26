/**
 * `hands-dwell` node (#314): the hand stream with its Left/Right labels held by the handedness
 * dwell (#148), for the instruments that pick a hand by label themselves.
 *
 * The dial `hands.handednessDwell` reaches `hand-features` (the field instruments, gesture
 * dispatch, the indirect map, the overlay), but the hand-by-label instruments key on the raw labels from
 * the camera, so a flicker the dial would hold still reached them. They read this node's
 * `hands` instead: the same frame, each hand relabelled with its COMMITTED side, in the camera's
 * own convention (the mirror swap undone), so their `labelFor` finds the hand it always found.
 * One dwell serves every consumer, at the one place a label is decided.
 *
 * At dwell 0 (the dial's default) nothing is held and the input frame itself is returned: the
 * node is the identity, and an instrument that never raises the dial plays as it always did.
 *
 * One correction is made at any dwell: two hands the model gave the SAME label (a frame in eight
 * on real two-hand takes) are told apart by where they are (`createLabelOrder`), since an
 * instrument that looks for the other label would otherwise lose that hand for the frame (the
 * chord map dropped its chord hand and sounded its melody from the wrong one). That is not a
 * dwell: nothing is held, and a frame whose labels differ passes through untouched.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { resolveSide, type HandSide } from '@thoremin/sdk/features/catalog';
import { DEFAULT_HANDEDNESS_DWELL_FRAMES, MAX_HANDEDNESS_DWELL_FRAMES, createHandednessDwell, createLabelOrder } from '@thoremin/sdk/features/handedness';
import type { Hand, HandsFrame } from '@thoremin/sdk/nodes/domain';
import { SOURCE_SLOT_OUTPUT } from '../sources/source_contract';

const Params = z.object({
  /** The camera reports the opposite hand when mirrored (the same knob `hand-features` carries). */
  mirrorHandedness: z.boolean().default(true),
  /** Build-time dwell; the `handednessDwell` input overrides it live. */
  handednessDwellFrames: z.number().int().min(0).max(MAX_HANDEDNESS_DWELL_FRAMES).default(DEFAULT_HANDEDNESS_DWELL_FRAMES),
});
type Params = z.infer<typeof Params>;

/** The camera's label for a player's side: `resolveSide` run backwards. */
function rawLabel(side: HandSide, mirrorHandedness: boolean): Hand['handedness'] {
  const player = side === 'right' ? 'Right' : 'Left';
  return mirrorHandedness ? (player === 'Right' ? 'Left' : 'Right') : player;
}

export const handsDwellNode = defineNode<Params>({
  type: 'hands-dwell',
  roles: ['feature'],
  title: 'Hands (dwelled labels)',
  description: 'The hand stream with Left/Right held by the handedness dwell, for instruments that choose a hand by label.',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'handednessDwell', kind: 'number', description: 'Live override of handednessDwellFrames (frames; 0 = raw label)' },
  ],
  outputs: [{ name: 'hands', kind: SOURCE_SLOT_OUTPUT.kind }],
  params: Params,
  make(p) {
    const dwell = createHandednessDwell({ dwellFrames: p.handednessDwellFrames });
    const order = createLabelOrder();
    return {
      process(inputs) {
        const frame = inputs.hands as HandsFrame | undefined;
        const live = inputs.handednessDwell as number | undefined;
        const dwellFrames = typeof live === 'number' && Number.isFinite(live) ? live : p.handednessDwellFrames;
        const hands = frame?.hands ?? [];
        // Two hands with one label: told apart by position first (the wrist's x), then dwelled.
        const labels = order.step(hands.map((h) => ({ label: h.handedness, x: h.keypoints[0]?.x ?? 0 })));
        // An empty frame still steps the tracker: a dropout counts toward its window.
        const sides = dwell.step(labels.map((l) => resolveSide(l, p.mirrorHandedness)), { dwellFrames });
        if (!frame) return { hands: undefined };
        let changed = false;
        const relabelled = hands.map((h, i) => {
          const label = rawLabel(sides[i], p.mirrorHandedness);
          if (label === h.handedness) return h;
          changed = true;
          return { ...h, handedness: label };
        });
        return { hands: changed ? { ...frame, hands: relabelled } : frame };
      },
    };
  },
});
