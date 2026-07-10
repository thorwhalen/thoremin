/**
 * Saved lab-view store (#119) — named Feature Lab configs, modeled as a zodal
 * collection, following the project's persistence rule (affordances first → a
 * stable `DataProvider<T>` contract → localStorage by default, swappable).
 *
 * A thin facade over a zodal `DataProvider`, mirroring `src/settings/presets.ts`.
 * The DEFAULT target is browser localStorage (`@zodal/store-localstorage`); inject
 * any other provider (an in-memory one for tests, files/cloud later) without
 * touching a caller, because the CRUD contract is identical across backends. This
 * is deliberately the lab's OWN collection (separate storage key), independent of
 * the instrument presets and of the live zustand control store, so it stays out of
 * that store's persist version — the reason #119 keeps saved views here.
 *
 * Async persistence layer only: never `await` this in the tick loop. Loading a
 * view hydrates the live `featureLab` overlay config (synchronous zustand); edits
 * debounce-save back here.
 */
import type { DataProvider } from '@zodal/store';
import { defineCollection } from '@zodal/core';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { LabViewSchema, type LabView, type LabViewConfig, type LabViewSummary } from './schema';

/** localStorage key holding the saved lab views (the browser default target). */
export const LAB_VIEWS_STORAGE_KEY = 'thoremin-lab-views';

/** The lab-view collection definition (Zod schema + resolved affordances), for a
 *  future schema-generated management UI (`@zodal/ui`). */
export const labViewCollection = defineCollection(LabViewSchema);

/** Turn a human name into a stable id (the collection key). */
export function labViewId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'view'
  );
}

/** The operations the app needs from lab-view persistence (the affordances). */
export interface LabViewStore {
  /** All views, newest first (metadata only — no config payload). */
  list(): Promise<LabViewSummary[]>;
  /** Create or overwrite the view named `name` with `config`. */
  save(name: string, config: LabViewConfig, now?: number): Promise<LabView>;
  /** Load a view by id, or null if it does not exist / fails validation. */
  load(id: string): Promise<LabView | null>;
  /** Delete a view by id. */
  remove(id: string): Promise<void>;
}

/**
 * Build a {@link LabViewStore}. Defaults to a localStorage-backed provider; pass
 * any `DataProvider<LabView>` (e.g. `createInMemoryProvider` in tests) to retarget
 * storage without touching callers.
 */
export function createLabViewStore(
  provider: DataProvider<LabView> = createLocalStorageProvider<LabView>({
    storageKey: LAB_VIEWS_STORAGE_KEY,
    searchFields: ['name'],
  }),
): LabViewStore {
  const all = async (): Promise<LabView[]> => (await provider.getList({})).data;
  return {
    async list() {
      const data = await all();
      return data
        .map(({ id, name, createdAt }) => ({ id, name, createdAt }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async save(name, config, now) {
      const id = labViewId(name);
      const record = LabViewSchema.parse({
        id,
        name: name.trim() || id,
        createdAt: now ?? Date.now(),
        config,
      });
      const exists = (await all()).some((v) => v.id === id);
      return exists ? provider.update(id, record) : provider.create(record);
    },
    async load(id) {
      const found = (await all()).find((v) => v.id === id);
      if (!found) return null;
      const parsed = LabViewSchema.safeParse(found);
      return parsed.success ? parsed.data : null;
    },
    async remove(id) {
      await provider.delete(id);
    },
  };
}
