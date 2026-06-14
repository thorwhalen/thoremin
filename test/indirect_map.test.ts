/**
 * Tests the indirect-map node: gesture features → weighted prompts + config
 * dials. Verifies exact mapping (no smoothing), smoothing convergence,
 * absent-hand → zero weight, and replay from a disk fixture.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { replayNode, valuesFromNDJSON } from '@/dag';
import { indirectMapNode, ABSENT_HAND, type GenerativeSteer, type HandFeatures } from '@/nodes';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function feat(right: Partial<typeof ABSENT_HAND>): HandFeatures {
  return { left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND, present: true, ...right } };
}

const PARAMS = {
  strains: [
    { text: 'ambient pads', hand: 'right' as const, feature: 'openness' as const, inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 },
    { text: 'driving drums', hand: 'right' as const, feature: 'y' as const, inMin: 0, inMax: 1, weightMin: 0, weightMax: 1 },
  ],
  dials: [{ name: 'brightness', hand: 'right' as const, feature: 'x' as const, inMin: 0, inMax: 1, outMin: 0, outMax: 1 }],
  smoothing: 0,
  throttleSec: 0,
};

describe('indirect-map', () => {
  it('maps openness → strain weight exactly (no smoothing)', async () => {
    const frames = [feat({ openness: 0 }), feat({ openness: 0.5 }), feat({ openness: 1 })];
    const outs = (await replayNode(indirectMapNode.make(PARAMS), { features: frames })).map((o) => o.steer as GenerativeSteer);
    expect(outs[0].prompts[0]).toMatchObject({ text: 'ambient pads', weight: 0 });
    expect(outs[1].prompts[0].weight).toBeCloseTo(1, 3); // 0.5 of 0..2
    expect(outs[2].prompts[0].weight).toBeCloseTo(2, 3);
  });

  it('absent hand → zero weights', async () => {
    const [out] = await replayNode(indirectMapNode.make(PARAMS), {
      features: [{ left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND } } as HandFeatures],
    });
    expect((out.steer as GenerativeSteer).prompts.every((p) => p.weight === 0)).toBe(true);
  });

  it('emits the configured dial value', async () => {
    const [out] = await replayNode(indirectMapNode.make(PARAMS), { features: [feat({ x: 0.75 })] });
    expect((out.steer as GenerativeSteer).config.brightness).toBeCloseTo(0.75, 3);
  });

  it('smoothing eases the weight toward the target over ticks', async () => {
    const frames = Array.from({ length: 10 }, () => feat({ openness: 1 }));
    const outs = (await replayNode(indirectMapNode.make({ ...PARAMS, smoothing: 0.6 }), { features: frames })).map(
      (o) => (o.steer as GenerativeSteer).prompts[0].weight,
    );
    expect(outs[0]).toBeLessThan(outs[1]); // easing in
    expect(outs[9]).toBeGreaterThan(outs[0]);
    expect(outs[9]).toBeLessThanOrEqual(2);
  });

  it('runs from a recorded hand-features fixture', async () => {
    const features = valuesFromNDJSON(readFileSync(join(FIXTURES, 'sweep_right', 'feat.features.ndjson'), 'utf8'));
    const outs = await replayNode(indirectMapNode.make(PARAMS), { features });
    expect(outs.length).toBe(features.length);
    const steer = outs[20].steer as GenerativeSteer;
    expect(steer.prompts).toHaveLength(2);
    expect(steer.config).toHaveProperty('brightness');
  });
});
