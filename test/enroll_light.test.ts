/**
 * "Too dark" (#348): the judge over luma readings, with the measurement's own numbers
 * (docs/research/face-categorizer-lighting-and-distance.md: ordinary lighting reads 84 and up,
 * the two dim variants 51 and 29): it warns on the dim ones and not on the ordinary ones, needs
 * a few readings in a row, and does not flicker around the line.
 */
import { describe, expect, it } from 'vitest';
import { createLightJudge, meanLuma } from '@thoremin/sdk/enroll/light';

const feed = (j: ReturnType<typeof createLightJudge>, ...lumas: (number | null)[]) => lumas.map((l) => j.push(l));

describe('meanLuma', () => {
  it('is the Rec. 601 mean of RGBA pixels, null with none', () => {
    expect(meanLuma([255, 255, 255, 255, 0, 0, 0, 255])).toBeCloseTo(127.5, 6);
    expect(meanLuma([])).toBeNull();
  });
});

describe('createLightJudge', () => {
  it('stays quiet in ordinary light and warns in the two dim variants', () => {
    for (const lit of [140, 110, 84]) expect(feed(createLightJudge(), lit, lit, lit, lit)).toEqual([false, false, false, false]);
    for (const dim of [51, 29]) expect(feed(createLightJudge(), dim, dim, dim, dim)).toEqual([false, false, true, true]);
  });

  it('needs readings in a row: one dark reading is a cloud, not a room', () => {
    const j = createLightJudge();
    expect(feed(j, 40, 90, 40, 90, 40, 90).every((d) => !d)).toBe(true);
  });

  it('clears only above the higher line, and a missing reading changes nothing', () => {
    const j = createLightJudge();
    feed(j, 40, 40, 40);
    expect(j.dark).toBe(true);
    expect(feed(j, 70, 70, 70, null, 70)).toEqual([true, true, true, true, true]);
    expect(feed(j, 90, null, 90, 90)).toEqual([true, true, true, false]);
  });
});
