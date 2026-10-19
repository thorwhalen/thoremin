/**
 * The shared target player (H6 of #613): what a category's target plays, for the face chord and
 * the personal categorizers alike. A degree sets the chord in force; a move is made once when its
 * category begins and held after; a function picks the nearest chord with it; the seventh colours
 * the chord in force while held; a five-note source and a move outside the key play the degree.
 */
import { describe, it, expect } from 'vitest';
import { createTargetPlayer, functionDegree, movedDegree } from '@thoremin/sdk/harmony/target_play';
import { TARGET_CHOICES, categoryTarget, targetChoice } from '@thoremin/sdk/harmony/target';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';

const C: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };

describe('the target player', () => {
  it('sets the chord with a degree, moves once per entry, holds the move', () => {
    const p = createTargetPlayer();
    const step = (category: string | null, target: string | undefined, degree: number) => p.step({ category, target, degree, spec: C });
    expect(step('a', '', 5).degree).toBe(5); // Am, as a degree
    expect(step('b', 'move:dia+3', 0).degree).toBe(1); // Am a fourth up: Dm
    expect(step('b', 'move:dia+3', 0).degree).toBe(1); // held: no walking on
    expect(step(null, undefined, -1).degree).toBe(-1); // released: silence
    expect(step('b', 'move:dia+3', 0).degree).toBe(4); // re-entered from Dm: G
    expect(step('c', 'fn:T', 0).degree).toBe(0); // the nearest tonic to G is C
    expect(step('d', 'ctl:seventh', 2)).toEqual({ degree: 0, coloration: 'diatonicSeventh' });
  });

  it('starts a move from the tonic before anything played, and stays in the key', () => {
    expect(createTargetPlayer().step({ category: 'x', target: 'move:dia-3', degree: 3, spec: C }).degree).toBe(4); // I a fourth down: V
    expect(createTargetPlayer().step({ category: 'x', target: 'move:P', degree: 3, spec: C }).degree).toBe(3); // outside the key: its degree
    expect(movedDegree(C, 6, 'dia+3')).toBe(2);
    expect(functionDegree(C, 1, 'D')).toBe(6); // Dm to B° (two common tones) before Dm to G
  });

  it('does not count a short gap as a new entry, and a long one does', () => {
    const p = createTargetPlayer();
    const step = (category: string | null, now: number) => p.step({ category, target: category ? 'move:dia+3' : undefined, degree: category ? 0 : -1, spec: C, now }).degree;
    expect(step('b', 0)).toBe(3); // I a fourth up: IV
    expect(step(null, 1 / 30)).toBe(-1); // a dropped frame
    expect(step('b', 2 / 30)).toBe(3); // back within the gap: the same entry, no second move
    expect(step(null, 0.2)).toBe(-1);
    expect(step('b', 1)).toBe(6); // back after a release: moves again, IV to vii°
  });

  it('starts from the tonic again after a reset', () => {
    const p = createTargetPlayer();
    p.step({ category: 'a', target: '', degree: 5, spec: C });
    p.reset();
    expect(p.step({ category: 'b', target: 'move:dia+3', degree: 0, spec: C }).degree).toBe(3);
  });

  it('gives a category its own target, else none with a degree of its own, else its expression\'s', () => {
    const expressions = { happy: 'fn:D' };
    expect(categoryTarget('cat-1', 'happy', { own: { 'cat-1': 'ctl:seventh' }, degrees: { 'cat-1': 2 }, expressions })).toBe('ctl:seventh');
    expect(categoryTarget('cat-1', 'happy', { degrees: { 'cat-1': 2 }, expressions })).toBe('');
    expect(categoryTarget('cat-1', 'happy', { own: { 'cat-1': '' }, expressions })).toBe('fn:D');
  });

  it('plays degrees only on a five-note source', () => {
    const pent: ScaleSpec = { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3 };
    expect(createTargetPlayer().step({ category: 'x', target: 'move:dia+3', degree: 2, spec: pent })).toEqual({ degree: 2 });
  });

  it('offers one list of choices, and shows a move outside the key as the degree', () => {
    expect(TARGET_CHOICES.map((c) => c.value)).toEqual(['', 'move:dia+3', 'move:dia-3', 'move:dia+2', 'move:dia-2', 'move:dia+1', 'move:dia-1', 'fn:T', 'fn:S', 'fn:D', 'ctl:seventh']);
    expect(targetChoice('move:P')).toBe('');
    expect(targetChoice('fn:S')).toBe('fn:S');
  });
});
