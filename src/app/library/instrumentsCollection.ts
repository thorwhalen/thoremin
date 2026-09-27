/**
 * The instruments as a zodal collection (Round 4, Discussion #272): what the Instruments
 * view can DO with its items, declared once over the instrument spec, apart from how any
 * view draws them.
 *
 * The item is the `InstrumentSpec` (`src/instruments/spec.ts`, the ADR's PR 4): one record
 * joined from the dials profile store and this library's metadata. This module declares,
 * abstractly:
 *
 *  - the **query affordances**: a text search, the sort orders the view offers, and the
 *    grouping by class (collapsible, open by default);
 *  - the **field affordances**: which fields a search reads, which are facets, which are
 *    never shown (the settings Layer);
 *  - the **operations**: play, edit, star and make-default on an item; save the current
 *    sound as a new instrument on the collection.
 *
 * The items reach a view through a `DataProvider` ({@link createSpecsSource}): the specs
 * the library has assembled, queried by the provider (search, sort), so a view asks the
 * provider and never filters by hand. Rendering is elsewhere (`InstrumentsPanel`), and a
 * second rendering of the same collection (the gallery) is an addition, not a rewrite.
 *
 * React-free: importable from plain Node tests.
 */
import { defineCollection, type SortingState } from '@zodal/core';
import { createInMemoryProvider, type DataProvider, type GetListParams } from '@zodal/store';
import { InstrumentSpecSchema, type InstrumentSpec } from '@/instruments/spec';

/** The fields a text search reads. The name only, today: searching tags, class and what
 *  an instrument uses (option B of #272) widens this list, not the view. */
export const INSTRUMENT_SEARCH_FIELDS = ['name'] as const;

export const instrumentsCollection = defineCollection(InstrumentSpecSchema, {
  idField: 'id',
  labelField: 'name',
  affordances: {
    // "Save current sound as…" creates; the editor's Save updates. There is no delete in
    // the UI (a deleted seed would come back on the next seed bump: `ensureSeeded`).
    create: true,
    update: true,
    delete: false,
    search: { placeholder: 'Filter instruments…' },
    groupBy: { defaultField: 'class', collapsible: true, defaultState: 'expanded' },
    defaultView: 'list',
    views: ['list'],
    pagination: false,
    selectable: 'single',
  },
  fields: {
    id: { visible: false, searchable: false },
    name: { searchable: true, sortable: true },
    class: { groupable: true, filterable: true, searchable: false },
    tags: { filterable: true, searchable: false },
    starred: { filterable: true, sortable: true },
    emoji: { searchable: false },
    features: { filterable: true, searchable: false },
    branches: { visible: false, searchable: false },
    training: { visible: false, searchable: false },
    // A REFERENCE to a picture (URL, app-relative path or store key), never the bytes:
    // small, so metadata. The bytes, when a player can upload one, are content, and go
    // through a bifurcated provider then.
    image: { storageRole: 'metadata', searchable: false, sortable: false, filterable: false },
    // What the instrument sounds like: the dials Layer. Never listed, searched or sorted.
    settings: { hidden: true, visible: false, searchable: false, sortable: false, filterable: false },
  },
  operations: [
    { name: 'play', label: 'Play', scope: 'item' },
    { name: 'edit', label: 'Edit', scope: 'item', icon: 'settings' },
    { name: 'star', label: 'Favorite', scope: 'item', icon: 'star' },
    { name: 'makeDefault', label: 'Set as default', scope: 'item' },
    { name: 'saveCurrentAs', label: 'Save current sound as…', scope: 'collection' },
  ],
});

/** The sort orders the view offers, as the provider's sorting states. `default` keeps the
 *  library's own order (the shipped order, then the player's); the sort is stable, so
 *  `star` keeps that order within the starred and unstarred groups. */
export const INSTRUMENT_SORTS = {
  default: [],
  star: [{ id: 'starred', desc: true }],
  name: [{ id: 'name', desc: false }],
} as const satisfies Record<string, readonly SortingState[]>;
export type InstrumentSort = keyof typeof INSTRUMENT_SORTS;

/** A `DataProvider` over whatever specs were last handed to it (the library's current
 *  ones), and the handle to hand them over. The provider answers the view's queries; it is
 *  read-only here (writes go through the library and the profile store, which own them). */
export interface SpecsSource {
  provider: DataProvider<InstrumentSpec>;
  set(specs: readonly InstrumentSpec[]): void;
}

export function createSpecsSource(): SpecsSource {
  let specs: InstrumentSpec[] = [];
  const query = (params: GetListParams) =>
    createInMemoryProvider<InstrumentSpec>(specs, {
      idField: 'id',
      searchFields: [...INSTRUMENT_SEARCH_FIELDS],
    }).getList(params);
  const readOnly = () => Promise.reject(new Error('instruments are written through the library'));
  const provider: DataProvider<InstrumentSpec> = {
    getList: query,
    getOne: async (id) => {
      const s = specs.find((x) => x.id === id);
      if (!s) throw new Error(`Item not found: ${id}`);
      return s;
    },
    create: readOnly,
    update: readOnly,
    updateMany: readOnly,
    delete: readOnly,
    deleteMany: readOnly,
    getCapabilities: () => ({
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canBulkUpdate: false,
      canBulkDelete: false,
      canUpsert: false,
      serverSort: true,
      serverFilter: true,
      serverSearch: true,
      serverPagination: true,
    }),
  };
  return {
    provider,
    set(next) {
      specs = [...next];
    },
  };
}
