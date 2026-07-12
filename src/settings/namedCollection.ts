/**
 * Named-collection store — the SSOT for "a named, persisted snapshot of some
 * payload", modeled as a zodal collection.
 *
 * Two collections (instrument {@link ../settings/presets | presets} and saved
 * {@link ../app/lab/labViews | lab views}) had grown byte-identical CRUD facades
 * over a zodal `DataProvider`: same slug-id rule, same list/save/load/remove, same
 * localStorage default. They differ in exactly four things — the record schema, the
 * storage key, the name of the payload field, and the id fallback — so those are the
 * four parameters here, and each collection collapses to a schema import plus one call.
 *
 * The DEFAULT target is browser localStorage (`@zodal/store-localstorage`); inject any
 * other `DataProvider` — an in-memory one for tests, or files/cloud later — without
 * changing a single caller, because the CRUD contract is identical across backends.
 * This is the "affordances first, target behind a stable contract" rule from CLAUDE.md.
 *
 * Note the hot-path split: this layer is async (persistence). The LIVE per-tick control
 * state stays in the synchronous zustand store; loading a record hydrates that store,
 * and edits debounce-save back here — never `await` in the tick loop.
 */
import type { DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { slugId } from '@/util/ids';

/** The metadata every record in a named collection carries. */
export interface NamedRecord {
  /** Stable id (a slug of the name); the collection's idField. */
  id: string;
  /** Human-facing name the player typed. */
  name: string;
  /** Creation/last-save time (ms since epoch), for "most recent first" ordering. */
  createdAt: number;
}

/** A record without its (potentially large) payload — for listing/picker UIs. */
export type NamedSummary = NamedRecord;

/**
 * The parse contract a collection's schema must satisfy. A Zod schema is one; typing
 * it structurally keeps this module free of any Zod-version generics.
 */
export interface RecordSchema<T> {
  parse(value: unknown): T;
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** The operations the app needs from a named collection's persistence (the affordances). */
export interface NamedCollectionStore<T extends NamedRecord, P> {
  /** All records, newest first (metadata only — no payload). */
  list(): Promise<NamedSummary[]>;
  /** Create or overwrite the record named `name` with `payload`. */
  save(name: string, payload: P, now?: number): Promise<T>;
  /** Load a record by id, or null if it does not exist / fails validation. */
  load(id: string): Promise<T | null>;
  /** Delete a record by id. */
  remove(id: string): Promise<void>;
}

/** What distinguishes one named collection from another. */
export interface NamedCollectionSpec<T extends NamedRecord, K extends keyof T & string> {
  /** The record schema (validates on save, heals/rejects on load). */
  schema: RecordSchema<T>;
  /** localStorage key under which the collection is stored (the browser default target). */
  storageKey: string;
  /** The record field carrying the payload (`'settings'`, `'config'`, …). */
  payloadKey: K;
  /** The id used when a name slugs to nothing (so an id is never empty). */
  idFallback: string;
}

/**
 * Build a collection's store FACTORY: `createXStore(provider?)`. The returned factory
 * defaults to a localStorage-backed provider; pass any `DataProvider<T>` (e.g.
 * `createInMemoryProvider` in tests, or a files/cloud provider later) to retarget
 * storage without touching callers.
 */
export function createNamedCollectionStore<T extends NamedRecord, K extends keyof T & string>({
  schema,
  storageKey,
  payloadKey,
  idFallback,
}: NamedCollectionSpec<T, K>): (provider?: DataProvider<T>) => NamedCollectionStore<T, T[K]> {
  const localStorageProvider = (): DataProvider<T> =>
    createLocalStorageProvider<T & Record<string, unknown>>({
      storageKey,
      searchFields: ['name'],
    }) as DataProvider<T>;

  return (provider: DataProvider<T> = localStorageProvider()): NamedCollectionStore<T, T[K]> => {
    const all = async (): Promise<T[]> => (await provider.getList({})).data;
    return {
      async list() {
        const data = await all();
        return data
          .map(({ id, name, createdAt }) => ({ id, name, createdAt }))
          .sort((a, b) => b.createdAt - a.createdAt);
      },
      async save(name, payload, now) {
        const id = slugId(name, idFallback);
        const record = schema.parse({
          id,
          name: name.trim() || id,
          createdAt: now ?? Date.now(),
          [payloadKey]: payload,
        });
        const exists = (await all()).some((r) => r.id === id);
        return exists ? provider.update(id, record) : provider.create(record);
      },
      async load(id) {
        const found = (await all()).find((r) => r.id === id);
        if (!found) return null;
        const parsed = schema.safeParse(found);
        return parsed.success ? parsed.data : null;
      },
      async remove(id) {
        await provider.delete(id);
      },
    };
  };
}
