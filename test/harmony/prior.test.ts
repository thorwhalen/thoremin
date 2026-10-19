/**
 * The transition prior (H10 of #613): Piston's table of usual root progressions as weights, and
 * ranking moves by it, the likeliest first.
 */
import { describe, it, expect } from 'vitest';
import { TRANSITION_PRIORS, rankByPrior } from '@thoremin/sdk/harmony/prior';

const piston = TRANSITION_PRIORS.piston;

describe("Piston's usual root progressions", () => {
  it('weighs usually over sometimes over less often over unnamed', () => {
    expect(piston.weight(4, 0)).toBe(3); // V: I
    expect(piston.weight(4, 5)).toBe(2); // V: sometimes vi
    expect(piston.weight(4, 1)).toBe(1); // V: less often ii
    expect(piston.weight(4, 6)).toBe(0); // V to vii°: not in the table
    expect(piston.weight(6, 2)).toBe(3); // vii°: iii
  });

  it('ranks the likeliest first, ties in their given order, a target outside the key last', () => {
    // From I: IV (usual), iii, ii (less often), V (usual), vi (sometimes), vii° (unnamed).
    expect(rankByPrior(piston, 0, [3, 2, 1, 4, 5, 6])).toEqual([0, 3, 4, 1, 2, 5]);
    expect(rankByPrior(piston, 0, [null, 4])).toEqual([1, 0]);
  });
});
