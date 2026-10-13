/**
 * Labelled holds (#385 E7, the carve design's C.4.6): a burst recorded under a typed name is
 * pinned to the category of that name, so its holds land in ONE category at every k (the
 * acceptance line), even when they were spread over several faces; a name that already exists is
 * joined, the modality's neutral word is the Neutral bin, and nothing is left without a category.
 */
import { describe, expect, it } from 'vitest';
import { NEUTRAL_BIN, PersonalCategorizerSchema } from '@thoremin/sdk/enroll/categorizer';
import { pinsHold, placeLabelled, placeOf, recut, recutBounds, type SortResult } from '@thoremin/sdk/enroll/sorting';
import { scriptedCarve } from './helpers/scripted_carve';

function ok(r: SortResult) {
  if (!r.ok) throw new Error(r.error);
  PersonalCategorizerSchema.parse(r.categorizer);
  expect(pinsHold(r.categorizer)).toBe(true);
  return r.categorizer;
}

describe('labelled holds', () => {
  it('a named burst lands in one category of that name at every k, even spread over faces', () => {
    // Deliberately across three faces: only the pins can hold them together.
    const named = ['smile:0', 'smile:1', 'openSmile:0', 'surprise:2'];
    const c = ok(placeLabelled(scriptedCarve(), [{ label: 'mine', ids: named }]));
    const mine = c.categories.find((x) => x.label === 'mine')!;
    expect(mine.members.sort()).toEqual([...named].sort());
    const { minK, maxK } = recutBounds(c);
    expect(maxK).toBeGreaterThan(minK);
    for (let k = minK; k <= maxK; k++) {
      const cut = ok(recut(c, k));
      const places = new Set(named.map((id) => placeOf(cut, id)));
      expect(places.size, `k=${k}`).toBe(1);
      const cat = cut.categories.find((x) => x.id === [...places][0]);
      expect(cat?.label, `k=${k}`).toBe('mine');
    }
  });

  it('joins a category already of that name (case-insensitively), and keeps the rest where they are', () => {
    const base = scriptedCarve();
    const c = ok(placeLabelled(base, [{ label: 'Surprise', ids: ['smile:3'] }]));
    const surprise = c.categories.find((x) => x.label === 'surprise')!;
    expect(surprise.members).toContain('smile:3');
    expect(c.pins?.['smile:3']).toBe(surprise.id);
    expect(c.categories.length).toBe(base.categories.length);
    expect(placeOf(c, 'smile:2')).toBe(placeOf(base, 'smile:2'));
  });

  it("the modality's neutral word puts the holds in Neutral, pinned", () => {
    const c = ok(placeLabelled(scriptedCarve(), [{ label: 'neutral', ids: ['surprise:0'] }], { neutralLabel: 'neutral' }));
    expect(placeOf(c, 'surprise:0')).toBe(NEUTRAL_BIN);
    expect(c.pins?.['surprise:0']).toBe(NEUTRAL_BIN);
  });

  it('a category the labels empty is dropped; a categorizer is never left without one', () => {
    const base = scriptedCarve({ holds: 2 });
    const surprise = base.categories.find((x) => x.label === 'surprise')!;
    const c = ok(placeLabelled(base, [{ label: 'wow', ids: surprise.members }]));
    expect(c.categories.some((x) => x.label === 'surprise')).toBe(false);
    expect(c.categories.find((x) => x.label === 'wow')?.members).toEqual(surprise.members);
    const all = base.categories.flatMap((x) => x.members);
    expect(placeLabelled(base, [{ label: 'neutral', ids: all }], { neutralLabel: 'neutral' }).ok).toBe(false);
  });

  it('refuses an unknown hold, and an empty name changes nothing', () => {
    const base = scriptedCarve();
    expect(placeLabelled(base, [{ label: 'x', ids: ['nope'] }]).ok).toBe(false);
    const same = placeLabelled(base, [{ label: '  ', ids: ['smile:0'] }]);
    expect(same.ok && same.categorizer).toBe(base);
  });
});
