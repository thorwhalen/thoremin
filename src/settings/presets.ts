/**
 * Preset store — named snapshots of the settings, modeled as a zodal collection.
 *
 * `createPresetStore` is a thin facade over a zodal `DataProvider`. The DEFAULT
 * target is browser localStorage (`@zodal/store-localstorage`); inject any other
 * `DataProvider` — an in-memory one for tests, or files/cloud later — without
 * changing a single caller, because the CRUD contract is identical across
 * backends. This is the "affordances first, target behind a stable contract"
 * rule from CLAUDE.md applied to presets.
 *
 * Note the hot-path split: this layer is async (persistence). The LIVE per-tick
 * control state stays in the synchronous zustand store; loading a preset hydrates
 * that store, and edits debounce-save back here — never `await` in the tick loop.
 */
import type { DataProvider } from '@zodal/store';
import { defineCollection } from '@zodal/core';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { PresetSchema, type Preset, type PresetSummary, type Settings } from './schema';

/** localStorage key under which presets are stored (the browser default target). */
export const PRESETS_STORAGE_KEY = 'thoremin-presets';

/**
 * The preset collection definition (Zod schema + resolved affordances). Drives
 * the schema-generated settings/preset UI (zodal `@zodal/ui`) later.
 */
export const presetCollection = defineCollection(PresetSchema);

/** Turn a human name into a stable id (the collection key). */
export function presetId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'preset'
  );
}

/** The operations the app needs from preset persistence (the affordances). */
export interface PresetStore {
  /** All presets, newest first (metadata only — no settings payload). */
  list(): Promise<PresetSummary[]>;
  /** Create or overwrite the preset named `name` with `settings`. */
  save(name: string, settings: Settings, now?: number): Promise<Preset>;
  /** Load a preset by id, or null if it does not exist / fails validation. */
  load(id: string): Promise<Preset | null>;
  /** Delete a preset by id. */
  remove(id: string): Promise<void>;
}

/**
 * Build a {@link PresetStore}. Defaults to a localStorage-backed provider; pass
 * any `DataProvider<Preset>` (e.g. `createInMemoryProvider` in tests, or a files/
 * cloud provider later) to retarget storage without touching callers.
 */
export function createPresetStore(
  provider: DataProvider<Preset> = createLocalStorageProvider<Preset>({
    storageKey: PRESETS_STORAGE_KEY,
    searchFields: ['name'],
  }),
): PresetStore {
  const all = async (): Promise<Preset[]> => (await provider.getList({})).data;
  return {
    async list() {
      const data = await all();
      return data
        .map(({ id, name, createdAt }) => ({ id, name, createdAt }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async save(name, settings, now) {
      const id = presetId(name);
      const record = PresetSchema.parse({
        id,
        name: name.trim() || id,
        createdAt: now ?? Date.now(),
        settings,
      });
      const exists = (await all()).some((p) => p.id === id);
      return exists ? provider.update(id, record) : provider.create(record);
    },
    async load(id) {
      const found = (await all()).find((p) => p.id === id);
      if (!found) return null;
      const parsed = PresetSchema.safeParse(found);
      return parsed.success ? parsed.data : null;
    },
    async remove(id) {
      await provider.delete(id);
    },
  };
}
