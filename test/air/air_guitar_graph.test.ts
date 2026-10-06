/**
 * The air guitar inside the real default graph (#249), on the #147 template: the dial,
 * the enrolled model and the octave shift reach the node as LIVE inputs, the hands reach
 * it, and its strums reach their own pluck scheduler. Then the whole production graph
 * headless on a synthetic performance, the model handed in through the same
 * `ctx.resources.controls` getter the app injects (the hot store's transient slot), and a
 * mock pluck sink that must be asked to play the enrolled chords' voicings.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import { DEFAULT_AIR_GUITAR } from '@thoremin/ext-air/dials';
import { emptyVocabulary, trainVocabulary, withEntry } from '@thoremin/ext-air/lib/vocabulary';
import { chordShapeFeatureIds } from '@thoremin/ext-air/lib/hand_shape';
import { guitarVoicing, parseChordName } from '@thoremin/ext-air/lib/guitar';
import { enrolSamples, guitarTake } from './synthetic_guitar';
import { AIR } from '../helpers/extensions';

describe.runIf(AIR)('air guitar in the default graph', () => {
  it('wires the dial, the model, the octave shift, the hands and the strums — the #249 guard', () => {
    const g = defaultGraph();
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      g.edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(g.nodes.some((n) => n.id === 'airGuitar' && n.type === 'air-guitar')).toBe(true);
    const out = g.nodes.find((n) => n.id === 'guitarOut');
    expect(out?.type).toBe('pluck-out');
    expect(out?.params).toMatchObject({ timbre: 'guitar', mono: false });
    expect(has('ui', 'airGuitar', 'airGuitar', 'config')).toBe(true);
    expect(has('ui', 'airGuitarModel', 'airGuitar', 'model')).toBe(true);
    expect(has('ui', 'octaveShift', 'airGuitar', 'octaveShift')).toBe(true);
    expect(has('cam', 'hands', 'airGuitar', 'hands')).toBe(true);
    expect(has('airGuitar', 'notes', 'guitarOut', 'notes')).toBe(true);
    const inbound = (id: string) => new Set(g.edges.filter((e) => e.to.node === id).map((e) => e.to.port));
    expect([...inbound('airGuitar')].sort()).toEqual(['config', 'hands', 'model', 'octaveShift']);
    expect([...inbound('guitarOut')].sort()).toEqual(['mute', 'notes']);
  });

  it('headless: with the dial on and chords enrolled, the strums play the chords\' voicings', async () => {
    let v = emptyVocabulary(chordShapeFeatureIds());
    v = withEntry(v, 'G', enrolSamples('G', 40, 1));
    v = withEntry(v, 'C', enrolSamples('C', 40, 2));
    const model = trainVocabulary(v);
    const frames = guitarTake({ duration: 5, chordAt: (t) => (t < 2.5 ? 'G' : 'C') });
    const registry = createAppRegistry();
    const g = defaultGraph({ source: 'replay-hands' }, registry);
    g.nodes.find((n) => n.id === 'cam')!.params = { frames };
    const played: number[] = [];
    const voice = { root: 0, type: 'major', octaves: 2, baseOctave: 3, sound: 'sine' } as const;
    await runHeadless(g, registry, {
      ticks: frames.length,
      nominalDt: 1 / 30,
      resources: {
        controls: () => ({ right: voice, left: voice, airGuitar: { ...DEFAULT_AIR_GUITAR, enabled: true, mirrorHandedness: false }, airGuitarModel: model }),
        createPluckSink: () => ({ play: (midi: number, velocity: number) => void (velocity > 0 && played.push(midi)), close: () => {} }),
      },
      recordOnly: ['airGuitar.notes'],
    });
    const G = guitarVoicing(parseChordName('G')!).filter((n) => n !== null);
    const C = guitarVoicing(parseChordName('C')!).filter((n) => n !== null);
    expect(played.length).toBeGreaterThanOrEqual(4 * 5);
    expect(played.slice(0, G.length)).toEqual(G);
    expect(played.slice(-C.length)).toEqual(C);
  });
});
