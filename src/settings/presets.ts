/**
 * Preset store — named snapshots of the settings.
 *
 * One instance of the {@link createNamedCollectionStore} facade (see
 * `./namedCollection` for the CRUD contract, the swappable `DataProvider` target and
 * the sync/async hot-path split); this file supplies only what makes presets presets:
 * the schema, the storage key, the payload field, and the id fallback.
 */
import { createNamedCollectionStore, type NamedCollectionStore } from './namedCollection';
import { slugId } from '@/util/ids';
import { PresetSchema, type Preset, type Settings } from './schema';

/** localStorage key under which presets are stored (the browser default target). */
export const PRESETS_STORAGE_KEY = 'thoremin-presets';

/** Turn a human name into a stable id (the collection key). */
export const presetId = (name: string): string => slugId(name, 'preset');

/** The operations the app needs from preset persistence (the affordances). */
export type PresetStore = NamedCollectionStore<Preset, Settings>;

/**
 * Build a {@link PresetStore}. Defaults to a localStorage-backed provider; pass any
 * `DataProvider<Preset>` (e.g. `createInMemoryProvider` in tests) to retarget storage.
 */
export const createPresetStore = createNamedCollectionStore<Preset, 'settings'>({
  schema: PresetSchema,
  storageKey: PRESETS_STORAGE_KEY,
  payloadKey: 'settings',
  idFallback: 'preset',
});
