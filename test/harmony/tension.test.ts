/**
 * Tension with its model named (H10 of #613): Lerdahl's tonal pitch space against his own
 * published distances, the Krumhansl-Kessler profile's ranking, the functional ladder, and the
 * point of naming the model: the three rank the same chords differently.
 */
import { describe, it, expect } from 'vitest';
import { TENSION_MODELS, tensionText, tpsDistance } from '@thoremin/sdk/harmony/tension';
import { chordName, diatonicChords, type Key } from '@thoremin/sdk/harmony/chord';

const C: Key = { tonic: 0, scale: 'major' };
const A_MINOR: Key = { tonic: 9, scale: 'minor' };
const by = (id: keyof typeof TENSION_MODELS, key: Key) => Object.fromEntries(diatonicChords(key).map((c) => [chordName(c, key), TENSION_MODELS[id].tension(c, key)]));

describe('tension models', () => {
  it("Lerdahl's distances from I: IV and V 5, vi and iii 7, ii and vii° 8 (Tonal Pitch Space, 2001)", () => {
    expect(by('tps', C)).toEqual({ C: 0, Dm: 8, Em: 7, F: 5, G: 5, Am: 7, 'B°': 8 });
    expect(by('tps', A_MINOR).Am).toBe(0); // a minor key's region is its relative major's set
    expect(tpsDistance({ root: 0, quality: 'maj' }, 0, { root: 0, quality: 'min' })).toBe(5); // C to Cm, by the nearest region (Bb)
  });

  it('the key profile: well-fitting chords are calm, and it hears the leading tone', () => {
    const t = by('profile', C);
    const order = Object.entries(t).sort((a, b) => a[1]! - b[1]!).map(([n]) => n);
    expect(order).toEqual(['C', 'Am', 'F', 'Em', 'G', 'Dm', 'B°']);
  });

  it('the functional ladder: I < vi, iii < IV, ii < V < vii°, and no opinion outside the key', () => {
    expect(by('function', C)).toEqual({ C: 0, Dm: 2, Em: 1, F: 2, G: 3, Am: 1, 'B°': 4 });
    expect(TENSION_MODELS.function.tension({ root: 8, quality: 'maj' }, C)).toBeNull();
    expect(tensionText(TENSION_MODELS.function, { root: 8, quality: 'maj' }, C)).toBe('');
  });

  it('harmonic minor: its own collection is the region (V is 5 from i), its leading-tone chord pulls like a dominant', () => {
    const am: Key = { tonic: 9, scale: 'minorHarmonic' };
    expect(by('tps', am)).toEqual({ Am: 0, 'B°': 8, 'C+': 7, Dm: 5, E: 5, F: 7, 'G#°': 8 });
    expect(by('function', am)['G#°']).toBe(4);
    expect(by('function', am).E).toBe(3);
  });

  it('the models disagree, which is why every display names one', () => {
    const rank = (id: keyof typeof TENSION_MODELS) => (by(id, C).G! > by(id, C).Dm! ? 'V' : by(id, C).G! < by(id, C).Dm! ? 'ii' : 'tie');
    expect([rank('function'), rank('tps'), rank('profile')]).toEqual(['V', 'ii', 'ii']);
    for (const m of Object.values(TENSION_MODELS)) expect(m.name.length).toBeGreaterThan(10);
  });
});
