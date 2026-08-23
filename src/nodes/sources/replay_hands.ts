/**
 * `replay-hands` node — replays a recorded `HandsFrame` stream, one frame per
 * tick, on the source slot's `hands` port.
 *
 * `replay-source` already replays *any* recorded value, but on a generic `value`
 * port, which is what makes it a fine stand-in for an arbitrary edge and a poor
 * fit for the **source slot**: a slot candidate is identified by the port it
 * emits (`hands`), not by what it happens to contain. So this is the typed
 * sibling — same replay semantics, the contract's port and schema.
 *
 * That is what makes the whole downstream instrument runnable in plain Node from
 * a landmark recording: no DOM, no MediaPipe WASM, no camera (design-doc
 * boundary A — raw video decode is an offline pre-processing step, never an
 * in-loop batch source).
 *
 * Determinism is the point of a replay source, so it never reads a clock or a
 * random number generator — `test/source_slot.test.ts` enforces that
 * behaviourally, by running each candidate twice under different wall clocks.
 *
 * It also counts its OWN frames rather than reading `ctx.tick`. The engine's tick
 * counter is monotonic for the engine's whole life, which is only the same thing
 * for an instance that existed at tick 0 — and the source slot's whole point is
 * that a source can be swapped into a *running* graph (`applyGraph`, #51). Keyed
 * on `ctx.tick`, a replay swapped in at tick 50 of a 3-frame recording would open
 * on the last frame and never show the other two.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { HandsFrameSchema, type HandsFrame } from '../domain';
import { SOURCE_SLOT_OUTPUT } from './source_contract';

/**
 * What a source with nothing to replay emits. **Not** `undefined`: the contract
 * says this port always carries a frame, and "no hands detected" is a real,
 * well-defined frame that the whole downstream graph already handles (it is what
 * `webcam-hands` emits before its first inference). Emitting nothing instead
 * would be the exact failure `PortSpec.schema` exists to catch.
 */
const EMPTY: HandsFrame = { width: 640, height: 480, hands: [] };

const Params = z.object({
  /** The recorded frames, in tick order. */
  frames: z.array(HandsFrameSchema).default([]),
  /** Loop back to the start when exhausted (otherwise hold the last frame). */
  loop: z.boolean().default(false),
});
type Params = z.infer<typeof Params>;

export const replayHandsNode = defineNode<Params>({
  type: 'replay-hands',
  roles: ['source'],
  title: 'Replay Hands',
  description: 'Replays a recorded hand-landmark stream, one frame per tick. Camera-free and deterministic.',
  inputs: [],
  outputs: [SOURCE_SLOT_OUTPUT],
  params: Params,
  make({ frames, loop }) {
    // Per-INSTANCE, so a replay swapped into a running graph starts at frame 0.
    let n = 0;
    return {
      process() {
        if (frames.length === 0) return { hands: EMPTY };
        const i = loop ? n % frames.length : Math.min(n, frames.length - 1);
        n += 1;
        return { hands: frames[i] as HandsFrame };
      },
    };
  },
});
