/**
 * PR 3 of the instruments-as-graphs ADR (§3.3, "proof, not assertion"): switching
 * instruments is an `applyGraph` that KEEPS the trunk (camera, hand features, UI bridge,
 * merge, synth, overlay) and swaps only the branch nodes, and the engine keeps ticking
 * through the switch: no tick is dropped while the new branch's nodes prepare.
 *
 * Headless: no camera, no audio, no canvas. The synthetic-hands source stands in for the
 * webcam so the trunk has a real, deterministic producer.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { branchIdsFor } from '@/app/graph';
import { TRUNK } from '@/instruments/branches';
import { composeInstrumentGraph } from '@/app/graph';
import { AIR } from '../helpers/extensions';

const SLOTS = { source: 'synthetic-hands', body: 'synthetic-body' } as const;

const graphOf = (name: string, registry: ReturnType<typeof createAppRegistry>) => {
  const seed = SEED_INSTRUMENTS.find((s) => s.name === name);
  if (!seed) throw new Error(`no seed named ${name}`);
  return composeInstrumentGraph(branchIdsFor(settingsFromLayer(seed.layer)), SLOTS, registry);
};

describe('an instrument switch between core instruments (core alone too)', () => {
  it('Pentatonic → Glass Bells: trunk kept, the face branch added; ticks continue through the apply', async () => {
    const registry = createAppRegistry();
    const engine = new Engine(graphOf('Pentatonic', registry).spec, registry);
    await engine.init();
    for (let i = 0; i < 3; i++) engine.tick();
    const applying = engine.applyGraph(graphOf('Glass Bells', registry).spec, registry);
    let ticksDuring = 0;
    for (let i = 0; i < 3; i++) {
      engine.tick();
      ticksDuring += 1;
      await Promise.resolve();
    }
    const change = await applying;
    engine.tick();
    expect(ticksDuring).toBe(3);
    for (const id of Object.values(TRUNK)) expect(change.kept).toContain(id);
    expect(change.added).toContain('camFace');
    expect(engine.evaluationOrder()).toContain('camFace');
    engine.dispose();
  });
});

describe.runIf(AIR)('an instrument switch keeps the trunk and never stops the tick', () => {
  it('Pentatonic → Air Drum: trunk kept, hand voices removed, drum added; ticks continue through the apply', async () => {
    const registry = createAppRegistry();
    const from = graphOf('Pentatonic', registry);
    const to = graphOf('Air Drum', registry);
    const engine = new Engine(from.spec, registry);
    await engine.init();
    for (let i = 0; i < 5; i++) engine.tick();

    // The apply prepares asynchronously; the OLD graph must keep ticking meanwhile.
    const applying = engine.applyGraph(to.spec, registry);
    let ticksDuring = 0;
    for (let i = 0; i < 5; i++) {
      engine.tick();
      ticksDuring += 1;
      await Promise.resolve();
    }
    const change = await applying;
    for (let i = 0; i < 5; i++) engine.tick();
    expect(ticksDuring).toBe(5);

    const trunkIds = Object.values(TRUNK);
    for (const id of trunkIds) expect(change.kept).toContain(id);
    expect(change.removed).toContain('map');
    expect(change.added).toEqual(expect.arrayContaining(['airDrum', 'drumOut']));
    expect(change.added).not.toContain('camFace');
    expect(engine.evaluationOrder()).not.toContain('camFace');
    expect(engine.evaluationOrder()).toContain('airDrum');

    // The drum's overlay elements come with its branch; the field guides do not.
    expect(to.elements).toContain('drumPads');
    expect(to.elements).not.toContain('scaleGuide');
    engine.dispose();
  });

  it('Air Flute → Glass Bells: the face source is kept (both use the face), the flute goes, the chord branch comes', async () => {
    const registry = createAppRegistry();
    // The flute with its breath demand (the mouth groups), as the app composes it.
    const flute = SEED_INSTRUMENTS.find((s) => s.name === 'Air Flute')!;
    const fluteIds = branchIdsFor(settingsFromLayer(flute.layer), { demanded: new Set(['face.geom.mouth']) });
    const from = composeInstrumentGraph(fluteIds, SLOTS, registry);
    const to = graphOf('Glass Bells', registry);
    expect(from.elements).toContain('mouthCue');
    expect(from.elements).not.toContain('faceExpression');
    expect(from.elements).not.toContain('faceLandmarks'); // a face borrowed for a breath draws no mesh
    expect(to.elements).toContain('faceExpression');
    expect(to.elements).toContain('faceLandmarks');
    // The set reaches the overlay through the UI bridge, on a port.
    expect(from.spec.edges).toContainEqual({ from: { node: 'ui', port: 'graphElements' }, to: { node: 'overlay', port: 'elements' } });

    const engine = new Engine(from.spec, registry);
    await engine.init();
    engine.tick();
    const change = await engine.applyGraph(to.spec, registry);
    expect(change.kept).toContain('camFace');
    expect(change.removed).toContain('airFlute');
    expect(change.added).toEqual(expect.arrayContaining(['faceExpr', 'exprChord', 'map']));
    engine.tick();
    engine.dispose();
  });
});
