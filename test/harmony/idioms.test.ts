/**
 * Idiom paths (#713): named chord paths realized in a key, the cell each step is drawn on, and the
 * follow cursor that a commit advances, keeps, rejoins further along, or leaves the path from.
 */
import { describe, it, expect } from 'vitest';
import { chordName, type Key } from '@thoremin/sdk/harmony/chord';
import { IDIOMS, ahead, followCommit, idiomById, idiomPath, startFollow, suggested, type FollowCursor } from '@thoremin/sdk/harmony/idioms';

const C: Key = { tonic: 0, scale: 'major' };
const Am: Key = { tonic: 9, scale: 'minor' };
const KEYS: Key[] = Array.from({ length: 12 }, (_, t) => [{ tonic: t, scale: 'major' as const }, { tonic: t, scale: 'minor' as const }]).flat();
const names = (id: string, key: Key) => idiomPath(idiomById(id)!, key).map((s) => chordName(s.chord, key));

describe('the idioms, realized', () => {
  it('spells each idiom in its home key', () => {
    expect(names('pachelbel', { tonic: 2, scale: 'major' })).toEqual(['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A']);
    expect(names('circle', C)).toEqual(['C', 'F', 'B°', 'Em', 'Am', 'Dm', 'G', 'C']);
    expect(names('romanesca', C)).toEqual(['C', 'G', 'Am', 'Em']);
    expect(names('monte', C)).toEqual(['C', 'F', 'D', 'G']);
    expect(names('fonte', C)).toEqual(['A', 'Dm', 'G', 'C']);
    expect(names('thirds', C)).toEqual(['C', 'Am', 'F', 'Dm']);
    expect(names('fifties', C)).toEqual(['C', 'Am', 'F', 'G']);
    expect(names('deceptive', C)).toEqual(['Dm', 'G', 'Am']);
    expect(names('andalusian', Am)).toEqual(['Am', 'G', 'F', 'E']);
  });

  it('draws an applied dominant on its root cell, and a changed quality there too', () => {
    const fonte = idiomPath(idiomById('fonte')!, C);
    expect(fonte[0]).toMatchObject({ cell: 5, fit: 'root' }); // A on Am's cell
    expect(fonte.slice(1).every((s) => s.fit === 'exact')).toBe(true);
    const monte = idiomPath(idiomById('monte')!, C);
    expect(monte.map((s) => [s.cell, s.fit])).toEqual([[0, 'exact'], [3, 'exact'], [1, 'root'], [4, 'exact']]);
    const andalusian = idiomPath(idiomById('andalusian')!, Am);
    expect(andalusian[3]).toMatchObject({ cell: 4, fit: 'root' });
  });

  it('puts every step of every idiom on a cell in every key of its mode', () => {
    for (const key of KEYS) for (const idiom of IDIOMS.filter((i) => i.mode === key.scale)) for (const s of idiomPath(idiom, key)) expect(s.cell).not.toBeNull();
  });

  it('leaves off the map a step the key has no chord for (V/ii in a minor key, whose ii is diminished)', () => {
    expect(idiomPath(idiomById('fonte')!, Am)[0]).toMatchObject({ cell: null, fit: null });
  });

  it('has unique ids and non-empty steps', () => {
    expect(new Set(IDIOMS.map((i) => i.id)).size).toBe(IDIOMS.length);
    for (const i of IDIOMS) expect(i.steps.length).toBeGreaterThan(1);
  });
});

describe('following a path', () => {
  const play = (id: string, key: Key, cells: number[]) => cells.reduce<FollowCursor>((c, cell) => followCommit(idiomById(id)!, key, c, cell), startFollow());

  it('advances through every step when the player plays the path (every idiom, every key of its mode)', () => {
    for (const key of KEYS) {
      for (const idiom of IDIOMS.filter((i) => i.mode === key.scale)) {
        let c = startFollow();
        const path = idiomPath(idiom, key);
        path.forEach((s, i) => {
          expect(suggested(idiom, key, c)?.cell).toBe(s.cell);
          c = followCommit(idiom, key, c, s.cell!);
          expect(c).toEqual({ position: i, onPath: true, skips: 0 });
        });
        expect(suggested(idiom, key, c)?.cell ?? null).toBe(idiom.loops ? path[0].cell : null);
      }
    }
  });

  it('keeps its place on a repeated commit', () => {
    const c = play('fifties', C, [0, 5]);
    expect(followCommit(idiomById('fifties')!, C, c, 5)).toEqual(c);
  });

  it('leaves the path on a chord it does not have, keeping the way back', () => {
    const c = play('fifties', C, [0, 5, 2]); // Em is not in I vi IV V
    expect(c).toEqual({ position: 1, onPath: false, skips: 0 });
    expect(suggested(idiomById('fifties')!, C, c)?.cell).toBe(3);
    expect(followCommit(idiomById('fifties')!, C, c, 3)).toEqual({ position: 2, onPath: true, skips: 0 });
  });

  it('rejoins further along on a skip', () => {
    expect(play('fifties', C, [0, 3])).toEqual({ position: 2, onPath: true, skips: 1 });
    expect(play('romanesca', C, [0, 2])).toEqual({ position: 3, onPath: true, skips: 1 });
  });

  it('does not wrap a path that ends', () => {
    const c = play('romanesca', C, [0, 4, 5, 2]);
    expect(suggested(idiomById('romanesca')!, C, c)).toBeNull();
    expect(followCommit(idiomById('romanesca')!, C, c, 0)).toEqual({ ...c, onPath: false });
  });

  it('wraps a loop, and shows the trail ahead', () => {
    const fifties = idiomById('fifties')!;
    const c = play('fifties', C, [0, 5, 3, 4]);
    expect(ahead(fifties, C, c, 3).map((s) => s.cell)).toEqual([0, 5, 3]);
    expect(followCommit(fifties, C, c, 0)).toEqual({ position: 0, onPath: true, skips: 0 });
    expect(ahead(idiomById('deceptive')!, C, startFollow(), 10)).toHaveLength(3);
  });
});
