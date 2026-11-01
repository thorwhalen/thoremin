/**
 * The **body** slot contract (#186): what a node must declare to fill `SLOTS.body`
 * in `src/app/graph.ts`. Same shape as the hands `source` slot — a source is
 * identified by the port it emits, and the schema makes the contract checkable
 * rather than nominal (a candidate emitting nothing on `body` is a silent graph).
 *
 * Why a second slot rather than a second candidate of `source`: the `source`
 * slot's output is `hands`, and a player may want hands AND body at once — they
 * are different instruments, not alternatives. The body branch is therefore
 * always wired (like the face branch) and gated off until something claims it,
 * and this slot lets the same URL seam (`?slot.body=synthetic-body`) run the
 * whole body path with no camera and no model.
 */
import type { PortSpec } from '@thoremin/dag';
import { BodyFrameSchema } from '../nodes/domain';
import type { SlotContract } from '../nodes/slot_contract';

export const BODY_SLOT_OUTPUT: PortSpec = {
  name: 'body',
  kind: 'body-frame',
  description: 'The latest full-body pose frame (33 landmarks; absent when nobody is in frame).',
  schema: BodyFrameSchema,
};

export const BODY_SLOT_INPUTS: readonly PortSpec[] = [];

/** The body model's lifecycle, which the body branch wires to the overlay's "Body: ..." line
 *  whichever candidate fills the slot, so every candidate must declare it (#737). */
export const BODY_SLOT_STATUS: PortSpec = { name: 'status', kind: 'body-status' };

export const BODY_SLOT_CONTRACT: SlotContract = {
  role: 'source',
  requiredInputs: [],
  output: BODY_SLOT_OUTPUT,
  outputs: [BODY_SLOT_STATUS],
};
