/**
 * Where persisted collections live (#600 S12): the STORAGE seam. Every `createNamedCollectionStore`
 * collection (core's and an extension's) defaults to its `DataProvider` through this seam, and an
 * extension reaches a store it declared through {@link storage}, so the app picks the storage
 * target once, in the shell ({@link provideStorage}), instead of each store constructing a
 * localStorage provider itself. The stores #659 lists that still build their own localStorage provider (tool pins, the
 * legacy categorizer copies, the profiles and the persist stores) stay where they are on a host swap. An extension names the store it declared (`Extension.stores`,
 * a `StoreDecl`), never a provider.
 *
 * The default target, until a host provides another, is the browser's localStorage under the
 * store's key, which is exactly what every store used before this seam: nothing moves. A store
 * keeps the key it has always had (`legacyKey`, verbatim); the registry of every key the app
 * writes is `src/host/storageKeys.ts`.
 */
import type { DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';

/** The record shape every collection the host stores carries (the named-collection metadata). */
export interface StoredRecord {
  id: string;
}

/** A declared store, as the seam needs it: the key it is kept under. */
export interface StoreKey {
  legacyKey: string;
}

/** What the shell provides: a collection's provider for a store key. */
export interface StorageHost {
  collection<T extends StoredRecord>(key: string): DataProvider<T>;
}

/** A collection in the browser's localStorage under `storageKey`, searchable by name: the default
 *  target, and the one the shell installs today. */
export function localStorageCollectionProvider<T extends StoredRecord>(storageKey: string): DataProvider<T> {
  return createLocalStorageProvider<T & Record<string, unknown>>({ storageKey, searchFields: ['name'] }) as DataProvider<T>;
}

const LOCAL_STORAGE: StorageHost = { collection: localStorageCollectionProvider };
let host: StorageHost = LOCAL_STORAGE;

/** Install the app's storage target (the shell, once); `null` restores the default. Returns the
 *  target it replaced, so a test can put it back. */
export function provideStorage(next: StorageHost | null): StorageHost {
  const previous = host;
  host = next ?? LOCAL_STORAGE;
  return previous;
}

/** Each host's providers, one per key, so a store keeps one provider while its host stays. */
const providers = new WeakMap<StorageHost, Map<string, DataProvider<StoredRecord>>>();

function resolve<T extends StoredRecord>(key: string): DataProvider<T> {
  let byKey = providers.get(host);
  if (!byKey) providers.set(host, (byKey = new Map()));
  let p = byKey.get(key);
  if (!p) byKey.set(key, (p = host.collection<StoredRecord>(key)));
  return p as unknown as DataProvider<T>;
}

/** One forwarding provider per key: a store that keys a cache by its provider sees one provider. */
const forwarding = new Map<string, DataProvider<StoredRecord>>();

/**
 * A collection's provider under `key`, resolved through the host on EVERY access, so a store made
 * at module load (before the shell installed its target) still uses the shell's choice. Reading
 * is forwarded whole: every member, the optional ones included (`upsert`, `subscribe`...), with
 * `in`, `Object.keys` and spreading seeing the host provider's members. Writing a member (a test
 * stubbing `getList`) is refused: replace the host instead.
 */
export function hostCollection<T extends StoredRecord>(key: string): DataProvider<T> {
  let p = forwarding.get(key);
  if (!p) {
    const real = (): Record<PropertyKey, unknown> => resolve<StoredRecord>(key) as unknown as Record<PropertyKey, unknown>;
    p = new Proxy({} as DataProvider<StoredRecord>, {
      get(_target, prop) {
        const r = real();
        const v = r[prop];
        return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(r) : v;
      },
      has: (_target, prop) => prop in real(),
      ownKeys: () => Reflect.ownKeys(real()),
      getOwnPropertyDescriptor(_target, prop) {
        const d = Reflect.getOwnPropertyDescriptor(real(), prop);
        return d && { ...d, configurable: true };
      },
      set() {
        throw new TypeError(`the provider of "${key}" is the host's: install another host (provideStorage) rather than writing to it`);
      },
    });
    forwarding.set(key, p);
  }
  return p as unknown as DataProvider<T>;
}

/** The storage seam as an extension reads it: the collection of a store it declared. */
export function storage(): { collection<T extends StoredRecord>(store: StoreKey): DataProvider<T> } {
  return { collection: <T extends StoredRecord>(store: StoreKey) => hostCollection<T>(store.legacyKey) };
}
