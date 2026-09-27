/**
 * The instruments as a zodal collection (Round 4, #272): the collection declares what the
 * Instruments view does over the instrument spec, and the specs provider answers the
 * view's queries (search, sort) so no view filters by hand.
 */
import { describe, it, expect } from 'vitest';
import { assembleSpec } from '@/app/graph';
import {
  createSpecsSource,
  instrumentsCollection,
  INSTRUMENT_SORTS,
  type InstrumentListItem,
} from '@/app/library/instrumentsCollection';

const spec = (
  name: string,
  over: Partial<{ starred: boolean; air: boolean; searchText: string }> = {},
): InstrumentListItem => ({
  ...assembleSpec({
    name,
    layer: {},
    meta: { starred: over.starred ?? false },
    derived: { class: over.air ? 'air' : 'field', branches: [] },
  }),
  searchText: over.searchText ?? '',
});

describe('the instruments collection declares the view', () => {
  it('groups by class, collapsibly, open by default', () => {
    const g = instrumentsCollection.affordances.groupBy;
    expect(typeof g === 'object' && g.defaultField).toBe('class');
    expect(typeof g === 'object' && g.collapsible).toBe(true);
    expect(typeof g === 'object' && g.defaultState).toBe('expanded');
    expect(instrumentsCollection.getGroupableFields().map((f) => f.key)).toContain('class');
  });

  it('searches the name and the derived search text, and never the settings Layer', () => {
    expect(instrumentsCollection.getSearchableFields().sort()).toEqual(['name', 'searchText']);
    expect(instrumentsCollection.getVisibleFields()).not.toContain('searchText');
    expect(instrumentsCollection.getVisibleFields()).not.toContain('settings');
  });

  it('declares the item and collection operations the view offers', () => {
    expect(instrumentsCollection.getOperations('item').map((o) => o.name)).toEqual(['play', 'edit', 'star', 'makeDefault']);
    expect(instrumentsCollection.getOperations('collection').map((o) => o.name)).toEqual(['saveCurrentAs']);
  });

  it("marks the image as a small reference (metadata), not the picture's bytes", () => {
    expect(instrumentsCollection.fieldAffordances.image.storageRole).toBe('metadata');
  });
});

describe('the specs provider answers the queries', () => {
  const src = createSpecsSource();
  src.set([
    spec('Pentatonic'),
    spec('Air Drum', { air: true, starred: true }),
    spec('Wrist Theremin', { searchText: 'note source: wrist' }),
  ]);

  it('lists in the library order when unsorted', async () => {
    const { data } = await src.provider.getList({});
    expect(data.map((s) => s.name)).toEqual(['Pentatonic', 'Air Drum', 'Wrist Theremin']);
  });

  it('searches by name, case-insensitively', async () => {
    const { data } = await src.provider.getList({ search: 'WRIST' });
    expect(data.map((s) => s.name)).toEqual(['Wrist Theremin']);
  });

  it('finds an instrument by what it is, not only its name (option B)', async () => {
    const { data } = await src.provider.getList({ search: 'note source' });
    expect(data.map((s) => s.name)).toEqual(['Wrist Theremin']);
  });

  it('sorts starred first, keeping the library order among the rest', async () => {
    const { data } = await src.provider.getList({ sort: [...INSTRUMENT_SORTS.star] });
    expect(data.map((s) => s.name)).toEqual(['Air Drum', 'Pentatonic', 'Wrist Theremin']);
  });

  it('sorts by name', async () => {
    const { data } = await src.provider.getList({ sort: [...INSTRUMENT_SORTS.name] });
    expect(data.map((s) => s.name)).toEqual(['Air Drum', 'Pentatonic', 'Wrist Theremin']);
  });

  it('is read-only: instruments are written through the library, not the view', async () => {
    await expect(src.provider.update('Pentatonic', { starred: true })).rejects.toThrow(/library/);
  });
});
