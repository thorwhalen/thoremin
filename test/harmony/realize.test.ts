/**
 * The realization pipeline's seams (H2 of #613, `docs/design/harmonic-layers.md` §2.6): each of
 * coloration, reduction, bass, voicing and figuration is a named strategy in a registry, and a
 * strategy added to a registry changes exactly its own step. The defaults are today's sound (the
 * golden test next to this one); here, made-up strategies prove each seam is real: a coloration
 * that adds the seventh, a reduction that drops the fifth, a bass rule a voicer honours, a voicer
 * that sees its memory, an event figuration. Unknown ids fall back to the seam's default.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONTROLS,
  DEFAULT_SPEC,
  createRealizationRegistry,
  createRealizer,
  tonesInRegister,
  type RealizeInput,
  type VoicingMemory,
} from '@thoremin/sdk/harmony/realize';
import { freqToMidi } from '@thoremin/sdk/music/theory';
import { RENDERINGS, VOICINGS } from '@thoremin/sdk/music/voicing';

const C = [48, 52, 55]; // C3 E3 G3
const G = [55, 59, 62];
const input = (notes: number[], over: Partial<RealizeInput> = {}): RealizeInput => ({
  tones: tonesInRegister(notes),
  spec: DEFAULT_SPEC,
  controls: DEFAULT_CONTROLS,
  bpm: 120,
  gain: 0.5,
  sound: 'sine',
  silentSound: 'sine',
  dt: 1 / 30,
  ...over,
});
const midis = (r: { voices: { present: boolean; freq: number }[] }) => r.voices.filter((v) => v.present).map((v) => Math.round(freqToMidi(v.freq)));

describe('the realization pipeline', () => {
  it('ships today\'s strategies: five voicings, seven figurations, no coloration or reduction, the root in the bass', () => {
    const reg = createRealizationRegistry();
    expect([...reg.voicing.keys()]).toEqual([...VOICINGS]);
    expect([...reg.figuration.keys()]).toEqual([...RENDERINGS]);
    expect([...reg.coloration.keys()]).toEqual(['asIs']);
    expect([...reg.reduction.keys()]).toEqual(['none']);
    expect([...reg.bass.keys()]).toEqual(['root']);
  });

  it('reads tone roles from the intervals', () => {
    expect(tonesInRegister([48, 51, 55]).map((t) => t.role)).toEqual(['1', 'b3', '5']);
    expect(tonesInRegister([55, 59, 62, 65]).map((t) => t.role)).toEqual(['1', '3', '5', 'b7']);
    expect(tonesInRegister([60, 64, 69]).map((t) => t.role)).toEqual(['1', '3', '5']); // non-tertian: by position
    expect(tonesInRegister([])).toEqual([]);
  });

  it('lets each seam be swapped by id, each changing only its own step', () => {
    const reg = createRealizationRegistry();
    reg.coloration.set('seventh', { id: 'seventh', color: (t) => [...t, { midi: t[0].midi + 10, role: 'b7' }] });
    reg.reduction.set('noFifth', { id: 'noFifth', reduce: (t) => t.filter((x) => x.role !== '5') });
    reg.bass.set('third', { id: 'third', bass: (t) => t.findIndex((x) => x.role === '3' || x.role === 'b3') });
    reg.voicing.set('stack', { id: 'stack', voice: (t, bass) => [t[bass].midi - 12, ...t.filter((_, i) => i !== bass).map((x) => x.midi)] });
    const r = createRealizer({ idBase: 0, maxVoices: 6, registry: reg });
    const out = r.render(input(C, { spec: { ...DEFAULT_SPEC, coloration: 'seventh', reduction: 'noFifth', bass: 'third', voicing: 'stack' } }));
    expect(out.voiced).toEqual([40, 48, 58]); // E2 bass, C3, Bb3: the seventh added, the fifth dropped
    expect(midis(out)).toEqual([40, 48, 58]);
    expect(out.voices).toHaveLength(6); // always maxVoices, on stable ids
    expect(out.voices.map((v) => v.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('gives a voicer its memory: the last voicing and bass, updated only when the chord changes', () => {
    const reg = createRealizationRegistry();
    const seen: VoicingMemory[] = [];
    reg.voicing.set('spy', { id: 'spy', voice: (t, _b, _c, m) => (seen.push(m), t.map((x) => x.midi)) });
    const r = createRealizer({ idBase: 0, maxVoices: 4, registry: reg });
    const spec = { ...DEFAULT_SPEC, voicing: 'spy' };
    r.render(input(C, { spec }));
    r.render(input(C, { spec }));
    r.render(input(G, { spec }));
    expect(seen[0]).toEqual({ last: [], bass: null });
    expect(seen[1]).toEqual({ last: C, bass: 48 });
    expect(seen[2]).toEqual({ last: C, bass: 48 }); // G is voiced FROM C
  });

  it('passes an event figuration\'s notes through, with the clock it saw', () => {
    const reg = createRealizationRegistry();
    reg.figuration.set('ping', { id: 'ping', render: (n, clock) => ({ gains: new Array(n).fill(1), events: clock.sinceChange === 0 ? [{ t: 0, midi: 60, velocity: 1 }] : [] }) });
    const r = createRealizer({ idBase: 0, maxVoices: 4, registry: reg });
    const spec = { ...DEFAULT_SPEC, figuration: 'ping' };
    expect(r.render(input(C, { spec })).events).toHaveLength(1); // a new chord
    expect(r.render(input(C, { spec })).events).toHaveLength(0); // held
    expect(r.render(input(G, { spec })).events).toHaveLength(1); // changed
  });

  it('falls back to the seam\'s default for an unknown id (a value stored by a newer build)', () => {
    const r1 = createRealizer({ idBase: 0, maxVoices: 4 });
    const r2 = createRealizer({ idBase: 0, maxVoices: 4 });
    const known = r1.render(input(C));
    const unknown = r2.render(input(C, { spec: { coloration: '?', reduction: '?', bass: '?', voicing: '?', figuration: '?' } }));
    expect(unknown).toEqual(known);
  });

  it('is silent on no tones, on its own ids, with the silent sound', () => {
    const r = createRealizer({ idBase: 7, maxVoices: 3 });
    const out = r.render(input([], { silentSound: 'triangle' }));
    expect(out.voiced).toEqual([]);
    expect(out.voices.map((v) => [v.id, v.present, v.sound])).toEqual([
      [7, false, 'triangle'],
      [8, false, 'triangle'],
      [9, false, 'triangle'],
    ]);
  });
});
