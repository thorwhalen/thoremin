/**
 * Computed move captions (#714): a caption made of measurable facts (common tones, the change of
 * colour, Piston's expectedness, the tension direction, Lerdahl's distance), each model named.
 * Properties over every key and every pair of major, minor and diminished triads.
 */
import { describe, it, expect } from 'vitest';
import { chordName, diatonicChords, type Chord, type Key } from '@thoremin/sdk/harmony/chord';
import { annotated, diatonicSpace } from '@thoremin/sdk/harmony/space';
import {
  CAPTION_PARTS,
  INTERVAL_CAPTIONS,
  captionSet,
  captionText,
  colourOf,
  computedCaptions,
  expectedness,
  lerdahlDistance,
  moveFacts,
  qualityChange,
  tensionDirection,
  toneMotion,
} from '@thoremin/sdk/harmony/captions';

const C: Key = { tonic: 0, scale: 'major' };
const Am: Key = { tonic: 9, scale: 'minor' };
const ch = (root: number, quality: Chord['quality']): Chord => ({ root, quality });
const KEYS: Key[] = Array.from({ length: 12 }, (_, t) => [{ tonic: t, scale: 'major' as const }, { tonic: t, scale: 'minor' as const }]).flat();
const TRIADS: Chord[] = Array.from({ length: 12 }, (_, r) => (['maj', 'min', 'dim'] as const).map((q) => ch(r, q))).flat();
const up = (c: Chord, n: number): Chord => ({ ...c, root: (c.root + n) % 12 });

describe('the facts of a move', () => {
  it('captions C to Em "smooth, darker" (the issue)', () => {
    const set = computedCaptions({ parts: ['tones', 'quality'] });
    expect(set.caption({ from: ch(0, 'maj'), to: ch(4, 'min') }, undefined, C)).toBe('smooth, darker');
  });

  it('reads the colour by the third and the fifth', () => {
    expect(colourOf('maj')).toBe('major');
    expect(colourOf('7')).toBe('major');
    expect(colourOf('min7')).toBe('minor');
    expect(colourOf('dim')).toBe('diminished');
    expect(colourOf('hdim7')).toBe('diminished');
    expect(colourOf('aug')).toBe('augmented');
    expect(colourOf('sus4')).toBe('suspended');
    expect(colourOf('5')).toBe('open5');
  });

  it('names the change of colour', () => {
    expect(qualityChange(ch(0, 'maj'), ch(9, 'min'))).toBe('darker');
    expect(qualityChange(ch(9, 'min'), ch(5, 'maj'))).toBe('brighter');
    expect(qualityChange(ch(0, 'maj'), ch(11, 'dim'))).toBe('to diminished');
    expect(qualityChange(ch(11, 'dim'), ch(0, 'maj'))).toBe('brighter');
    expect(qualityChange(ch(0, 'maj'), ch(0, 'aug'))).toBe('to augmented');
    expect(qualityChange(ch(0, 'maj'), ch(7, 'maj'))).toBeNull();
  });

  it('counts the common tones', () => {
    expect(toneMotion(ch(0, 'maj'), ch(9, 'min'))).toBe('smooth'); // C-Am: C, E
    expect(toneMotion(ch(0, 'maj'), ch(7, 'maj'))).toBe('one held'); // C-G: G
    expect(toneMotion(ch(0, 'maj'), ch(2, 'min'))).toBe('open'); // C-Dm
  });

  it("reads Piston's table for expectedness, diatonic moves only", () => {
    const [I, ii, iii, IV, V, vi] = diatonicChords(C);
    expect(expectedness(V, I, C)).toBe('expected');
    expect(expectedness(V, vi, C)).toBe('plausible');
    expect(expectedness(I, iii, C)).toBe('surprising');
    expect(expectedness(I, ch(10, 'maj'), C)).toBeNull(); // bVII is not the key's
    expect(expectedness(IV, IV, C)).toBeNull();
    expect(expectedness(ii, V, C)).toBe('expected');
  });

  it('reads the tension direction by the functional ladder', () => {
    const [I, , , IV, V] = diatonicChords(C);
    expect(tensionDirection(V, I, C)).toBe('resolving');
    expect(tensionDirection(I, IV, C)).toBe('opening');
    expect(tensionDirection(I, ch(10, 'maj'), C)).toBeNull();
  });

  it("gives Lerdahl's distance from the tonic as tension's tps model does", () => {
    const [I, , , IV, V, vi] = diatonicChords(C);
    expect(lerdahlDistance(I, IV, C)).toBe(5);
    expect(lerdahlDistance(I, V, C)).toBe(5);
    expect(lerdahlDistance(I, vi, C)).toBe(7);
  });
});

describe('properties over every key and triad pair', () => {
  it('is invariant under transposition of the key and both chords', () => {
    const set = computedCaptions({ parts: CAPTION_PARTS });
    for (const t of [5]) {
      for (const key of [C, Am]) {
        for (const a of TRIADS) {
          for (const b of TRIADS) {
            const k2 = { ...key, tonic: (key.tonic + t) % 12 };
            expect(set.caption({ from: up(a, t), to: up(b, t) }, undefined, k2)).toBe(set.caption({ from: a, to: b }, undefined, key));
          }
        }
      }
    }
  });

  it('reverses the colour and keeps the tones when the move is reversed', () => {
    const inverse: Record<string, string | null> = { darker: 'brighter', brighter: 'darker' };
    for (const a of TRIADS) {
      for (const b of TRIADS) {
        expect(toneMotion(a, b)).toBe(toneMotion(b, a));
        const q = qualityChange(a, b);
        if ((q === 'darker' || q === 'brighter') && a.quality !== 'dim' && b.quality !== 'dim') expect(qualityChange(b, a)).toBe(inverse[q]);
      }
    }
  });

  it('captions every move between different chords, and none to the same chord', () => {
    const set = computedCaptions();
    for (const key of [C, Am, { tonic: 6, scale: 'major' as const }, { tonic: 2, scale: 'minorHarmonic' as const }]) {
      for (const a of TRIADS) {
        expect(set.caption({ from: a, to: a }, undefined, key)).toBeUndefined();
        for (const b of TRIADS) {
          if (a === b) continue;
          const text = set.caption({ from: a, to: b }, undefined, key)!;
          expect(text.length).toBeGreaterThan(0);
          expect(text.split(', ')[0]).toMatch(/^(smooth|one held|open)$/);
        }
      }
    }
  });

  it('shows a part only when asked, and in the order asked', () => {
    const f = moveFacts(ch(7, 'maj'), ch(0, 'maj'), C);
    expect(captionText(f, ['tones'])).toBe('one held');
    expect(captionText(f, ['direction', 'tones'])).toBe('resolving, one held');
    expect(captionText(f, ['distance'])).toBe('δ 5');
    expect(captionText(f, ['tones', 'quality', 'expectedness'])).toBe('one held, expected');
  });
});

describe('caption sets', () => {
  it('names the model of every part that has one', () => {
    expect(computedCaptions().models).toEqual(["Piston's usual root progressions"]);
    expect(computedCaptions({ parts: ['tones', 'quality'] }).models).toEqual([]);
    expect(computedCaptions({ parts: CAPTION_PARTS }).models).toHaveLength(3);
    expect(INTERVAL_CAPTIONS.models).toEqual([]);
  });

  it('captions an annotated space with the computed set, the interval set its labels', () => {
    const space = diatonicSpace();
    const computed = annotated(space, computedCaptions().caption);
    const intervals = annotated(space, INTERVAL_CAPTIONS.caption);
    for (const key of KEYS) {
      for (const from of space.chords(key)) {
        const edges = computed.neighbours(from, key);
        const labels = intervals.neighbours(from, key);
        edges.forEach((e, i) => {
          expect(e.caption).toBe(computedCaptions().caption(e, undefined, key));
          expect(labels[i].caption).toBe(space.relations.find((r) => r.id === labels[i].relation)!.label);
        });
      }
    }
  });

  it('the diatonic map in C, around the tonic', () => {
    const space = annotated(diatonicSpace(), captionSet('computed').caption);
    const out = space.neighbours(diatonicChords(C)[0], C).map((e) => `${chordName(e.to, C)}: ${e.caption}`);
    expect(out).toEqual(['F: one held, expected', 'G: one held, expected', 'Em: smooth, darker, surprising', 'Am: smooth, darker', 'Dm: open, darker, surprising', 'B°: open, to diminished, surprising']);
  });
});
