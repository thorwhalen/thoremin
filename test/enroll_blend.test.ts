/**
 * Continuous control from category memberships (#372): the membership-weighted mean of the values
 * the categories have, and the smoother that keeps a membership's jitter from being heard.
 */
import { describe, expect, it } from 'vitest';
import { blendByMembership, createSmoother } from '@thoremin/sdk/enroll/blend';

describe('blendByMembership', () => {
  it('weighs each category\'s value by its membership; a category with no value does not pull', () => {
    expect(blendByMembership(['a', 'b'], [1, 0], { a: 0.2, b: 0.8 })).toBeCloseTo(0.2);
    expect(blendByMembership(['a', 'b'], [0.5, 0.5], { a: 0.2, b: 0.8 })).toBeCloseTo(0.5);
    expect(blendByMembership(['a', 'b'], [0.25, 0.75], { a: 0, b: 1 })).toBeCloseTo(0.75);
    expect(blendByMembership(['a', 'b', 'c'], [0.5, 0.25, 0.25], { a: 1, b: 0 })).toBeCloseTo(2 / 3);
  });

  it('null when nothing is read or no category has a value', () => {
    expect(blendByMembership([], [], { a: 1 })).toBeNull();
    expect(blendByMembership(['a'], [0], { a: 1 })).toBeNull();
    expect(blendByMembership(['a'], [1], {})).toBeNull();
    expect(blendByMembership(['a'], [Number.NaN], { a: 1 })).toBeNull();
  });
});

describe('createSmoother', () => {
  it('starts at the first target, approaches the next with its time constant, holds on null', () => {
    const s = createSmoother(0.1);
    expect(s.push(0, 0.033)).toBe(0);
    expect(s.push(1, 0.1)).toBeCloseTo(1 - Math.exp(-1));
    expect(s.push(null, 0.1)).toBeCloseTo(1 - Math.exp(-1));
    for (let i = 0; i < 60; i++) s.push(1, 0.033);
    expect(s.push(1, 0.033)).toBeCloseTo(1, 6);
    s.reset();
    expect(s.push(0.3, 0.033)).toBe(0.3);
  });

  it('a time constant of zero follows at once', () => {
    const s = createSmoother(0);
    s.push(0, 0.033);
    expect(s.push(0.7, 0.033)).toBe(0.7);
  });
});

describe('blendByMembership with a floor', () => {
  it('nothing read below the total membership floor (the rest, a stranger), over every category', () => {
    expect(blendByMembership(['a', 'b'], [0.05, 0.05], { a: 0, b: 1 }, { minWeight: 0.2 })).toBeNull();
    // The floor counts a category with no value too: the reading is real, only one category pulls.
    expect(blendByMembership(['a', 'b'], [0.05, 0.6], { a: 0.4 }, { minWeight: 0.2 })).toBeCloseTo(0.4);
  });
});
