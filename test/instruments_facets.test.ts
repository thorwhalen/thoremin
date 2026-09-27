/**
 * The Instruments view's facet chips (option B of #272): counts from @zodal/groups-core,
 * OR within a family, AND across families, and each family's counts ignoring its own
 * selection so an unpicked chip never reads 0.
 */
import { describe, it, expect } from 'vitest';
import { facetView, chipValue, type FacetItem } from '@/app/library/instrumentsFacets';

const cls = (id: string) => [{ id, label: id === 'air' ? 'Air' : 'Field' }];
const items: FacetItem[] = [
  { id: 'Pentatonic', values: { class: cls('field'), tag: [{ id: 'calm', label: 'calm' }] } },
  { id: 'Wrist Theremin', values: { class: cls('field'), star: [{ id: 'yes', label: 'Starred' }] } },
  { id: 'Air Drum', values: { class: cls('air'), star: [{ id: 'yes', label: 'Starred' }], uses: [{ id: 'air-drum', label: 'Air drum', hint: 'strike' }] } },
  { id: 'Air Flute', values: { class: cls('air'), tag: [{ id: 'calm', label: 'calm' }] } },
];
const all = items.map((i) => i.id);
const chips = (v: ReturnType<typeof facetView>, fam: string) =>
  Object.fromEntries((v.families.find((f) => f.id === fam)?.chips ?? []).map((c) => [chipValue(c), c.count]));

describe('facet chips', () => {
  it('count every value over the pool, with nothing selected', () => {
    const v = facetView(items, all, {});
    expect(chips(v, 'class')).toEqual({ field: 2, air: 2 });
    expect(chips(v, 'star')).toEqual({ yes: 2 });
    expect(chips(v, 'tag')).toEqual({ calm: 2 });
    expect(v.allowed.size).toBe(4);
  });

  it('OR within a family', () => {
    const v = facetView(items, all, { class: new Set(['field', 'air']) });
    expect(v.allowed.size).toBe(4);
  });

  it('AND across families', () => {
    const v = facetView(items, all, { class: new Set(['air']), tag: new Set(['calm']) });
    expect([...v.allowed]).toEqual(['Air Flute']);
  });

  it("a family's counts ignore its own selection (an unpicked chip never reads 0)", () => {
    const v = facetView(items, all, { class: new Set(['air']) });
    expect(chips(v, 'class')).toEqual({ field: 2, air: 2 });
    // ...but other families count within the selection.
    expect(chips(v, 'tag')).toEqual({ calm: 1 });
  });

  it('counts only the pool the text search kept', () => {
    const v = facetView(items, ['Air Drum', 'Air Flute'], {});
    expect(chips(v, 'class')).toEqual({ air: 2 });
  });

  it('keeps a selected chip even at zero, so the selection can be undone', () => {
    const v = facetView(items, ['Pentatonic'], { star: new Set(['yes']) });
    expect(v.families.find((f) => f.id === 'star')?.chips[0]?.selected).toBe(true);
    expect(v.allowed.size).toBe(0);
  });

  it('shows a selected value no item has any more, at zero, so it can be undone', () => {
    const v = facetView(items, all, { tag: new Set(['deleted-tag']) });
    const chip = v.families.find((f) => f.id === 'tag')?.chips.find((c) => chipValue(c) === 'deleted-tag');
    expect(chip?.selected).toBe(true);
    expect(chip?.count).toBe(0);
    expect(v.allowed.size).toBe(0);
  });

  it('keeps a fixed chip order whatever the counts', () => {
    const order = { class: ['field', 'air'] };
    const narrow = facetView(items, ['Air Drum', 'Air Flute', 'Pentatonic'], {}, { order });
    expect(narrow.families.find((f) => f.id === 'class')?.chips.map(chipValue)).toEqual(['field', 'air']);
  });

  it('carries a hint for a tooltip', () => {
    const v = facetView(items, all, {});
    expect(v.families.find((f) => f.id === 'uses')?.chips[0]?.hint).toBe('strike');
  });
});
