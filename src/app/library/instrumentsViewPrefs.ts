/**
 * The Instruments view's remembered choices (Round 4, #272): which classes the player
 * collapsed. One Zod-schema'd record persisted through a `DataProvider` (localStorage by
 * default), mirrored in a small zustand store the view reads synchronously.
 *
 * A temporary in-repo stand-in for zodal's persisted view state (i2mint/zodal#15;
 * migration tracked in thorwhalen/thoremin#283). The gallery's list/gallery toggle joins
 * this record when it lands.
 */
import { z } from 'zod';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { instrumentsCollection } from './instrumentsCollection';

/** The single record's id (the view has one set of choices per browser). */
const RECORD_ID = 'instruments';

export const InstrumentsViewPrefsSchema = z.object({
  id: z.literal(RECORD_ID),
  /** Class ids whose group is collapsed. */
  collapsed: z.array(z.string()).default([]),
});
export type InstrumentsViewPrefs = z.infer<typeof InstrumentsViewPrefsSchema>;

export const INSTRUMENTS_VIEW_STORAGE_KEY = 'thoremin.instrumentsView';

export function createInstrumentsViewProvider(): DataProvider<InstrumentsViewPrefs> {
  return typeof localStorage === 'undefined'
    ? createInMemoryProvider<InstrumentsViewPrefs>([], { idField: 'id' })
    : createLocalStorageProvider<InstrumentsViewPrefs>({ storageKey: INSTRUMENTS_VIEW_STORAGE_KEY, idField: 'id' });
}

/** Collapsed on a first visit? The collection's declared default (`groupBy.defaultState`). */
const groupBy = instrumentsCollection.affordances.groupBy;
export const GROUPS_START_COLLAPSED = typeof groupBy === 'object' && groupBy.defaultState === 'collapsed';

export interface InstrumentsViewState {
  /** Class ids whose group is collapsed. */
  collapsed: readonly string[];
  hydrated: boolean;
  /** Read the stored choices (idempotent). A choice made before it resolves wins. */
  hydrate(allClassIds: readonly string[]): Promise<void>;
  toggleCollapsed(classId: string): void;
}

export function createInstrumentsViewStore(
  provider: DataProvider<InstrumentsViewPrefs> = createInstrumentsViewProvider(),
): UseBoundStore<StoreApi<InstrumentsViewState>> {
  let hydrating: Promise<void> | null = null;
  let touched = false;
  const save = (collapsed: readonly string[]) => {
    const record = InstrumentsViewPrefsSchema.parse({ id: RECORD_ID, collapsed: [...collapsed] });
    const write = provider.upsert
      ? provider.upsert(record)
      : provider.getOne(RECORD_ID).then(
          () => provider.update(RECORD_ID, record),
          () => provider.create(record),
        );
    write.catch((err) => console.warn('[thoremin] could not save the Instruments view choices', err));
  };
  return create<InstrumentsViewState>()((set, get) => ({
    collapsed: [],
    hydrated: false,
    hydrate(allClassIds) {
      hydrating ??= provider
        .getOne(RECORD_ID)
        .then((raw) => InstrumentsViewPrefsSchema.parse(raw).collapsed)
        .catch(() => (GROUPS_START_COLLAPSED ? [...allClassIds] : []))
        .then((stored) => {
          if (!touched) set({ collapsed: stored });
          set({ hydrated: true });
        });
      return hydrating;
    },
    toggleCollapsed(classId) {
      touched = true;
      const cur = get().collapsed;
      const next = cur.includes(classId) ? cur.filter((c) => c !== classId) : [...cur, classId];
      set({ collapsed: next });
      save(next);
    },
  }));
}

/** The app's Instruments view choices, persisted to localStorage. */
export const useInstrumentsView = createInstrumentsViewStore();
