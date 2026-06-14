/**
 * Tests the `pick` adapter and the full gesture→harmony DAG it unlocks:
 *   synthetic-hands → hand-features → pick(right.x) → progression → chord
 */
import { describe, it, expect } from 'vitest';
import { replayNode, runHeadless, type GraphSpec } from '@/dag';
import { pickNode, createCoreRegistry, ABSENT_HAND, type HandFeatures, type SynthParams } from '@/nodes';

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

describe('gesture → harmony DAG (via pick)', () => {
  it('hand x sweep drives the progression → chord changes', async () => {
    const spec: GraphSpec = {
      nodes: [
        { id: 'src', type: 'synthetic-hands', params: { hands: 'right', sweepPeriod: 2 } },
        { id: 'feat', type: 'hand-features', params: { mirrorX: false, mirrorHandedness: false } },
        { id: 'x', type: 'pick', params: { path: 'right.x' } },
        { id: 'prog', type: 'progression', params: { key: 'C', romanNumerals: ['I', 'IV', 'V', 'vi'] } },
        { id: 'chord', type: 'chord', params: { baseOctave: 4, maxVoices: 4 } },
      ],
      edges: [
        { from: { node: 'src', port: 'hands' }, to: { node: 'feat', port: 'hands' } },
        { from: { node: 'feat', port: 'features' }, to: { node: 'x', port: 'in' } },
        { from: { node: 'x', port: 'value' }, to: { node: 'prog', port: 'position' } },
        { from: { node: 'prog', port: 'chord' }, to: { node: 'chord', port: 'chord' } },
      ],
    };
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 60, nominalDt: 1 / 30 });

    const chords = recorder.values('prog.chord') as string[];
    // The hand sweeps across the frame, so more than one chord is visited.
    expect(new Set(chords).size).toBeGreaterThan(1);
    // Every emitted chord renders to a non-empty voiced SynthParams.
    const params = recorder.values('chord.params') as SynthParams[];
    expect(params.every((p) => p.voices.length >= 3)).toBe(true);
  });
});
