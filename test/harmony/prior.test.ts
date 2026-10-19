/**
 * The transition prior (H10 of #613): Piston's table of usual root progressions as weights, and
 * ranking moves by it, the likeliest first.
 */
import { describe, it, expect } from 'vitest';
import { TRANSITION_PRIORS, rankByPrior, rankBySurprise } from '@thoremin/sdk/harmony/prior';

const piston = TRANSITION_PRIORS.piston;

describe("Piston's usual root progressions", () => {
  it('weighs usually over sometimes over less often over unnamed', () => {
    expect(piston.weight(4, 0)).toBe(3); // V: I
    expect(piston.weight(4, 5)).toBe(2); // V: sometimes vi
    expect(piston.weight(4, 1)).toBe(1); // V: less often ii
    expect(piston.weight(4, 6)).toBe(0); // V to vii°: not in the table
    expect(piston.weight(6, 2)).toBe(3); // vii°: iii
  });

  it('is the whole table as Piston wrote it', () => {
    const table: [string, number[], number[], number[]][] = [
      ['I: IV or V, sometimes vi, less often ii or iii', [3, 4], [5], [1, 2]],
      ['ii: V, sometimes IV or vi, less often I or iii', [4], [3, 5], [0, 2]],
      ['iii: vi, sometimes IV, less often ii or V', [5], [3], [1, 4]],
      ['IV: V, sometimes I or ii, less often iii or vi', [4], [0, 1], [2, 5]],
      ['V: I, sometimes IV or vi, less often ii or iii', [0], [3, 5], [1, 2]],
      ['vi: ii or V, sometimes iii or IV, less often I', [1, 4], [2, 3], [0]],
      ['vii°: iii, sometimes I', [2], [0], []],
    ];
    table.forEach(([, usually, sometimes, less], from) => {
      for (let to = 0; to < 7; to++) {
        const want = usually.includes(to) ? 3 : sometimes.includes(to) ? 2 : less.includes(to) ? 1 : 0;
        expect(piston.weight(from, to), `${from} -> ${to}`).toBe(want);
      }
    });
  });

  it('ranks the likeliest first, ties in their given order, a target outside the key last', () => {
    // From I: IV (usual), iii, ii (less often), V (usual), vi (sometimes), vii° (unnamed).
    expect(rankByPrior(piston, 0, [3, 2, 1, 4, 5, 6])).toEqual([0, 3, 4, 1, 2, 5]);
    expect(rankByPrior(piston, 0, [null, 4])).toEqual([1, 0]);
  });
});

describe('surprise (#672)', () => {
  // From I: IV (usually), iii, ii (less often), V (usually), vi (sometimes), vii° (unnamed).
  const targets = [3, 2, 1, 4, 5, 6];
  it('puts the usual first at 0, the "sometimes" in the middle, the rare at 1', () => {
    expect(rankBySurprise(piston, 0, targets, 0)).toEqual(rankByPrior(piston, 0, targets));
    // A half aims between "sometimes" and "less often": iii, ii and vi first, the usual IV and V after.
    expect(new Set(rankBySurprise(piston, 0, targets, 0.5).slice(0, 3))).toEqual(new Set([1, 2, 4]));
    expect(rankBySurprise(piston, 0, targets, 1)[0]).toBe(5); // vii°, not in the table
    expect(rankBySurprise(piston, 0, [null, 4], 1)).toEqual([1, 0]); // outside the key still last
  });
});
