/**
 * Voice leading (H3 of #613): the `voiceLed` voicer, the `smooth` bass and the `diatonicSeventh`
 * coloration, alone and through the realization pipeline.
 *
 * What a player should hear: within a held chord nothing moves; from one chord to the next the
 * common tones stay and the others move by the nearest step, never more in total than the open
 * (spread) idiom would move from the same chord; the bass is where the idioms put it, or the
 * nearest chord tone with the smooth bass; a seventh survives the voicing.
 */
import { describe, it, expect } from 'vitest';
import { diatonicSeventh, motion, parallels, smoothBass, voiceLead, upperPitchClasses } from '@thoremin/sdk/harmony/voice_leading';
import { DEFAULT_CONTROLS, DEFAULT_SPEC, createRealizer, tonesInRegister, type RealizeInput } from '@thoremin/sdk/harmony/realize';
import { createChordRenderer } from '@thoremin/sdk/music/chord_render';
import { diatonicTriad, freqToMidi, scalePitchClasses, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { voiceTriad } from '@thoremin/sdk/music/voicing';

const C_MAJOR: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const triad = (d: number) => tonesInRegister(diatonicTriad(C_MAJOR, d));
const NONE = { last: [] as number[], bass: null };
const pcs = (notes: readonly number[]) => notes.map((n) => ((n % 12) + 12) % 12);

/** Voice a progression of degrees, each from the previous voicing (the pipeline's memory rule). */
function lead(degrees: number[], bassRule: 'root' | 'smooth' = 'root'): number[][] {
  const out: number[][] = [];
  let memory = NONE as { last: readonly number[]; bass: number | null };
  for (const d of degrees) {
    const tones = triad(d);
    const bass = bassRule === 'smooth' ? smoothBass.bass(tones, memory) : 0;
    const v = voiceLead(tones, bass, 0, memory);
    out.push(v);
    memory = { last: v, bass: v[0] };
  }
  return out;
}

describe('the voice-led voicer', () => {
  it('puts the bass where the idioms do and the chord above it', () => {
    const [c] = lead([0]);
    expect(c[0]).toBe(voiceTriad(diatonicTriad(C_MAJOR, 0), 'spread')[0]); // C2
    expect(new Set(pcs(c.slice(1)))).toEqual(new Set([0, 4, 7]));
    expect(c).toEqual([...c].sort((a, b) => a - b));
  });

  it('holds the common tones from chord to chord: C to Am keeps C and E, C to Em keeps E and G', () => {
    const [c, am] = lead([0, 5]);
    const kept = c.slice(1).filter((n) => am.slice(1).includes(n));
    expect(pcs(kept).sort()).toEqual([0, 4]);
    const [c2, em] = lead([0, 2]);
    expect(pcs(c2.slice(1).filter((n) => em.slice(1).includes(n))).sort()).toEqual([4, 7]);
  });

  it('walks C F G C (the chord map\'s cadence) by the least motion, never in parallel fifths or octaves', () => {
    const v = lead([0, 3, 4, 0]);
    for (let i = 1; i < v.length; i++) {
      const total = motion(v[i - 1].slice(1), v[i].slice(1));
      expect(total, `chord ${i}`).toBeLessThanOrEqual(6); // F to G shares no tone: 6 is the least
      expect(parallels(v[i - 1], v[i]), `chord ${i}`).toBe(0);
      v[i].slice(1).forEach((n, k) => expect(Math.abs(n - v[i - 1][k + 1]), `chord ${i}, voice ${k}`).toBeLessThanOrEqual(3));
    }
  });

  it('never moves the upper voices more than the spread idiom would, from the same chord, over every pair of degrees', () => {
    for (let a = 0; a < 7; a++) {
      const from = voiceLead(triad(a), 0, 0, NONE);
      for (let b = 0; b < 7; b++) {
        const led = voiceLead(triad(b), 0, 0, { last: from, bass: from[0] }).slice(1);
        const spread = voiceTriad(diatonicTriad(C_MAJOR, b), 'spread').slice(1).sort((x, y) => x - y);
        expect(motion(from.slice(1), led), `${a} -> ${b}`).toBeLessThanOrEqual(motion(from.slice(1), spread));
      }
    }
  });

  it('honours the bass index and any number of tones: G/B, a seventh, two tones', () => {
    const g = triad(4);
    const gb = voiceLead(g, 1, 0, NONE);
    expect(pcs([gb[0]])).toEqual([11]); // B in the bass
    const g7 = diatonicSeventh.color(g, DEFAULT_CONTROLS, { scale: [...scalePitchClasses(0, 'major')] });
    const v7 = voiceLead(g7, 0, 0, NONE);
    expect(new Set(pcs(v7))).toEqual(new Set([7, 11, 2, 5])); // the seventh (F) survives
    expect(v7).toHaveLength(4);
    const two = voiceLead(tonesInRegister([48, 55]), 0, 0, NONE);
    expect(two.length).toBeGreaterThanOrEqual(2);
    expect(voiceLead([], 0, 0, NONE)).toEqual([]);
  });

  it('keeps at most three upper voices, dropping the bass\'s doubling first, then the fifth', () => {
    const cmaj7 = tonesInRegister([48, 52, 55, 59]);
    expect(upperPitchClasses(cmaj7, 0)).toEqual([4, 7, 11]);
    expect(upperPitchClasses(cmaj7, 4)).toEqual([0, 7, 11]); // E in the bass: the E above goes
    const g9 = tonesInRegister([55, 59, 62, 65, 69]); // G B D F A: drop the bass's G, then the fifth
    expect(upperPitchClasses(g9, 7)).toEqual([11, 5, 9]);
  });

  it('shifts with the register', () => {
    const low = voiceLead(triad(0), 0, 0, NONE);
    const high = voiceLead(triad(0), 0, 1, NONE);
    expect(high).toEqual(low.map((n) => n + 12));
  });
});

describe('the smooth bass', () => {
  it('walks to the nearest chord tone: C to G puts B in the bass, and back to C', () => {
    const v = lead([0, 4, 0], 'smooth');
    expect(pcs(v.map((x) => x[0]))).toEqual([0, 11, 0]);
  });

  it('is the root with nothing to lead from', () => {
    expect(smoothBass.bass(triad(4), NONE)).toBe(0);
  });
});

describe('the diatonic seventh', () => {
  it('adds the key\'s own seventh to every chord of C major', () => {
    const scale = [...scalePitchClasses(0, 'major')];
    const sevenths = [0, 1, 2, 3, 4, 5, 6].map((d) => diatonicSeventh.color(triad(d), DEFAULT_CONTROLS, { scale }).at(-1)!);
    expect(sevenths.map((t) => [((t.midi % 12) + 12) % 12, t.role])).toEqual([
      [11, '7'],
      [0, 'b7'],
      [2, 'b7'],
      [4, '7'],
      [5, 'b7'],
      [7, 'b7'],
      [9, 'b7'],
    ]);
  });

  it('leaves the chord alone with no key, or when it already has a seventh', () => {
    expect(diatonicSeventh.color(triad(0), DEFAULT_CONTROLS)).toEqual(triad(0));
    const g7 = tonesInRegister([55, 59, 62, 65]);
    expect(diatonicSeventh.color(g7, DEFAULT_CONTROLS, { scale: [0, 2, 4, 5, 7, 9, 11] })).toEqual(g7);
  });
});

describe('through the pipeline', () => {
  const input = (d: number, over: Partial<RealizeInput> = {}): RealizeInput => ({
    tones: triad(d),
    context: { scale: [...scalePitchClasses(0, 'major')] },
    spec: { ...DEFAULT_SPEC, voicing: 'voiceLed' },
    controls: DEFAULT_CONTROLS,
    bpm: 100,
    gain: 0.3,
    sound: 'sine',
    silentSound: 'sine',
    dt: 1 / 30,
    ...over,
  });

  it('voices a held chord the same way every tick, and leads the next from it', () => {
    const r = createRealizer({ idBase: 0, maxVoices: 4 });
    const a = r.render(input(0)).voiced;
    expect(r.render(input(0)).voiced).toEqual(a);
    expect(r.render(input(0)).voiced).toEqual(a);
    const b = r.render(input(5)).voiced;
    expect(b).toEqual(voiceLead(triad(5), 0, 0, { last: a, bass: a[0] }));
  });

  it('plays sevenths with the coloration and inversions with the smooth bass', () => {
    const r = createRealizer({ idBase: 0, maxVoices: 4 });
    const spec = { ...DEFAULT_SPEC, voicing: 'voiceLed', coloration: 'diatonicSeventh', bass: 'smooth' };
    r.render(input(0, { spec }));
    const g7 = r.render(input(4, { spec })).voiced;
    expect(new Set(pcs(g7))).toEqual(new Set([7, 11, 2, 5]));
    expect(pcs([g7[0]])).toEqual([11]); // smooth from C: B
  });

  it('is what the chord renderer plays for the voiceLed voicing', () => {
    const r = createChordRenderer({ idBase: 0, maxVoices: 4 });
    const at = (d: number) => r.render({ degree: d, spec: C_MAJOR, voicing: 'voiceLed', rendering: 'sustained', bpm: 100, octaveShift: 0, gain: 0.3, sound: 'sine', silentSound: 'sine', dt: 1 / 30 });
    const c = at(0).voices.filter((v) => v.present).map((v) => Math.round(freqToMidi(v.freq)));
    const am = at(5).voices.filter((v) => v.present).map((v) => Math.round(freqToMidi(v.freq)));
    expect(pcs(c.slice(1).filter((n) => am.includes(n))).sort()).toEqual([0, 4]);
  });
});
