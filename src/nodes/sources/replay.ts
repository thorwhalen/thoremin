/**
 * `replay-source` node — emits a pre-recorded sequence of values, one per tick,
 * on its output port. This is what lets a recorded edge stand in for an
 * expensive upstream subgraph: drop a `replay-source` loaded with a recorded
 * `hand-features` stream in front of the mapping/synthesis nodes and run the
 * downstream graph deterministically, with no camera.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';

const Params = z.object({
  /** The recorded values, in tick order. */
  values: z.array(z.unknown()).default([]),
  /** Loop back to the start when exhausted (otherwise hold the last value). */
  loop: z.boolean().default(false),
});
type Params = z.infer<typeof Params>;

export const replaySourceNode = defineNode<Params>({
  type: 'replay-source',
  title: 'Replay Source',
  description: 'Emits a recorded value stream, one value per tick.',
  inputs: [],
  outputs: [{ name: 'value' }],
  params: Params,
  make({ values, loop }) {
    return {
      process(_inputs, ctx) {
        if (values.length === 0) return {};
        const i = loop ? ctx.tick % values.length : Math.min(ctx.tick, values.length - 1);
        return { value: values[i] };
      },
    };
  },
});
