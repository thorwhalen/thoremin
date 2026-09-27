/**
 * The Instruments view's remembered choices (Round 4, #272): which classes the player
 * collapsed, and whether they last looked at the list or the gallery ("the choices
 * remembered so that the next time they come to the instruments collection, they have what
 * they chose last"). One Zod-schema'd record persisted through a `DataProvider`
 * (localStorage by default), mirrored in a small zustand store the view reads synchronously.
 *
 * A temporary in-repo stand-in for zodal's persisted view state (i2mint/zodal#15;
 * migration tracked in thorwhalen/thoremin#283).
 */
import { z } from 'zod';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { instrumentsCollection } from './instrumentsCollection';

/** The single record's id (the view has one set of choices per browser). */
const RECORD_ID = 'instruments';

/** The views the collection declares (`affordances.views`), and the one it opens on. */
export const INSTRUMENT_VIEWS = ['list', 'grid'] as const;
export type InstrumentViewMode = (typeof INSTRUMENT_VIEWS)[number];
const declaredDefault = instrumentsCollection.affordances.defaultView;
export const DEFAULT_VIEW: InstrumentViewMode = (INSTRUMENT_VIEWS as readonly string[]).includes(declaredDefault ?? '')
  ? (declaredDefault as InstrumentViewMode)
  : 'list';

export const InstrumentsViewPrefsSchema = z.object({
  id: z.literal(RECORD_ID),
  /** Class ids whose group is collapsed. */
  collapsed: z.array(z.string()).default([]),
  /** The list or the gallery (`grid`), whichever the player chose last. */
  view: z.enum(INSTRUMENT_VIEWS).default(DEFAULT_VIEW),
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
  /** The list or the gallery. */
  view: InstrumentViewMode;
  hydrated: boolean;
  /** Read the stored choices (idempotent). A choice made before it resolves wins. */
  hydrate(allClassIds: readonly string[]): Promise<void>;
  toggleCollapsed(classId: string): void;
  setView(view: InstrumentViewMode): void;
}

export function createInstrumentsViewStore(
  provider: DataProvider<InstrumentsViewPrefs> = createInstrumentsViewProvider(),
): UseBoundStore<StoreApi<InstrumentsViewState>> {
  let hydrating: Promise<void> | null = null;
  // Which fields the player changed before the stored record arrived: those keep their new
  // value; the others take the stored one.
  const touched = new Set<'collapsed' | 'view'>();
  let store: UseBoundStore<StoreApi<InstrumentsViewState>>;
  // A choice made before the stored record arrives is saved once it has: writing earlier
  // would put the not-yet-read fields' defaults over what was stored.
  let saveAfterHydrate = false;
  const save = () => {
    if (!store.getState().hydrated) {
      saveAfterHydrate = true;
      return;
    }
    const { collapsed, view } = store.getState();
    const record = InstrumentsViewPrefsSchema.parse({ id: RECORD_ID, collapsed: [...collapsed], view });
    const write = provider.upsert
      ? provider.upsert(record)
      : provider.getOne(RECORD_ID).then(
          () => provider.update(RECORD_ID, record),
          () => provider.create(record),
        );
    write.catch((err) => console.warn('[thoremin] could not save the Instruments view choices', err));
  };
  store = create<InstrumentsViewState>()((set, get) => ({
    collapsed: [],
    view: DEFAULT_VIEW,
    hydrated: false,
    hydrate(allClassIds) {
      hydrating ??= provider
        .getOne(RECORD_ID)
        .then((raw) => InstrumentsViewPrefsSchema.parse(raw))
        .catch(() =>
          InstrumentsViewPrefsSchema.parse({ id: RECORD_ID, collapsed: GROUPS_START_COLLAPSED ? [...allClassIds] : [] }),
        )
        .then((stored) => {
          set({
            ...(touched.has('collapsed') ? {} : { collapsed: stored.collapsed }),
            ...(touched.has('view') ? {} : { view: stored.view }),
            hydrated: true,
          });
          if (saveAfterHydrate) save();
        });
      return hydrating;
    },
    toggleCollapsed(classId) {
      touched.add('collapsed');
      const cur = get().collapsed;
      set({ collapsed: cur.includes(classId) ? cur.filter((c) => c !== classId) : [...cur, classId] });
      save();
    },
    setView(view) {
      touched.add('view');
      set({ view });
      save();
    },
  }));
  return store;
}

/** The app's Instruments view choices, persisted to localStorage. */
export const useInstrumentsView = createInstrumentsViewStore();
