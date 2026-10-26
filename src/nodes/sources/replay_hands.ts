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
 *
 * In the app it also replays a recording the PLAYER loads (the Replay tool, `?replay=<url>`):
 * with no `frames` of its own, it reads the engine resource {@link HAND_REPLAY_RESOURCE_KEY}, a
 * getter for the loaded {@link HandReplay}, and plays it BY TIME against `ctx.time` (hold-last, the
 * `replay-source-timed` reading), so a take recorded at 30 fps plays at its own pace under the
 * display's frame loop. A new recording (a new `id`) starts from its first frame.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { HandsFrameSchema, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { SOURCE_SLOT_OUTPUT } from './source_contract';

/**
 * What a source with nothing to replay emits. **Not** `undefined`: the contract
 * says this port always carries a frame, and "no hands detected" is a real,
 * well-defined frame that the whole downstream graph already handles (it is what
 * `webcam-hands` emits before its first inference). Emitting nothing instead
 * would be the exact failure `PortSpec.schema` exists to catch.
 */
const EMPTY: HandsFrame = { width: 640, height: 480, hands: [] };

import { HAND_REPLAY_RESOURCE_KEY, type HandReplay } from './replay_hands.schema';
export { HAND_REPLAY_RESOURCE_KEY, type HandReplay };

/** Index of the last of the ascending `times` at or before `x` (0 when none is). */
function frameAt(times: readonly number[], x: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= x + 1e-6) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

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
    // The loaded recording's playback: its id and the engine time it started at.
    let playing: { id: number; start: number } | null = null;
    return {
      process(_inputs, ctx) {
        if (frames.length === 0) {
          const replay = (ctx?.resources?.[HAND_REPLAY_RESOURCE_KEY] as (() => HandReplay | null) | undefined)?.();
          if (!replay || replay.frames.length === 0) {
            playing = null;
            return { hands: EMPTY };
          }
          if (playing?.id !== replay.id) playing = { id: replay.id, start: ctx.time };
          const span = replay.times[replay.times.length - 1];
          // The loop period adds one mean frame interval, so a uniform take loops seamlessly.
          // Never 0 (every frame at one time): a frame interval at least.
          const period = Math.max(span + (replay.times.length > 1 ? span / (replay.times.length - 1) : 1 / 30), 1 / 30);
          const elapsed = ctx.time - playing.start;
          // A float remainder a hair under the period is the loop's start (time sums drift).
          const wrapped = elapsed % period;
          const at = replay.loop ? (period - wrapped < 1e-6 ? 0 : wrapped) : elapsed;
          return { hands: replay.frames[frameAt(replay.times, at)] as HandsFrame };
        }
        const i = loop ? n % frames.length : Math.min(n, frames.length - 1);
        n += 1;
        // The frame as recorded, stamps included (#226): its `tOrigin` is another
        // document's, so `frameTime` samples it at the tick, and its `t` is what lets
        // the conductor tell the two per-tick copies of one camera frame apart.
        return { hands: frames[i] as HandsFrame };
      },
    };
  },
});
