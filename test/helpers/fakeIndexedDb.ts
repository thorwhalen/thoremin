/**
 * A minimal in-memory `indexedDB` for tests that drive the app's IndexedDB code
 * (`src/app/recording/idb.ts`) through the real global, in Node (which has none) or
 * jsdom (which has none either). It implements only what a one-store, key-value user
 * needs: `open` (with `onupgradeneeded`), one transaction, `put` / `get` / `delete`,
 * request `onsuccess` / `onerror` and transaction `oncomplete` / `onerror`.
 *
 * `failWrites` makes every `put` and `delete` fail the way a full disk or a private
 * window does (`QuotaExceededError` on the request, then the transaction), so a test
 * can pin what the app reports when the browser could not keep what it was given.
 * `add` / `getAll` and a `put` keyed by the value's `id` stand in for a `keyPath: 'id'` store.
 * Values are kept by reference, not structured-cloned: enough for a handle-shaped
 * object whose identity a test checks.
 */

type Callback = (() => void) | null;

interface FakeRequest {
  result: unknown;
  error: DOMException | null;
  onsuccess: Callback;
  onerror: Callback;
  onupgradeneeded?: Callback;
}

interface FakeTransaction {
  oncomplete: Callback;
  onerror: Callback;
  onabort: Callback;
  error: DOMException | null;
  objectStore(name: string): unknown;
}

export interface FakeIndexedDb {
  /** The stored records, by key, across every store name. */
  readonly data: Map<IDBValidKey, unknown>;
  /** Make every later write fail (or succeed again). */
  failWrites: boolean;
  /** Put back whatever `indexedDB` was before. */
  uninstall(): void;
}

const g = globalThis as unknown as { indexedDB?: unknown };

/** Install the fake as `globalThis.indexedDB`; call `uninstall()` in `afterEach`. */
export function installFakeIndexedDb({ failWrites = false }: { failWrites?: boolean } = {}): FakeIndexedDb {
  const had = 'indexedDB' in g;
  const before = g.indexedDB;
  const data = new Map<IDBValidKey, unknown>();
  const state: FakeIndexedDb = {
    data,
    failWrites,
    uninstall() {
      if (had) g.indexedDB = before;
      else delete g.indexedDB;
    },
  };

  const settle = (req: FakeRequest, run: () => unknown, fail: boolean | DOMException, tx?: FakeTransaction): FakeRequest => {
    setTimeout(() => {
      if (fail) {
        req.error = fail instanceof DOMException ? fail : new DOMException('the write could not be kept', 'QuotaExceededError');
        req.onerror?.();
        if (tx) {
          tx.error = req.error;
          tx.onerror?.();
          tx.onabort?.();
        }
        return;
      }
      req.result = run();
      req.onsuccess?.();
      tx?.oncomplete?.();
    }, 0);
    return req;
  };
  const newRequest = (): FakeRequest => ({ result: undefined, error: null, onsuccess: null, onerror: null });

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => undefined,
    transaction: () => {
      const tx: FakeTransaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: () => ({
          put: (value: unknown, key?: IDBValidKey) => {
            const k = key ?? (value as { id: IDBValidKey }).id;
            return settle(newRequest(), () => (data.set(k, value), k), state.failWrites, tx);
          },
          get: (key: IDBValidKey) => settle(newRequest(), () => data.get(key), false, tx),
          getAll: () => settle(newRequest(), () => [...data.values()], false, tx),
          // `add` refuses a key that is taken (a ConstraintError), as a real store does; the
          // key is the value's `id` (the collection stores use `keyPath: 'id'`).
          add: (value: { id: IDBValidKey }) => {
            const taken = data.has(value.id);
            return settle(
              newRequest(),
              () => (data.set(value.id, value), value.id),
              taken ? new DOMException('key exists', 'ConstraintError') : state.failWrites,
              tx,
            );
          },
          delete: (key: IDBValidKey) => settle(newRequest(), () => void data.delete(key), state.failWrites, tx),
        }),
      };
      return tx;
    },
  };

  g.indexedDB = {
    open: () => settle(newRequest(), () => db, false),
  };
  return state;
}
