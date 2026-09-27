/**
 * The air flute inside the real default graph (#249), on the #147 template: the dial,
 * both classifiers and the octave shift reach the node as LIVE inputs, the hands and the
 * face vector reach it, and its voice reaches the synth merge (so the synth, MIDI out and
 * the overlay all get it). Then the production graph headless on a synthetic performance
 * in "fingers only" (a replayed hands stream carries no face): the merge's output carries
 * the flute voice at the enrolled note.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import { DEFAULT_AIR_FLUTE } from '@/settings/schema';
import { FLUTE_VOICE_ID } from '@/extensions/air/nodes/air_flute';
import type { SynthParams } from '@/nodes/domain';
import { emptyVocabulary, trainVocabulary, withEntry } from '@/extensions/air/lib/vocabulary';
import { midiToFreq } from '@/music/theory';
import { fingeringSamples, fluteTake } from './synthetic_flute';

describe('air flute in the default graph', () => {
  it('wires the dial, both models, the octave shift, the hands, the face and the voice — the #249 guard', () => {
    const g = defaultGraph();
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      g.edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(g.nodes.some((n) => n.id === 'airFlute' && n.type === 'air-flute')).toBe(true);
    expect(has('cam', 'hands', 'airFlute', 'hands')).toBe(true);
    expect(has('faceVec', 'vector', 'airFlute', 'face')).toBe(true);
    expect(has('camFace', 'face', 'airFlute', 'faceFrame')).toBe(true);
    expect(has('ui', 'airFlute', 'airFlute', 'config')).toBe(true);
    expect(has('ui', 'airFluteFingerModel', 'airFlute', 'fingerModel')).toBe(true);
    expect(has('ui', 'airFluteMouthModel', 'airFlute', 'mouthModel')).toBe(true);
    expect(has('ui', 'octaveShift', 'airFlute', 'octaveShift')).toBe(true);
    expect(has('airFlute', 'params', 'merge', 'voice4')).toBe(true);
    const inbound = new Set(g.edges.filter((e) => e.to.node === 'airFlute').map((e) => e.to.port));
    expect([...inbound].sort()).toEqual(['config', 'face', 'faceFrame', 'fingerModel', 'hands', 'mouthModel', 'octaveShift']);
  });

  it('headless: a held enrolled fingering reaches the synth merge as the flute voice', async () => {
    let v = emptyVocabulary([]);
    v = withEntry(v, 'D5', fingeringSamples(['E', 'A'], 40, 1));
    v = withEntry(v, 'G4', fingeringSamples(['G', 'C'], 40, 2));
    const model = trainVocabulary({ ...v, features: Object.keys(v.entries[0].samples[0]) });
    const take = fluteTake({ duration: 2, fingeringAt: () => ['E', 'A'], mouthAt: () => null });
    const registry = createAppRegistry();
    const g = defaultGraph({ source: 'replay-hands' }, registry);
    g.nodes.find((n) => n.id === 'cam')!.params = { frames: take.map((x) => x.frame) };
    const voice = { root: 0, type: 'major', octaves: 2, baseOctave: 3, sound: 'sine' } as const;
    const { recorder } = await runHeadless(g, registry, {
      ticks: take.length,
      nominalDt: 1 / 30,
      resources: {
        controls: () => ({ right: voice, left: voice, airFlute: { ...DEFAULT_AIR_FLUTE, enabled: true, breath: 'always', mirrorHandedness: false }, airFluteFingerModel: model }),
      },
      recordOnly: ['merge.params'],
    });
    const last = (recorder.values('merge.params') as SynthParams[]).at(-1)!;
    const flute = last.voices.find((x) => x.id === FLUTE_VOICE_ID);
    expect(flute).toMatchObject({ present: true, sound: 'flute', freq: expect.closeTo(midiToFreq(74), 6) });
  });
});
