/**
 * Tests the indirect-map node: gesture features → weighted prompts + config
 * dials. Verifies exact mapping (no smoothing), smoothing convergence,
 * absent-hand → zero weight, replay from a disk fixture, and — the #141
 * prerequisite — that WHICH strains and dials the gestures drive is a live
 * input rather than only a build-time param.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { loadStream } from './helpers/fixtures';
import { indirectMapNode, ABSENT_HAND, ABSENT_FACE, type GenerativeSteer, type HandFeatures, type FaceFeatures } from '@/nodes';
import { SteerConfigSchema } from '@/nodes/mapping/indirect_map';

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

// ---- the live steer config (#141) ------------------------------------------

/** Drive the node over N ticks with one steerConfig value held on the port. */
async function withConfig(
  params: unknown,
  steerConfig: unknown,
  frames: HandFeatures[],
  log?: (msg: string) => void,
): Promise<GenerativeSteer[]> {
  const handlers = indirectMapNode.make(indirectMapNode.params.parse(params));
  const outs = await replayNode(handlers, {
    features: frames,
    steerConfig: frames.map(() => steerConfig),
  }, log ? { log } : undefined);
  return outs.map((o) => o.steer as GenerativeSteer);
}

describe('indirect-map steerConfig (the #141 prerequisite)', () => {
  it('an UNCONNECTED port changes nothing — params stay the build-time default', async () => {
    // The repo's convention, and the reason this port is safe to add before
    // anything drives it: a node with no edge into `steerConfig` behaves exactly
    // as it did when strains/dials were params only.
    const frames = [feat({ openness: 1 })];
    const [connected] = await withConfig(PARAMS, undefined, frames);
    const [plain] = (await replayNode(indirectMapNode.make(P), { features: frames })).map(
      (o) => o.steer as GenerativeSteer,
    );
    expect(connected).toEqual(plain);
  });

  it('a live config REPLACES the strains without rebuilding the node', async () => {
    // This is the whole point: a vibe editor that can only change the mapping by
    // rebuilding the graph would reload the ML models to alter a string.
    const outs = await withConfig(
      PARAMS,
      { strains: [{ text: 'glassy bells', hand: 'right', feature: 'openness', inMin: 0, inMax: 1, weightMin: 0, weightMax: 3 }] },
      [feat({ openness: 1 })],
    );
    expect(outs[0].prompts).toHaveLength(1);
    expect(outs[0].prompts[0]).toMatchObject({ text: 'glassy bells', weight: 3 });
  });

  it('an omitted field keeps the param (partial override)', async () => {
    // Only `dials` is overridden; the two param strains must survive.
    const outs = await withConfig(
      PARAMS,
      { dials: [{ name: 'density', hand: 'right', feature: 'x', inMin: 0, inMax: 1, outMin: 0, outMax: 10 }] },
      [feat({ openness: 1, x: 0.5 })],
    );
    expect(outs[0].prompts.map((p) => p.text)).toEqual(['ambient pads', 'driving drums']);
    expect(outs[0].config).toEqual({ density: 5 });
  });

  it('reverting the port to undefined restores the params', async () => {
    const handlers = indirectMapNode.make(P);
    const frames = [feat({ openness: 1 }), feat({ openness: 1 }), feat({ openness: 1 })];
    const outs = (
      await replayNode(handlers, {
        features: frames,
        steerConfig: [undefined, { strains: [{ text: 'only this', hand: 'right', feature: 'openness' }] }, undefined],
      })
    ).map((o) => (o.steer as GenerativeSteer).prompts.map((p) => p.text));
    expect(outs[0]).toEqual(['ambient pads', 'driving drums']);
    expect(outs[1]).toEqual(['only this']);
    expect(outs[2]).toEqual(['ambient pads', 'driving drums']);
  });

  it('a MALFORMED config is ignored, logged once, and never stops the instrument', async () => {
    // process() must not throw: one bad store write would otherwise take the
    // whole graph down on every subsequent frame.
    const logged: string[] = [];
    const outs = await withConfig(PARAMS, { strains: 'not an array' }, [feat({ openness: 1 })], (m) =>
      logged.push(m),
    );
    expect(outs[0].prompts.map((p) => p.text)).toEqual(['ambient pads', 'driving drums']);
    expect(logged.filter((m) => m.includes('invalid steerConfig'))).toHaveLength(1);
  });

  it('editing one strain resets ITS smoothing, and leaves its neighbour easing', async () => {
    // Smoothing state is keyed by position AND identity. Slot 0 becoming a
    // different prompt must start from rest — inheriting the old prompt's
    // eased-in weight would be a glitch, not continuity — while slot 1, which
    // did not change, keeps climbing.
    const params = { ...PARAMS, smoothing: 0.6 };
    const a = { text: 'ambient pads', hand: 'right' as const, feature: 'openness' as const, inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 };
    const b = { text: 'driving drums', hand: 'right' as const, feature: 'openness' as const, inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 };
    const before = { strains: [a, b] };
    const after = { strains: [{ ...a, text: 'renamed' }, b] };
    const frames = Array.from({ length: 8 }, () => feat({ openness: 1 }));

    const outs = (
      await replayNode(indirectMapNode.make(indirectMapNode.params.parse(params)), {
        features: frames,
        steerConfig: frames.map((_, i) => (i < 4 ? before : after)),
      })
    ).map((o) => (o.steer as GenerativeSteer).prompts);

    expect(outs[3][0].text).toBe('ambient pads');
    const climbed = outs[3][0].weight;
    expect(climbed).toBeGreaterThan(0);
    // Slot 0 is a different prompt now: back to rest, then easing again.
    expect(outs[4][0].text).toBe('renamed');
    expect(outs[4][0].weight).toBeLessThan(climbed);
    // Slot 1 was untouched and kept climbing straight through the edit.
    expect(outs[4][1].weight).toBeGreaterThan(outs[3][1].weight);
  });

  it('a strain removed and re-added starts from rest — no resurrected weight', async () => {
    // Each edit prunes the smoothing keys the new config no longer has. That is
    // usually described as a memory concern, but it has a semantic consequence
    // worth pinning: a prompt you deleted and brought back is a prompt you are
    // introducing again, so it eases in from rest. Keeping the old entry would
    // make it snap back to the momentum it had before you removed it — a jump in
    // the mix with no gesture behind it.
    const params = { ...PARAMS, smoothing: 0.6 };
    const A = { text: 'A', hand: 'right' as const, feature: 'openness' as const, inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 };
    const B = { text: 'B', hand: 'right' as const, feature: 'openness' as const, inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 };
    const frames = Array.from({ length: 12 }, () => feat({ openness: 1 }));

    const outs = (
      await replayNode(indirectMapNode.make(indirectMapNode.params.parse(params)), {
        features: frames,
        // A for four ticks, then B for four (A's entry is pruned), then A again.
        steerConfig: frames.map((_, i) => ({ strains: [i < 4 || i >= 8 ? A : B] })),
      })
    ).map((o) => (o.steer as GenerativeSteer).prompts[0]);

    const aClimbed = outs[3].weight;
    expect(outs[3].text).toBe('A');
    expect(aClimbed).toBeGreaterThan(0);
    // A comes back at tick 8: from rest, not from where it left off.
    expect(outs[8].text).toBe('A');
    expect(outs[8].weight).toBeLessThan(aClimbed);
    expect(outs[8].weight).toBeCloseTo(outs[4].weight, 6); // exactly B's first step
  });

  // ---- the edit shapes a vibe editor actually produces ---------------------
  //
  // An adversarial review found the original keying (`${i}:${text}`) mixed
  // identity with POSITION, so inserting, deleting or reordering a prompt reset
  // every entry after the edit point — a mix-wide duck with no gesture behind it,
  // in exactly the operations an editor is for. Only a rename-at-a-fixed-index
  // was covered, which is the single edit shape that keying happened to survive.
  // These are the cases that were missing.

  /** Drive with `smoothing`, holding the hand open, swapping config at `swapAt`. */
  async function editAt(before: unknown[], after: unknown[], swapAt = 6, ticks = 8) {
    const frames = Array.from({ length: ticks }, () => feat({ openness: 1 }));
    const outs = await replayNode(indirectMapNode.make(indirectMapNode.params.parse({ ...PARAMS, smoothing: 0.6 })), {
      features: frames,
      steerConfig: frames.map((_, i) => ({ strains: i < swapAt ? before : after })),
    });
    return outs.map((o) => (o.steer as GenerativeSteer).prompts);
  }

  const S = (text: string) => ({
    text,
    hand: 'right' as const,
    feature: 'openness' as const,
    inMin: 0,
    inMax: 1,
    weightMin: 0,
    weightMax: 2,
  });
  /** Find a prompt by text in one tick's output. */
  const w = (prompts: { text: string; weight: number }[], text: string) =>
    prompts.find((p) => p.text === text)!.weight;

  it('DELETING a strain leaves the survivors exactly where they were', async () => {
    const outs = await editAt([S('A'), S('B')], [S('B')]);
    expect(w(outs[6], 'B')).toBeGreaterThan(w(outs[5], 'B')); // kept climbing, no reset
    expect(outs[6]).toHaveLength(1);
  });

  it('INSERTING a strain at the front does not duck the ones below it', async () => {
    const outs = await editAt([S('A'), S('B')], [S('C'), S('A'), S('B')]);
    expect(w(outs[6], 'A')).toBeGreaterThan(w(outs[5], 'A'));
    expect(w(outs[6], 'B')).toBeGreaterThan(w(outs[5], 'B'));
    expect(w(outs[6], 'C')).toBeLessThan(w(outs[6], 'A')); // the NEW one eases in from rest
  });

  it('REORDERING strains preserves every weight', async () => {
    const outs = await editAt([S('A'), S('B')], [S('B'), S('A')]);
    expect(w(outs[6], 'A')).toBeGreaterThan(w(outs[5], 'A'));
    expect(w(outs[6], 'B')).toBeGreaterThan(w(outs[5], 'B'));
  });

  it('DIALS behave the same way when one is removed', async () => {
    const D = (name: string) => ({
      name,
      hand: 'right' as const,
      feature: 'openness' as const,
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 1,
    });
    const frames = Array.from({ length: 8 }, () => feat({ openness: 1 }));
    const outs = (
      await replayNode(indirectMapNode.make(indirectMapNode.params.parse({ ...PARAMS, smoothing: 0.6 })), {
        features: frames,
        steerConfig: frames.map((_, i) => ({ dials: i < 6 ? [D('bpm'), D('density')] : [D('density')] })),
      })
    ).map((o) => (o.steer as GenerativeSteer).config);
    expect(outs[6].density).toBeGreaterThan(outs[5].density!);
    expect(outs[6].bpm).toBeUndefined();
  });

  it('two strains with the SAME text keep separate smoothing state', async () => {
    // Identity keying disambiguates repeats by occurrence, so a duplicated prompt
    // is two entries, not one aliased pair. Opposite targets make aliasing
    // unmistakable: entangled, the second entry would ease toward whatever the
    // first just wrote and never settle at its own target of 0.
    const up = { ...S('twin'), weightMin: 0, weightMax: 2 };
    const flat = { ...S('twin'), weightMin: 0, weightMax: 0 };
    const frames = Array.from({ length: 10 }, () => feat({ openness: 1 }));
    const outs = (
      await replayNode(indirectMapNode.make(indirectMapNode.params.parse({ ...PARAMS, smoothing: 0.6 })), {
        features: frames,
        steerConfig: frames.map(() => ({ strains: [up, flat] })),
      })
    ).map((o) => (o.steer as GenerativeSteer).prompts);
    expect(outs[9]).toHaveLength(2);
    expect(outs[9][0].weight).toBeGreaterThan(1); // climbing toward its own target of 2
    expect(outs[9][1].weight).toBe(0); // sitting on its own target, untouched by its twin
  });

  it('the exported schema is the contract a store/dial/editor all speak', () => {
    // Same schema validates the port value, the store slice and the persisted
    // dial — so those three cannot drift into disagreeing about the shape.
    expect(SteerConfigSchema.safeParse({}).success).toBe(true);
    expect(SteerConfigSchema.safeParse({ smoothing: 0.5 }).success).toBe(true);
    expect(SteerConfigSchema.safeParse({ smoothing: 2 }).success).toBe(false);
    expect(SteerConfigSchema.safeParse({ strains: [{ text: 'x' }] }).success).toBe(true);
    expect(SteerConfigSchema.safeParse({ strains: [{}] }).success).toBe(false); // text is required
  });
});
