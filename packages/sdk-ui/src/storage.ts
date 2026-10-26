/**
 * Where persisted collections live (#600 S12): the STORAGE seam. Every `createNamedCollectionStore`
 * collection (core's and an extension's) defaults to its `DataProvider` through this seam, and an
 * extension reaches a store it declared through {@link storage}, so the app picks the storage
 * target once, in the shell ({@link provideStorage}), instead of each store constructing a
 * localStorage provider itself. A store that is not a collection (a zustand `persist` store, the
 * instrument profiles, a single JSON blob) reaches the host's KEY-VALUE target instead,
 * {@link hostValues}: the same choice, made in the same place. The legacy categorizer copies and
 * bound sets (migration sources, #659) stay where they are on a host swap. An extension names the
 * store it declared (`Extension.stores`, a `StoreDecl`), never a provider.
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

/** A synchronous string store by key: the shape zustand's `persist` reads (`StateStorage`) and
 *  `localStorage` already has. */
export interface ValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the shell provides: a collection's provider for a store key, and the key-value target
 *  (`null` where it has none, e.g. plain Node: each store then uses its own fallback). A host that
 *  leaves `values` out keeps the default key-value target (localStorage), never nothing: a host
 *  that swaps only the collections must not silently drop the instruments and the controls.
 *  A host whose key-value target is not localStorage must be installed before the persist stores
 *  are created (they hydrate once, then): the shell's is the first import of `src/app/App.tsx`.
 *  `values()` must return the SAME object for as long as the target is unchanged: the persist stores
 *  remember what they last wrote per target (`skipUnchangedWrites`), and a fresh object per call
 *  would make them forget it on every write (safe, but the stale-tab guard of #739 is then off). */
export interface StorageHost {
  collection<T extends StoredRecord>(key: string): DataProvider<T>;
  values?(): ValueStorage | null;
}

/** A collection in the browser's localStorage under `storageKey`, searchable by name: the default
 *  target, and the one the shell installs today. */
export function localStorageCollectionProvider<T extends StoredRecord>(storageKey: string): DataProvider<T> {
  return createLocalStorageProvider<T & Record<string, unknown>>({ storageKey, searchFields: ['name'] }) as DataProvider<T>;
}

/** The global `localStorage` (the browser's; whatever a test installed in its place), or `null`
 *  where there is none (plain Node) or reading it throws (storage disabled): the default
 *  key-value target, and the one the shell installs today. Read on every call, as the stores
 *  that used the global directly did. */
export function localStorageValues(): ValueStorage | null {
  try {
    const ls = (globalThis as { localStorage?: ValueStorage | null }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

const LOCAL_STORAGE: StorageHost = { collection: localStorageCollectionProvider, values: localStorageValues };
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

/** A key-value store that keeps nothing: a fallback for a store that must not persist off the browser. */
export const noopValues: ValueStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/** A key-value store in memory: a fallback for a store that keeps its writes for the session. */
export function memoryValues(): ValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/**
 * The host's key-value target, resolved on EVERY call (so a store made at module load, before the
 * shell installed its target, still follows the shell), or `fallback` while the host has none.
 * A zustand store passes it to `createJSONStorage(() => hostValues(fallback))`.
 */
export function hostValues(fallback: ValueStorage): ValueStorage {
  const target = (): ValueStorage => currentValues() ?? fallback;
  return {
    getItem: (key) => target().getItem(key),
    setItem: (key, value) => target().setItem(key, value),
    removeItem: (key) => target().removeItem(key),
  };
}

/**
 * `storage` whose writes never throw. A full or disabled localStorage throws from `setItem`
 * (`QuotaExceededError`), and zustand's persist middleware calls it synchronously inside every
 * `set(...)` AFTER the in-memory state changed, so one failed write would break the caller of
 * each action (#738). The value stays in memory for the session; the failure is reported once
 * per wrapper (so once per persist store) through `warn`, not once per write.
 */
export function bestEffortWrites(storage: ValueStorage, warn: (err: unknown) => void = defaultWarn): ValueStorage {
  let warned = false;
  const guard = (write: () => void): void => {
    try {
      write();
    } catch (err) {
      if (!warned) {
        warned = true;
        warn(err);
      }
    }
  };
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => guard(() => storage.setItem(key, value)),
    removeItem: (key) => guard(() => storage.removeItem(key)),
  };
}

const defaultWarn = (err: unknown): void => console.warn('[thoremin] storage write failed; keeping the value in memory for this session', err);

/**
 * `storage` that skips a write of the value this wrapper last read or wrote under that key (#739).
 * zustand's persist rewrites the whole blob on EVERY `set`, including ones that touch only
 * transient fields; a tab that held an older copy in memory would then write its stale blob over
 * a newer one another tab saved, losing a pref with no error. Writing only what this tab changed leaves the other tab's save alone (a tab that changes a persisted
 * field still writes its whole blob: merging across tabs is a separate decision, #739 (b)). `scope` names
 * the target in force: when it changes (a host swapped its storage) what was remembered no longer
 * describes the new target and is dropped.
 */
export function skipUnchangedWrites(storage: ValueStorage, scope: () => unknown = () => storage): ValueStorage {
  const known = new Map<string, string>();
  let lastScope = scope();
  const sync = (): void => {
    const now = scope();
    if (now !== lastScope) {
      lastScope = now;
      known.clear();
    }
  };
  return {
    getItem(key) {
      sync();
      const v = storage.getItem(key);
      if (v === null) known.delete(key);
      else known.set(key, v);
      return v;
    },
    setItem(key, value) {
      sync();
      if (known.get(key) === value) return;
      storage.setItem(key, value);
      known.set(key, value);
    },
    removeItem(key) {
      sync();
      known.delete(key);
      storage.removeItem(key);
    },
  };
}

/**
 * {@link hostValues} for a zustand `persist` store: a failed write is warned about once and
 * dropped. A caller that must know a write failed (the instrument profiles) uses `hostValues`.
 */
export function hostPersistValues(fallback: ValueStorage): ValueStorage {
  return bestEffortWrites(skipUnchangedWrites(hostValues(fallback), () => currentValues()));
}

/** Whether the host has a key-value target now (false in plain Node with the default host). */
export function hasHostValues(): boolean {
  return currentValues() !== null;
}

/** The installed host's key-value target; the default one when the host declares none. */
function currentValues(): ValueStorage | null {
  return host.values ? host.values() : localStorageValues();
}
