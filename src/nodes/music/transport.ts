/**
 * `transport` node — a beat clock. Integrates a (possibly time-varying) BPM into
 * a running beat position using the per-tick `ctx.dt`. The conductor chain's
 * timebase: `performance` sets `bpm`, `transport` turns it into a `beat`, and
 * `score` reads `beat` to decide which notes sound. Deterministic given the
 * tick timing, so it replays exactly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';

const Params = z.object({
  startBeat: z.number().default(0),
});
type Params = z.infer<typeof Params>;

export const transportNode = defineNode<Params>({
  type: 'transport',
  title: 'Transport',
  description: 'Beat clock: integrates BPM over time into a running beat position.',
  inputs: [{ name: 'bpm', kind: 'number', default: 120 }],
  outputs: [{ name: 'beat', kind: 'number' }],
  params: Params,
  make(p) {
    let beat = p.startBeat;
    return {
      process(inputs, ctx: NodeContext) {
        const bpm = typeof inputs.bpm === 'number' && inputs.bpm > 0 ? inputs.bpm : 120;
        beat += (bpm / 60) * ctx.dt; // dt is 0 on the first tick, so beat starts at startBeat
        return { beat };
      },
    };
  },
});
