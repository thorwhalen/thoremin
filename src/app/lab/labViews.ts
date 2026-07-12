/**
 * Saved lab-view store (#119) — named Feature Lab configs.
 *
 * One instance of the {@link createNamedCollectionStore} facade (see
 * `@/settings/namedCollection` for the CRUD contract, the swappable `DataProvider`
 * target and the sync/async hot-path split); this file supplies only what makes lab
 * views lab views: the schema, the storage key, the payload field, and the id fallback.
 *
 * Deliberately the lab's OWN collection (its own storage key), independent of the
 * instrument presets and of the live zustand control store — so it stays out of that
 * store's persist version, the reason #119 keeps saved views here.
 */
import { createNamedCollectionStore, type NamedCollectionStore } from '@/settings/namedCollection';
import { slugId } from '@/util/ids';
import { LabViewSchema, type LabView, type LabViewConfig } from './schema';

/** localStorage key holding the saved lab views (the browser default target). */
export const LAB_VIEWS_STORAGE_KEY = 'thoremin-lab-views';

/** Turn a human name into a stable id (the collection key). */
export const labViewId = (name: string): string => slugId(name, 'view');

/** The operations the app needs from lab-view persistence (the affordances). */
export type LabViewStore = NamedCollectionStore<LabView, LabViewConfig>;

/**
 * Build a {@link LabViewStore}. Defaults to a localStorage-backed provider; pass any
 * `DataProvider<LabView>` (e.g. `createInMemoryProvider` in tests) to retarget storage.
 */
export const createLabViewStore = createNamedCollectionStore<LabView, 'config'>({
  schema: LabViewSchema,
  storageKey: LAB_VIEWS_STORAGE_KEY,
  payloadKey: 'config',
  idFallback: 'view',
});
