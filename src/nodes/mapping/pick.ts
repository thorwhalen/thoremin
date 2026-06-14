/**
 * `pick` node — a tiny adapter that extracts a scalar from a structured input
 * via a dotted path (e.g. `right.x` from `HandFeatures`, or `smile` from
 * `FaceFeatures`). Bridges nodes whose output is an object to nodes that want a
 * bare number — e.g. `hand-features → pick('right.x') → progression.position`
 * to drive harmony from a gesture. Pure + deterministic.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';

const Params = z.object({
  /** Dotted path into the input object, e.g. "right.x" or "smile". */
  path: z.string().default(''),
  /** Value emitted when the path is missing or not a number. */
  default: z.number().default(0),
});
type Params = z.infer<typeof Params>;

export const pickNode = defineNode<Params>({
  type: 'pick',
  title: 'Pick',
  description: 'Extract a scalar from a structured input by dotted path (e.g. right.x).',
  inputs: [{ name: 'in', kind: 'any' }],
  outputs: [{ name: 'value', kind: 'number' }],
  params: Params,
  process(inputs, p) {
    let v: unknown = inputs.in;
    for (const seg of p.path.split('.').filter(Boolean)) {
      if (v == null || typeof v !== 'object') {
        v = undefined;
        break;
      }
      v = (v as Record<string, unknown>)[seg];
    }
    return { value: typeof v === 'number' && Number.isFinite(v) ? v : p.default };
  },
});
