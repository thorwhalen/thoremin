/**
 * `no-hands` node: the hand source of an instrument that reads no camera (#869).
 *
 * Every graph carries the trunk's hand source in the `source` slot, because the shell's hand
 * readers (gestures, the Lab, a claim, the skeleton) and most instruments need it. An
 * instrument that only listens (a listening game) reads none of it, and filling the slot with
 * `webcam-hands` there would load the hand model (seconds of wasm and weights) and need a
 * camera the instrument never looks at. So the host fills the slot with this node while the
 * camera is closed (`sourceSelectionFor` in `src/app/graph.ts`), and swaps `webcam-hands` in
 * through `Engine.applyGraph` once a reader appears and the camera opens: the rest of the graph
 * plays on through the swap.
 *
 * It emits the empty frame the contract allows ("no hands in view", which every reader already
 * handles) and an `off` status, which the overlay's status line keeps quiet about: a closed
 * camera is not a failure. Pure and deterministic: no clock, no DOM.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { EMPTY_HANDS_FRAME, SOURCE_SLOT_OUTPUT, SOURCE_SLOT_STATUS, type HandsStatus } from './source_contract';
import { NO_HANDS_TYPE } from './no_hands.schema';
export { NO_HANDS_TYPE };

/** What the overlay hears: off, with the reason for anyone who reads it. */
const CAMERA_CLOSED: HandsStatus = Object.freeze({ phase: 'off', message: 'Camera closed: nothing reads it' });

export const noHandsNode = defineNode({
  type: NO_HANDS_TYPE,
  roles: ['source'],
  title: 'No Hands',
  description: 'The hand source while the camera is closed: an instrument that reads no camera stream emits no hands, and loads no hand model.',
  inputs: [],
  outputs: [SOURCE_SLOT_OUTPUT, SOURCE_SLOT_STATUS],
  params: z.object({}),
  process: () => ({ hands: EMPTY_HANDS_FRAME, status: CAMERA_CLOSED }),
});
