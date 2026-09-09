/**
 * `delay` — emit the input from `ticks` ticks ago (#101 M-G).
 *
 * The companion to {@link EdgeSpec.delayed}, and deliberately a different tool:
 *
 * - A **delayed edge** exists to break a cycle. It is invisible to the topological sort,
 *   so a graph can feed a value backwards without the engine rejecting it. One tick,
 *   always, because that is what "the previous evaluation" means.
 * - This **node** exists to align streams. It has no effect on ordering at all — it is an
 *   ordinary node with an ordinary input — and it delays by however many ticks you ask
 *   for. Use it when two paths through the graph have different lengths and you want them
 *   to line up, or when you want a value's own past alongside its present.
 *
 * Reach for the edge when the graph would otherwise be cyclic; reach for the node when it
 * would not. Using the node to break a cycle does not work (the sort still sees its
 * edges), which is the mistake worth naming up front.
 *
 * Emits **nothing** until it has seen `ticks + 1` values, rather than emitting a seeded
 * zero: a consumer can tell "no history yet" from "the value really was 0" only if the
 * port stays absent, and `EngineOptions.validatePorts` treats an absent port as a fact
 * about the node rather than an error.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';

export const delayParams = z.object({
  /** How many ticks back to emit. 1 = the previous tick. */
  ticks: z.number().int().min(1).max(600).default(1),
});

export const delayNode = defineNode({
  type: 'delay',
  title: 'Delay',
  description: 'Emit the input value from N ticks ago; nothing until that much history exists.',
  roles: ['mapping'],
  params: delayParams,
  inputs: [{ name: 'value', kind: 'any' }],
  outputs: [{ name: 'value', kind: 'any' }],
  make: (params) => {
    // A ring would be tidier; a plain array is clearer and `ticks` is bounded at 600
    // (ten seconds at 60fps), so the shift is not worth optimising away.
    const history: unknown[] = [];
    return {
      process: (inputs) => {
        history.push(inputs.value);
        if (history.length <= params.ticks) return {};
        const out = history.shift();
        // An absent input is recorded as absent and comes back out as absent, so a gap
        // in the source stays a gap `ticks` later instead of becoming a repeat.
        return out === undefined ? {} : { value: out };
      },
      dispose: () => {
        history.length = 0;
      },
    };
  },
});
