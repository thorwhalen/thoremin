/**
 * `replay-body` node (#186) — replays a recorded {@link BodyFrame} stream, one
 * frame per tick, on the body slot's `body` port. The typed sibling of
 * `replay-hands` for the body slot: same semantics (counts its OWN frames so a
 * swap into a running graph starts at frame 0; never reads a clock; emits the
 * empty frame, never `undefined`, when it has nothing to replay).
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { BodyFrameSchema, EMPTY_BODY_FRAME, type BodyFrame, type BodyStatus } from '../domain';
import { BODY_SLOT_OUTPUT } from './body_contract';

const Params = z.object({
  /** The recorded frames, in tick order. */
  frames: z.array(BodyFrameSchema).default([]),
  /** Loop back to the start when exhausted (otherwise hold the last frame). */
  loop: z.boolean().default(false),
});
type Params = z.infer<typeof Params>;

export const replayBodyNode = defineNode<Params>({
  type: 'replay-body',
  roles: ['source'],
  title: 'Replay Body',
  description: 'Replays a recorded full-body pose stream, one frame per tick. Camera-free and deterministic.',
  inputs: [],
  outputs: [
    BODY_SLOT_OUTPUT,
    // A replay is always 'ready'; `bodyDetected` follows the replayed frame.
    { name: 'status', kind: 'body-status' },
  ],
  params: Params,
  make({ frames, loop }) {
    let n = 0;
    return {
      process() {
        const ready = (present: boolean): BodyStatus => ({ phase: 'ready', bodyDetected: present });
        if (frames.length === 0) return { body: EMPTY_BODY_FRAME, status: ready(false) };
        const i = loop ? n % frames.length : Math.min(n, frames.length - 1);
        n += 1;
        const frame = frames[i] as BodyFrame;
        return { body: frame, status: ready(frame.present) };
      },
    };
  },
});
