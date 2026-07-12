/**
 * Tests the indirect-map node: gesture features → weighted prompts + config
 * dials. Verifies exact mapping (no smoothing), smoothing convergence,
 * absent-hand → zero weight, and replay from a disk fixture.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { loadStream } from './helpers/fixtures';
import { indirectMapNode, ABSENT_HAND, ABSENT_FACE, type GenerativeSteer, type HandFeatures, type FaceFeatures } from '@/nodes';

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

// Parse params through the node's Zod schema (applies defaults like `source`),
// as the engine does — make() expects the parsed shape.
const P = indirectMapNode.params.parse(PARAMS);

describe('indirect-map', () => {
  it('maps openness → strain weight exactly (no smoothing)', async () => {
    const frames = [feat({ openness: 0 }), feat({ openness: 0.5 }), feat({ openness: 1 })];
    const outs = (await replayNode(indirectMapNode.make(P), { features: frames })).map((o) => o.steer as GenerativeSteer);
    expect(outs[0].prompts[0]).toMatchObject({ text: 'ambient pads', weight: 0 });
    expect(outs[1].prompts[0].weight).toBeCloseTo(1, 3); // 0.5 of 0..2
    expect(outs[2].prompts[0].weight).toBeCloseTo(2, 3);
  });

  it('absent hand → zero weights', async () => {
    const [out] = await replayNode(indirectMapNode.make(P), {
      features: [{ left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND } } as HandFeatures],
    });
    expect((out.steer as GenerativeSteer).prompts.every((p) => p.weight === 0)).toBe(true);
  });

  it('emits the configured dial value', async () => {
    const [out] = await replayNode(indirectMapNode.make(P), { features: [feat({ x: 0.75 })] });
    expect((out.steer as GenerativeSteer).config.brightness).toBeCloseTo(0.75, 3);
  });

  it('smoothing eases the weight toward the target over ticks', async () => {
    const frames = Array.from({ length: 10 }, () => feat({ openness: 1 }));
    const outs = (await replayNode(indirectMapNode.make(indirectMapNode.params.parse({ ...PARAMS, smoothing: 0.6 })), { features: frames })).map(
      (o) => (o.steer as GenerativeSteer).prompts[0].weight,
    );
    expect(outs[0]).toBeLessThan(outs[1]); // easing in
    expect(outs[9]).toBeGreaterThan(outs[0]);
    expect(outs[9]).toBeLessThanOrEqual(2);
  });

  it('runs from a recorded hand-features fixture', async () => {
    const features = loadStream('sweep_right', 'feat.features');
    const outs = await replayNode(indirectMapNode.make(P), { features });
    expect(outs.length).toBe(features.length);
    const steer = outs[20].steer as GenerativeSteer;
    expect(steer.prompts).toHaveLength(2);
    expect(steer.config).toHaveProperty('brightness');
  });

  it('steers from FACE features (smile → strain weight, mouthOpen → dial)', async () => {
    const faceParams = indirectMapNode.params.parse({
      strains: [{ text: 'euphoric choir', source: 'face', feature: 'smile', inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 }],
      dials: [{ name: 'density', source: 'face', feature: 'mouthOpen', inMin: 0, inMax: 1, outMin: 0, outMax: 1 }],
    });
    const face = (smile: number, mouthOpen: number): FaceFeatures => ({ ...ABSENT_FACE, present: true, smile, mouthOpen });
    const outs = (
      await replayNode(indirectMapNode.make(faceParams), {
        face: [face(0, 0), face(0.5, 0.4), face(1, 0.8)],
      })
    ).map((o) => o.steer as GenerativeSteer);

    expect(outs[0].prompts[0]).toMatchObject({ text: 'euphoric choir', weight: 0 });
    expect(outs[2].prompts[0].weight).toBeCloseTo(2, 3); // full smile → max weight
    expect(outs[1].config.density).toBeCloseTo(0.4, 3); // mouthOpen → density dial
    // Absent face → zero.
    const [absent] = await replayNode(indirectMapNode.make(faceParams), { face: [{ ...ABSENT_FACE }] });
    expect((absent.steer as GenerativeSteer).prompts[0].weight).toBe(0);
  });
});
