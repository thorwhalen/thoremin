/**
 * Tests the music-logic layer: `chord` (chord symbol → voiced synth params) and
 * `progression` (Roman numerals in a key + position → chord symbol), plus the
 * full gesture→harmony chain wired as a DAG:
 *   synthetic-hands → hand-features → (x→position) → progression → chord
 */
import { describe, it, expect } from 'vitest';
import { replayNode, runHeadless, type GraphSpec } from '@/dag';
import { chordNode, progressionNode, voiceChord, createCoreRegistry } from '@/nodes';
import { freqToMidi } from '@/music/theory';
import type { SynthParams } from '@/nodes';

describe('chord node', () => {
  it('voices a chord ascending into MIDI', () => {
    expect(voiceChord('Cmaj7', 4, 4)).toEqual([60, 64, 67, 71]); // C4 E4 G4 B4
    // Am7 = A C E G; C wraps up an octave to stay ascending.
    expect(voiceChord('Am7', 4, 4)).toEqual([69, 72, 76, 79]); // A4 C5 E5 G5
  });

  it('emits a synth voice per chord tone at the right pitch', async () => {
    const [out] = await replayNode(chordNode.make(chordNode.params.parse({ baseOctave: 4, maxVoices: 4 })), {
      chord: ['Cmaj7'],
      gain: [0.3],
    });
    const sp = out.params as SynthParams;
    expect(sp.voices).toHaveLength(4);
    expect(sp.voices.every((v) => v.present && v.gain === 0.3)).toBe(true);
    const midis = sp.voices.map((v) => Math.round(freqToMidi(v.freq)));
    expect(midis).toEqual([60, 64, 67, 71]);
  });

  it('an unparseable chord yields no voices (silent)', async () => {
    const [out] = await replayNode(chordNode.make(chordNode.params.parse({})), { chord: ['nonsense'] });
    expect((out.params as SynthParams).voices).toHaveLength(0);
  });
});

describe('progression node', () => {
  it('maps position 0..1 across the diatonic chords of a key', async () => {
    const handlers = progressionNode.make(progressionNode.params.parse({ key: 'C', romanNumerals: ['I', 'IV', 'V', 'vi'] }));
    const outs = await replayNode(handlers, { position: [0, 0.3, 0.6, 0.99] });
    expect(outs.map((o) => o.chord)).toEqual(['C', 'F', 'G', 'Am']);
    expect(outs.map((o) => o.index)).toEqual([0, 1, 2, 3]);
  });

  it('validates the key — rejects non-major / invalid keys at parse', () => {
    expect(() => progressionNode.params.parse({ key: 'Eb' })).not.toThrow();
    for (const bad of ['H', 'Dm', '', 'nonsense']) {
      expect(() => progressionNode.params.parse({ key: bad })).toThrow();
    }
  });
});

describe('gesture → harmony chain (DAG)', () => {
  it('hand x sweep (via pick) walks the progression so the chord changes', async () => {
    const spec: GraphSpec = {
      nodes: [
        { id: 'src', type: 'synthetic-hands', params: { hands: 'right', sweepPeriod: 4 } },
        { id: 'feat', type: 'hand-features', params: { mirrorX: false, mirrorHandedness: false } },
        { id: 'x', type: 'pick', params: { path: 'right.x' } }, // scalar adapter: features → position
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
    expect(new Set(chords).size).toBeGreaterThan(1); // the sweep actually changes chords
    expect(chords.every((c) => ['C', 'F', 'G', 'Am'].includes(c))).toBe(true); // stays in-key
    const params = recorder.values('chord.params') as SynthParams[];
    expect(params.every((p) => p.voices.length >= 3)).toBe(true); // each chord is voiced
  });

  it('driving progression position directly walks chords → distinct chord note sets', async () => {
    const prog = progressionNode.make(progressionNode.params.parse({ key: 'C', romanNumerals: ['I', 'IV', 'V', 'vi'] }));
    const chordH = chordNode.make(chordNode.params.parse({ baseOctave: 4 }));
    const positions = [0.0, 0.3, 0.6, 0.95];
    const symbols = (await replayNode(prog, { position: positions })).map((o) => o.chord as string);
    const noteSets = (await replayNode(chordH, { chord: symbols })).map((o) =>
      (o.params as SynthParams).voices.map((v) => Math.round(freqToMidi(v.freq))),
    );
    expect(symbols).toEqual(['C', 'F', 'G', 'Am']);
    // Each chord produces a distinct, non-empty note set.
    expect(noteSets.every((s) => s.length >= 3)).toBe(true);
    expect(new Set(noteSets.map((s) => s.join(','))).size).toBe(4);
  });
});
