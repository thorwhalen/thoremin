/**
 * "Rate this move" (#715): the player's ratings of chord moves, by scale degree, become their own
 * caption set. Pinned here: the means and the words, the ratings kept per move, the next move to
 * rate (the least rated first), the captions on a key's diatonic moves (any key of the mode, none
 * on a borrowed chord), the store round trip and its publication, and the chord map's words.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import {
  MAX_RATINGS_KEPT,
  moveKey,
  moveName,
  movesOf,
  nextMoveToRate,
  ratedCount,
  ratingMode,
  ratingsTable,
  ratingWords,
  withRating,
  type RatingsTable,
} from '@thoremin/sdk/harmony/ratings';
import { captionSet, CAPTION_SET_IDS, ratedCaptions } from '@thoremin/sdk/harmony/captions';
import { createMoveRatingsBook, type MoveRatingsRecord } from '@thoremin/ext-harmony/app/moveRatings';
import { triadNotes } from '@thoremin/ext-harmony/app/movePlayer';
import { createPathFollower } from '@thoremin/ext-harmony/lib/map_paths';
import { diatonicChords as mapChords } from '@thoremin/ext-harmony/lib/chord_map';
import { HARMONY } from '../helpers/extensions';

const C = { tonic: 0, scale: 'major' } as const;
const G = { tonic: 7, scale: 'major' } as const;
const Am = { tonic: 9, scale: 'minor' } as const;
const r = (valence: number, tension: number, at = 0) => ({ valence, tension, at });

describe('the ratings, pure', () => {
  it('a move keeps its last ratings and reads their mean as words', () => {
    let m = withRating(null, 'major', 0, 5, r(0.8, -0.6));
    m = withRating(m, 'major', 0, 5, r(0.4, -0.2));
    const t = ratingsTable([m]);
    expect(t[moveKey('major', 0, 5)]).toEqual({ valence: expect.closeTo(0.6), tension: expect.closeTo(-0.4), n: 2 });
    expect(ratingWords(t[moveKey('major', 0, 5)])).toBe('bright, settled');
    expect(ratingWords({ valence: 0.1, tension: -0.1, n: 1 })).toBe('even');
    expect(ratingWords({ valence: -0.5, tension: 0.9, n: 1 })).toBe('dark, tense');
    for (let i = 0; i < MAX_RATINGS_KEPT + 5; i++) m = withRating(m, 'major', 0, 5, r(-1, 1, i));
    expect(m.ratings).toHaveLength(MAX_RATINGS_KEPT);
    expect(m.ratings[0].at).toBe(5);
  });

  it('names a move by its numerals, and a key by its parent mode', () => {
    expect(moveName('major', 0, 5)).toBe('I → vi (major keys)');
    expect(moveName('minor', 4, 0)).toBe('v → i (minor keys)');
    expect(ratingMode(C)).toBe('major');
    expect(ratingMode(Am)).toBe('minor');
    expect(ratingMode({ tonic: 9, scale: 'minorHarmonic' })).toBe('minor');
    expect(movesOf('major')).toHaveLength(42);
  });

  it('offers the least-rated moves first, and not the one just rated while another is as little rated', () => {
    const t: RatingsTable = Object.fromEntries(movesOf('major').filter((m) => !(m.from === 1 && m.to === 4)).map((m) => [moveKey('major', m.from, m.to), { valence: 0, tension: 0, n: 1 }]));
    expect(nextMoveToRate(t, 'major', { random: () => 0.99 })).toEqual({ mode: 'major', from: 1, to: 4 });
    expect(ratedCount(t, 'major')).toBe(41);
    const next = nextMoveToRate({}, 'major', { random: () => 0, avoid: { from: 0, to: 1 } });
    expect(next).not.toEqual({ mode: 'major', from: 0, to: 1 });
  });

  it('captions a rated diatonic move in any key of its mode, and nothing else', () => {
    const t = ratingsTable([withRating(null, 'major', 0, 5, r(-0.7, 0)), withRating(null, 'minor', 4, 0, r(0, 0.8))]);
    const mine = ratedCaptions(t);
    expect(mine.models).toEqual(['your ratings']);
    expect(mine.caption({ from: { root: 0, quality: 'maj' }, to: { root: 9, quality: 'min' } }, undefined, C)).toBe('dark');
    // I to vi in G: G to Em.
    expect(mine.caption({ from: { root: 7, quality: 'maj' }, to: { root: 4, quality: 'min' } }, undefined, G)).toBe('dark');
    // Unrated: the relation's label.
    expect(mine.caption({ from: { root: 0, quality: 'maj' }, to: { root: 7, quality: 'maj' } }, undefined, C)).toBeUndefined();
    // A minor's v to i, rated in the minor table, not the major one.
    expect(mine.caption({ from: { root: 4, quality: 'min' }, to: { root: 9, quality: 'min' } }, undefined, Am)).toBe('tense');
    // A borrowed chord (bVII) has no degree here.
    expect(mine.caption({ from: { root: 0, quality: 'maj' }, to: { root: 10, quality: 'maj' } }, undefined, C)).toBeUndefined();
    expect(CAPTION_SET_IDS).toContain('mine');
    expect(captionSet('mine', { ratings: t }).caption({ from: { root: 0, quality: 'maj' }, to: { root: 9, quality: 'min' } }, undefined, C)).toBe('dark');
    expect(captionSet('mine').caption({ from: { root: 0, quality: 'maj' }, to: { root: 9, quality: 'min' } }, undefined, C)).toBeUndefined();
  });
});

describe.runIf(HARMONY)('the ratings, kept and on the map', () => {
  const provider = () => createInMemoryProvider<MoveRatingsRecord>([]) as DataProvider<MoveRatingsRecord>;

  it('a rating is stored, published, and read back by a new book over the same store', async () => {
    const p = provider();
    const published: RatingsTable[] = [];
    const book = createMoveRatingsBook({ provider: p, publish: (t) => published.push(t) });
    await book.rate('major', 0, 5, r(0.9, 0.1, 1));
    const t = await book.rate('major', 0, 5, r(0.5, 0.1, 2));
    expect(t[moveKey('major', 0, 5)].n).toBe(2);
    expect(published).toHaveLength(2);
    const again = createMoveRatingsBook({ provider: p, publish: () => {} });
    expect((await again.publish())[moveKey('major', 0, 5)]).toEqual({ valence: expect.closeTo(0.7), tension: expect.closeTo(0.1), n: 2 });
    expect(await again.all()).toHaveLength(1);
  });

  it('the practice plays a degree\'s triad in the mode\'s key', () => {
    expect(triadNotes('major', 0)).toEqual([48, 52, 55]);
    expect(triadNotes('major', 5)).toEqual([57, 60, 64]);
    expect(triadNotes('minor', 0)).toEqual([57, 60, 64]);
  });

  it('the chord map says the player\'s words on a rated move, and changes them with a new rating', () => {
    const spec = { root: 0, type: 'major' as const, octaves: 2, baseOctave: 3 };
    const chords = mapChords(spec);
    const f = createPathFollower();
    const frame = { idiom: 'none', captionSet: 'mine' as const, trailSteps: 3, spec, chords, shown: 0 };
    const one = ratingsTable([withRating(null, 'major', 0, 5, r(0.8, 0))]);
    expect(f.push({ ...frame, ratings: one }).moveText!(0, 5)).toBe('bright');
    const two = ratingsTable([withRating(null, 'major', 0, 5, r(-0.8, 0.8))]);
    expect(f.push({ ...frame, ratings: two }).moveText!(0, 5)).toBe('dark, tense');
  });
});
