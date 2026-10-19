/**
 * Harmonic spaces and distances (H4 of #613, `docs/design/harmonic-layers.md` §2.2, §7's
 * property tests): the relations do what music theory says (P, L, R are involutions that keep two
 * common tones; N, S, H are the compositions they name; a diatonic step and its inverse cancel);
 * the spaces built from them are the ones the design names (the key's seven chords for the
 * video's map, the 24 triads for the Tonnetz); every edge satisfies its relation; the distances
 * are Tymoczko's (C to f moves less than C to F although it is further on the lattice).
 */
import { describe, it, expect } from 'vitest';
import {
  CHROMATIC_MEDIANTS,
  DIATONIC_STEPS,
  DOMINANT_OF,
  NEO_RIEMANNIAN,
  RELATIONS,
  annotated,
  diatonicSpace,
  restrict,
  tonnetzSpace,
  union,
  generated,
  type Relation,
} from '@thoremin/sdk/harmony/space';
import { commonTones, voiceLeadingCost } from '@thoremin/sdk/harmony/distance';
import { chordId, diatonicChords, parseChordId, type Chord, type Key } from '@thoremin/sdk/harmony/chord';

const C: Key = { tonic: 0, scale: 'major' };
const ch = (id: string) => parseChordId(id)!;
const rel = (id: string) => RELATIONS.get(id)!;
const go = (r: Relation, c: Chord, key: Key = C) => r.apply(c, key).map(chordId);
const TRIADS: Chord[] = Array.from({ length: 24 }, (_, i) => ({ root: i % 12, quality: i < 12 ? ('maj' as const) : ('min' as const) }));

describe('the neo-Riemannian relations', () => {
  it('P, L and R take C where the theory says, and back', () => {
    expect(go(rel('P'), ch('C:maj'))).toEqual(['C:min']);
    expect(go(rel('L'), ch('C:maj'))).toEqual(['E:min']);
    expect(go(rel('R'), ch('C:maj'))).toEqual(['A:min']);
    expect(go(rel('L'), ch('E:min'))).toEqual(['C:maj']);
    expect(go(rel('R'), ch('A:min'))).toEqual(['C:maj']);
  });

  it('P, L and R are involutions that keep two common tones and move one voice by a step, on all 24 triads', () => {
    for (const id of ['P', 'L', 'R']) {
      for (const c of TRIADS) {
        const [to] = rel(id).apply(c, C);
        expect(rel(id).apply(to, C), `${id} ${chordId(c)}`).toEqual([c]);
        expect(commonTones(c, to), `${id} ${chordId(c)}`).toHaveLength(2);
        expect(voiceLeadingCost(c, to), `${id} ${chordId(c)}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('N, S and H are the compositions they name (RLP, LPR, LPL), on all 24 triads', () => {
    const compose = (ids: string[], c: Chord) => ids.reduce((x, id) => rel(id).apply(x, C)[0], c);
    for (const c of TRIADS) {
      expect(rel('N').apply(c, C)[0], `N ${chordId(c)}`).toEqual(compose(['R', 'L', 'P'], c));
      expect(rel('S').apply(c, C)[0], `S ${chordId(c)}`).toEqual(compose(['L', 'P', 'R'], c));
      expect(rel('H').apply(c, C)[0], `H ${chordId(c)}`).toEqual(compose(['L', 'P', 'L'], c));
    }
  });

  it('do not apply to a chord that is not a major or minor triad', () => {
    for (const r of [...NEO_RIEMANNIAN, ...CHROMATIC_MEDIANTS]) expect(r.apply(ch('B:dim'), C)).toEqual([]);
  });

  it('the chromatic mediants keep the mode and undo each other', () => {
    expect(go(rel('M+4'), ch('C:maj'))).toEqual(['E:maj']);
    expect(go(rel('M-3'), ch('A:min'))).toEqual(['F#:min']);
    for (const r of CHROMATIC_MEDIANTS) for (const c of TRIADS) expect(rel(r.inverse!).apply(r.apply(c, C)[0], C)).toEqual([c]);
  });
});

describe('the diatonic steps', () => {
  it('walk the key\'s chords: the video\'s fourths, thirds and seconds', () => {
    expect(go(rel('dia+3'), ch('C:maj'))).toEqual(['F:maj']);
    expect(go(rel('dia+2'), ch('C:maj'))).toEqual(['E:min']);
    expect(go(rel('dia-1'), ch('C:maj'))).toEqual(['B:dim']);
    expect(go(rel('dia+3'), ch('B:dim'))).toEqual(['E:min']);
    expect(go(rel('dia+1'), ch('C#:maj'))).toEqual([]); // not a chord of the key
  });

  it('cancel with their inverse from every chord of the key', () => {
    for (const r of DIATONIC_STEPS) for (const c of diatonicChords(C)) expect(rel(r.inverse!).apply(r.apply(c, C)[0], C)).toEqual([c]);
  });

  it('keep the common tones the video counts: two for a third, one for a fourth, none for a second', () => {
    const c = ch('C:maj');
    expect(commonTones(c, rel('dia+2').apply(c, C)[0])).toHaveLength(2);
    expect(commonTones(c, rel('dia+3').apply(c, C)[0])).toHaveLength(1);
    expect(commonTones(c, rel('dia+1').apply(c, C)[0])).toHaveLength(0);
  });

  it('the dominant of a chord is the major triad a fifth up', () => {
    expect(go(DOMINANT_OF, ch('G:maj'))).toEqual(['D:maj']);
    expect(go(DOMINANT_OF, ch('A:min'))).toEqual(['E:maj']);
  });
});

describe('spaces', () => {
  it('the diatonic space is the key\'s seven chords, each one\'s six neighbours the other six', () => {
    const s = diatonicSpace();
    expect(s.chords(C).map(chordId)).toEqual(diatonicChords(C).map(chordId));
    for (const c of s.chords(C)) {
      const to = s.neighbours(c, C).map((e) => chordId(e.to));
      expect(new Set(to).size).toBe(6);
      expect(to).not.toContain(chordId(c));
    }
  });

  it('the Tonnetz space is the 24 major and minor triads, reached from the tonic by P, L, R', () => {
    const s = tonnetzSpace();
    expect(s.chords(C)).toHaveLength(24);
    expect(new Set(s.chords(C).map(chordId))).toEqual(new Set(TRIADS.map(chordId)));
    expect(s.neighbours(ch('C:maj'), C).map((e) => [e.relation, chordId(e.to)])).toEqual([
      ['P', 'C:min'],
      ['L', 'E:min'],
      ['R', 'A:min'],
    ]);
  });

  it('every edge of every space satisfies its relation', () => {
    for (const s of [diatonicSpace(), tonnetzSpace(), generated([...NEO_RIEMANNIAN, ...CHROMATIC_MEDIANTS], { id: 'wide', seeds: (k) => [diatonicChords(k)[0]] })]) {
      for (const from of s.chords(C)) for (const e of s.neighbours(from, C)) expect(RELATIONS.get(e.relation)!.apply(from, C).map(chordId)).toContain(chordId(e.to));
    }
  });

  it('combines: a union, a restriction, captions', () => {
    const withDominants = union(diatonicSpace(), generated([DOMINANT_OF], { id: 'dom', seeds: (k) => diatonicChords(k) }));
    expect(withDominants.chords(C).map(chordId)).toEqual(expect.arrayContaining(['D:maj', 'E:maj', 'A:maj']));
    const majors = restrict(tonnetzSpace(), (c) => c.quality === 'maj');
    expect(majors.chords(C)).toHaveLength(12);
    expect(majors.neighbours(ch('C:maj'), C)).toEqual([]); // P, L, R all flip the mode
    const captioned = annotated(diatonicSpace(), (e) => (e.relation === 'dia+3' ? 'Exploration' : undefined));
    const caps = captioned.neighbours(ch('C:maj'), C).map((e) => e.caption);
    expect(caps).toEqual(['Exploration', '4th down', '3rd up', '3rd down', '2nd up', '2nd down']);
  });
});

describe('distances', () => {
  it('voice-leading cost is not lattice distance: C to f moves less than C to F', () => {
    expect(voiceLeadingCost(ch('C:maj'), ch('F:min'))).toBe(2); // E-F, G-Ab: two steps away on the lattice
    expect(voiceLeadingCost(ch('C:maj'), ch('F:maj'))).toBe(3); // E-F, G-A: one step away
    expect(voiceLeadingCost(ch('C:maj'), ch('C:min'))).toBe(1);
    expect(voiceLeadingCost(ch('C:maj'), ch('C:maj'))).toBe(0);
  });

  it('handles chords of different sizes by doubling (G to G7: a doubled G steps down to F)', () => {
    expect(voiceLeadingCost(ch('G:maj'), ch('G:7'))).toBe(2);
    expect(voiceLeadingCost(ch('G:7'), ch('C:maj'))).toBe(voiceLeadingCost(ch('C:maj'), ch('G:7')));
  });
});
