/**
 * Tests the `pick` adapter (one scalar out of a structured stream), alone and in a DAG:
 *   synthetic-hands → hand-features → pick(right.x)
 */
import { describe, it, expect } from 'vitest';
import { replayNode, runHeadless, type GraphSpec } from '@thoremin/dag';
import { pickNode, createCoreRegistry, ABSENT_HAND, type HandFeatures } from '@/nodes';

function feat(rightX: number, present = true): HandFeatures {
  return { left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND, present, x: rightX } };
}

describe('pick node', () => {
  it('extracts a scalar by dotted path', async () => {
    const h = pickNode.make(pickNode.params.parse({ path: 'right.x', default: -1 }));
    const outs = await replayNode(h, { in: [feat(0.25), feat(0.8)] });
    expect(outs.map((o) => o.value)).toEqual([0.25, 0.8]);
  });

  it('returns the default for a missing path or non-number', async () => {
    const h = pickNode.make(pickNode.params.parse({ path: 'right.nope', default: 0.5 }));
    const [out] = await replayNode(h, { in: [feat(0.3)] });
    expect(out.value).toBe(0.5);
  });
});

describe('pick in a DAG', () => {
  it('a hand x sweep, picked from the hand features, moves across the frame', async () => {
    const spec: GraphSpec = {
      nodes: [
        { id: 'src', type: 'synthetic-hands', params: { hands: 'right', sweepPeriod: 2 } },
        { id: 'feat', type: 'hand-features', params: { mirrorX: false, mirrorHandedness: false } },
        { id: 'x', type: 'pick', params: { path: 'right.x', default: -1 } },
      ],
      edges: [
        { from: { node: 'src', port: 'hands' }, to: { node: 'feat', port: 'hands' } },
        { from: { node: 'feat', port: 'features' }, to: { node: 'x', port: 'in' } },
      ],
    };
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 60, nominalDt: 1 / 30 });
    const xs = recorder.values('x.value') as number[];
    // The path resolves on every tick (never the default), and the sweep spans the frame.
    expect(xs.every((x) => x >= 0 && x <= 1)).toBe(true);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.3);
  });
});
