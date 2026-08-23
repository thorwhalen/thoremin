/**
 * The source-slot contract — what a node must declare to stand where the
 * instrument's hand source stands (Stream Applier M-C, issue #104).
 *
 * The design's resolved fork (docs/design/stream-applier.md, "M-C resolved") is
 * that origin variability lives in **two different places**, and which one
 * depends on what the origin emits:
 *
 *  - **Raw video** (a `<video>` element — camera, file, stream) is a *host-side*
 *    concern. The element goes into `ctx.resources.video` and `webcam-hands`
 *    runs unchanged: its job (run MediaPipe on a video element and latch the
 *    result) is identical whatever produced the pixels. That is M-A's
 *    `?source=video`, and it stays where it is.
 *  - **Finished frames** (a `HandsFrame` from a recording, a generator, or a
 *    state-feedback source) are a *node swap*. They emit the node's output type
 *    directly; there is no inference to do and no machinery to reuse. And the
 *    batch/test path runs in Node with no DOM, where a node that so much as
 *    imports `@mediapipe/tasks-vision` cannot load at all — so a finished-frame
 *    origin MUST be a different node type, not an overloaded webcam node.
 *
 * This contract governs the second group. Its candidates are the finished-frame
 * emitters; `videoFileSource` is deliberately NOT among them.
 *
 * Unlike the mapping slot, the required-input list is **empty**: sources are
 * zero-input nodes, and nothing in the default graph wires into the source
 * position. What has to hold is the OUTPUT — `hands` carrying a `HandsFrame` —
 * because `hand-features`, `canvas-overlay` and `hand-feature-vector` all read
 * it. That port carries a `schema`, so in batch runs the engine catches a source
 * that emits a malformed frame, or nothing at all, at the source instead of as a
 * wrong note three nodes downstream.
 */
import type { PortSpec, Role } from '@/dag';
import type { SlotContract } from '../slot_contract';
import { HandsFrameSchema } from '../domain';

/**
 * The output port every source-slot node must emit. `schema` is what makes this
 * a checkable contract rather than a naming convention — see
 * `PortSpec.schema` and `EngineOptions.validatePorts`.
 */
export const SOURCE_SLOT_OUTPUT: PortSpec = {
  name: 'hands',
  kind: 'hands-frame',
  schema: HandsFrameSchema,
};

/**
 * Sources take no inputs, so a swap cannot orphan an edge into the slot — the
 * whole risk is on the output side. Kept explicit (rather than omitted) so every
 * slot's contract reads the same way.
 */
export const SOURCE_SLOT_INPUTS: readonly PortSpec[] = [];

export const SOURCE_SLOT_CONTRACT: SlotContract = {
  role: 'source' as Role,
  requiredInputs: [],
  output: SOURCE_SLOT_OUTPUT,
};
