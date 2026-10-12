/**
 * The ASL instruments are reachable and are what they say: seeded (so they are in the
 * Instruments view from a cold load: Instruments → Sign instruments → the row), classed as
 * sign instruments, composing the reader (and, for the chords, the chord branch and its
 * voice), and the graph ticks with the synthetic hand source and validated ports.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { categoryOf } from '@/app/library/category';
import { ASL } from '../helpers/extensions';

const seeded = (name: string) => settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === name)!.layer);

describe.runIf(ASL)('the ASL instruments', () => {
  it('are seeded and listed under the sign instruments', () => {
    expect(SEED_INSTRUMENTS.map((s) => s.name)).toEqual(expect.arrayContaining(['ASL Viewer', 'ASL Chords']));
    expect(categoryOf(seeded('ASL Viewer'))).toBe('sign');
    expect(categoryOf(seeded('ASL Chords'))).toBe('sign');
  });

  it('the viewer is video only: the reader, no hand voices, no chord voice', () => {
    const ids = branchIdsFor(seeded('ASL Viewer'));
    expect(ids).toContain('asl-signs');
    expect(ids).not.toContain('asl-chord');
    expect(ids).not.toContain('field-voices');
    const { elements } = composeInstrumentGraph(ids, { source: 'synthetic-hands' }, createAppRegistry());
    expect(elements).toEqual(expect.arrayContaining(['categoryLabel', 'categoryBars']));
  });

  it('the chords compose the chord branch in D major', () => {
    const s = seeded('ASL Chords');
    expect(branchIdsFor(s)).toEqual(expect.arrayContaining(['asl-signs', 'asl-chord']));
    expect(s.faceChord.chordRoot).toBe(2);
    expect(s.faceChord.chordSource).toBe('custom');
  });

  it('the chords graph ticks with validated ports and emits a reading', () => {
    const registry = createAppRegistry();
    const { spec } = composeInstrumentGraph(['asl-signs', 'asl-chord'], { source: 'synthetic-hands' }, registry);
    const engine = new Engine(spec, registry, { validatePorts: true });
    for (let i = 0; i < 5; i++) engine.tick();
    expect(engine.evaluationOrder()).toEqual(expect.arrayContaining(['aslSigns', 'signChord']));
    const signs = engine.getOutput('aslSigns', 'signs') as { labels: string[] };
    expect(signs.labels.length).toBe(33);
    engine.dispose();
  });
});
