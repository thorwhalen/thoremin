/**
 * Layouts, navigation and the harmonic state (H4b of #613, `docs/design/harmonic-layers.md`
 * §2.3 to §2.5): the geometry is generic (any relations walk a lattice: the video's diatonic map
 * and a Tonnetz lattice alike), a radial layout puts each move at a fixed angle and a direction
 * picks it, a swept scalar picks a slot, and one pure reducer applies the navigators' intents.
 * The chord map's own tests (`test/harmony/chord_map_*`) pin that moving its layout and tracker here
 * changed nothing.
 */
import { describe, it, expect } from 'vitest';
import { cellAt, hexLattice, latticeChord, radial, strip, wedgeAngle } from '@thoremin/sdk/harmony/layout';
import { directionIndex, quantizeIndex } from '@thoremin/sdk/harmony/navigate';
import { applyIntents, initialState, HISTORY_LENGTH } from '@thoremin/sdk/harmony/state';
import { RELATIONS } from '@thoremin/sdk/harmony/space';
import { chordId, parseChordId, type Key } from '@thoremin/sdk/harmony/chord';

const C: Key = { tonic: 0, scale: 'major' };
const ch = (id: string) => parseChordId(id)!;
const REGION = { x0: 0, x1: 1, y0: 0.1, y1: 0.9 };

describe('layouts', () => {
  it('walks any pair of relations over a lattice: the diatonic map, and a Tonnetz walk', () => {
    const dia = (q: number, r: number) => chordId(latticeChord(RELATIONS, { east: 'dia+3', southEast: 'dia+2' }, ch('C:maj'), C, q, r)!);
    expect([dia(1, 0), dia(0, 1), dia(-1, 1), dia(-1, 0)]).toEqual(['F:maj', 'E:min', 'B:dim', 'G:maj']);
    // A lattice of triads by two neo-Riemannian moves: east R, south-east L.
    const tn = (q: number, r: number) => chordId(latticeChord(RELATIONS, { east: 'R', southEast: 'L' }, ch('C:maj'), C, q, r)!);
    expect([tn(1, 0), tn(0, 1), tn(2, 0)]).toEqual(['A:min', 'E:min', 'C:maj']);
    expect(latticeChord(RELATIONS, { east: 'P', southEast: 'nope' }, ch('C:maj'), C, 0, 1)).toBeNull();
  });

  it('lays out a hex lattice centred on (0, 0) and strips across a region', () => {
    const hex = hexLattice(REGION, { aspect: 16 / 9, cellSize: 0.2 });
    const centre = hex.find((c) => c.q === 0 && c.r === 0)!;
    expect(Math.abs(centre.x - 0.5)).toBeLessThan(centre.w);
    expect(strip(REGION, 7, 16 / 9).map((c) => c.q)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(hexLattice(REGION, { aspect: 0, cellSize: 0.2 })).toEqual([]);
  });

  it('puts each move of a radial layout at a fixed angle around a centre cell', () => {
    const cells = radial(REGION, 6, { aspect: 1, radius: 0.3 });
    expect(cells[0].q).toBe(-1);
    expect(cells.slice(1).map((c) => c.q)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(cells[1].x).toBeCloseTo(0.5, 9); // wedge 0 straight up
    expect(cells[1].y).toBeLessThan(cells[0].y);
    expect(cells[4].y).toBeGreaterThan(cells[0].y); // wedge 3 straight down
    expect(cellAt(cells, { x: cells[0].x, y: cells[0].y }, 1)?.index).toBe(0);
    expect(wedgeAngle(3, 6)).toBeCloseTo(Math.PI, 9);
  });
});

describe('navigation', () => {
  it('picks the wedge a displacement points into, clockwise from up, with a dead zone', () => {
    expect(directionIndex({ dx: 0, dy: -1 }, 6, 0.1)).toBe(0);
    expect(directionIndex({ dx: 1, dy: 0 }, 4, 0.1)).toBe(1);
    expect(directionIndex({ dx: 0, dy: 1 }, 4, 0.1)).toBe(2);
    expect(directionIndex({ dx: -1, dy: 0 }, 4, 0.1)).toBe(3);
    expect(directionIndex({ dx: 0.05, dy: 0 }, 4, 0.1)).toBeNull();
    // The same direction is the same wedge whatever the chord in the centre: it is geometry only.
    expect(directionIndex({ dx: Math.sin(wedgeAngle(2, 6)), dy: -Math.cos(wedgeAngle(2, 6)) }, 6, 0.1)).toBe(2);
  });

  it('quantizes a swept scalar into slots, clamped', () => {
    expect([0, 0.2, 0.5, 0.99, 1, 2, -1].map((v) => quantizeIndex(v, 7))).toEqual([0, 1, 3, 6, 6, 6, 0]);
    expect(quantizeIndex(Number.NaN, 7)).toBe(0);
  });
});

describe('the harmonic state', () => {
  it('chooses, steps by a relation and reports a move that cannot apply', () => {
    let s = applyIntents(initialState(C), [{ kind: 'choose', chord: ch('C:maj'), at: 1 }]);
    expect(s.fn?.numeral).toBe('I');
    s = applyIntents(s, [{ kind: 'step', relation: 'dia+3', at: 2 }]);
    expect(chordId(s.chord!)).toBe('F:maj');
    expect(s.history.map((h) => chordId(h.chord))).toEqual(['C:maj']);
    s = applyIntents(s, [{ kind: 'step', relation: 'dia-1', at: 3 }]);
    expect(chordId(s.chord!)).toBe('E:min');
    s = applyIntents(s, [{ kind: 'choose', chord: ch('B:dim'), at: 4 }, { kind: 'step', relation: 'P', at: 4 }]);
    expect(chordId(s.chord!)).toBe('B:dim'); // P does not apply to a diminished triad
    expect(s.rejected).toBe('P');
    s = applyIntents(s, [{ kind: 'step', relation: 'dia+3', at: 5 }]);
    expect(s.rejected).toBeNull();
  });

  it('chooses by function, releases, modulates, merges controls and keeps a bounded history', () => {
    let s = applyIntents(initialState(C), [{ kind: 'function', fn: { degree: 4, of: 4 }, at: 1 }]);
    expect(chordId(s.chord!)).toBe('D:maj');
    expect(s.fn?.numeral).toBe('V/V');
    s = applyIntents(s, [{ kind: 'modulate', key: { tonic: 7, scale: 'major' }, at: 2 }]);
    expect(s.fn?.numeral).toBe('V'); // D is V in G
    s = applyIntents(s, [{ kind: 'controls', controls: { tension: 0.5 } }, { kind: 'controls', controls: { register: 1 } }]);
    expect(s.controls).toEqual({ tension: 0.5, register: 1 });
    s = applyIntents(s, [{ kind: 'release', at: 3 }]);
    expect(s.chord).toBeNull();
    for (let i = 0; i < 40; i++) s = applyIntents(s, [{ kind: 'choose', chord: { root: i % 12, quality: 'maj' }, at: 4 + i }]);
    expect(s.history).toHaveLength(HISTORY_LENGTH);
  });

  it('holds a chord re-chosen without adding to the history (a held cell every frame)', () => {
    let s = applyIntents(initialState(C), [{ kind: 'choose', chord: ch('C:maj'), at: 1 }]);
    for (let i = 0; i < 10; i++) s = applyIntents(s, [{ kind: 'choose', chord: ch('C:maj'), at: 2 + i }]);
    expect(s.history).toEqual([]);
    expect(s.at).toBe(1);
  });
});
