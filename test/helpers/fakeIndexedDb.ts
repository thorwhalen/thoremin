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
 * Transactions are real enough for a read-modify-write and an all-or-nothing batch: one
 * completes when its last request has settled (a request made from a callback keeps it open),
 * and a failed request or an `abort()` rolls back every write it made and fires `onabort`.
 * `add` refuses a taken key (`ConstraintError`); `getAll` and a `put` keyed by the value's `id`
 * stand in for a `keyPath: 'id'` store; a store named `meta` is kept apart from the others.
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
  pending: number;
  done: boolean;
  undo: (() => void)[];
  abort(): void;
  objectStore(name: string): unknown;
}

export interface FakeIndexedDb {
  /** The stored records, by key, across every store name but `meta`. */
  readonly data: Map<IDBValidKey, unknown>;
  /** The `meta` store (bookkeeping a collection keeps beside its records). */
  readonly meta: Map<IDBValidKey, unknown>;
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
  const meta = new Map<IDBValidKey, unknown>();
  const state: FakeIndexedDb = {
    data,
    meta,
    failWrites,
    uninstall() {
      if (had) g.indexedDB = before;
      else delete g.indexedDB;
    },
  };

  const newRequest = (): FakeRequest => ({ result: undefined, error: null, onsuccess: null, onerror: null });

  const rollback = (tx: FakeTransaction) => {
    for (const undo of tx.undo.reverse()) undo();
    tx.undo = [];
  };

  /** A request in `tx` (or none: the `open` request). `fail` is the error it ends in, if any. */
  const settle = (run: () => unknown, fail: boolean | DOMException, tx?: FakeTransaction): FakeRequest => {
    const req = newRequest();
    if (tx) tx.pending++;
    setTimeout(() => {
      if (tx?.done) return;
      if (fail) {
        req.error = fail instanceof DOMException ? fail : new DOMException('the write could not be kept', 'QuotaExceededError');
        req.onerror?.();
        if (tx && !tx.done) {
          tx.error = req.error;
          rollback(tx);
          tx.done = true;
          tx.onerror?.();
          tx.onabort?.();
        }
        return;
      }
      req.result = run();
      req.onsuccess?.();
      if (tx && --tx.pending === 0 && !tx.done) {
        tx.done = true;
        tx.oncomplete?.();
      }
    }, 0);
    return req;
  };

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
        pending: 0,
        done: false,
        undo: [],
        abort() {
          if (tx.done) return;
          rollback(tx);
          tx.done = true;
          setTimeout(() => tx.onabort?.(), 0);
        },
        objectStore: (name: string) => {
          const map = name === 'meta' ? meta : data;
          const write = (k: IDBValidKey, value: unknown) => {
            const had = map.has(k);
            const prev = map.get(k);
            tx.undo.push(() => (had ? map.set(k, prev) : map.delete(k)));
            map.set(k, value);
            return k;
          };
          return {
            put: (value: unknown, key?: IDBValidKey) => {
              const k = key ?? (value as { id: IDBValidKey }).id;
              return settle(() => write(k, value), state.failWrites, tx);
            },
            get: (key: IDBValidKey) => settle(() => map.get(key), false, tx),
            getAll: () => settle(() => [...map.values()], false, tx),
            // `add` refuses a key that is taken, as a real store does (the key is the value's `id`).
            add: (value: { id: IDBValidKey }) =>
              settle(() => write(value.id, value), map.has(value.id) ? new DOMException('key exists', 'ConstraintError') : state.failWrites, tx),
            delete: (key: IDBValidKey) =>
              settle(
                () => {
                  const had = map.has(key);
                  const prev = map.get(key);
                  tx.undo.push(() => void (had && map.set(key, prev)));
                  map.delete(key);
                },
                state.failWrites,
                tx,
              ),
          };
        },
      };
      return tx;
    },
  };

  g.indexedDB = {
    open: () => settle(() => db, false),
  };
  return state;
}
