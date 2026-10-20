/**
 * A zodal `DataProvider` over IndexedDB, and the migration from a localStorage-backed one
 * (#412). A named collection whose records outgrow localStorage's ~5 MB budget (saved
 * categorizers: a sample is about 2 KB, a record may hold two thousand) moves to one IndexedDB
 * object store, a record per key, so a save rewrites one record and not the whole collection.
 *
 * Two pieces, each a seam:
 * - {@link createIdbProvider}: the `DataProvider` (a record per key, `id`). A write is one
 *   record; an update or a delete reads and writes in ONE transaction.
 * - {@link createMigratingProvider}: the EXPAND/MIGRATE step. On first use on a device every
 *   record of the `legacy` provider (the localStorage one) is copied into the `primary` one,
 *   exactly as stored, in ONE transaction together with a marker kept in IndexedDB itself
 *   (all or nothing; the marker cannot be lost to a full localStorage, which is the reason for
 *   moving). The legacy store is NEVER written or deleted here (the contract step is later). A
 *   build from before still reads it on a rollback, though what that build saves is not copied
 *   forward (the marker is set), and what this one saves after the copy is not seen by it.
 *   Where IndexedDB is absent or refuses to open: before any copy (a private window, a test
 *   runtime) the legacy provider is used as it always was and the copy is retried next load;
 *   after one, the legacy records are shown READ-ONLY (a save fails loudly, rather than
 *   writing records IndexedDB would never see).
 */
import type { DataProvider, GetListParams, GetListResult } from '@zodal/store';
import { filterToFunction } from '@zodal/store';

type Item = Record<string, unknown>;

/** The object store holding the collection's own bookkeeping (the migration marker). */
const META_STORE = 'meta';
const MIGRATED_MARK = 'migrated';

/** The IndexedDB provider, with the one operation the migration needs. */
export interface IdbProvider<T> extends DataProvider<T> {
  /** Open the database (rejects where IndexedDB is absent or refuses): a cheap probe. */
  probe(): Promise<void>;
  /** Whether {@link importOnce} has completed on this device. */
  imported(): Promise<boolean>;
  /**
   * Store `items` and the marker in ONE transaction, unless the marker is already there (then
   * nothing is stored): all or nothing. A record of the same id that is already stored (another
   * tab did the copy first) aborts the transaction; the marker is then read again. Resolves to
   * whether this call stored them.
   */
  importOnce(items: readonly T[]): Promise<boolean>;
}

export interface IdbProviderOptions {
  /** The database name. */
  dbName: string;
  /** The object store name (one per collection; keyed by `id`). */
  storeName?: string;
}

/** The records of a collection in IndexedDB. Throws (rejects) where IndexedDB is absent. */
export function createIdbProvider<T extends { id: string }>({ dbName, storeName = 'records' }: IdbProviderOptions): IdbProvider<T> {
  let opening: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'));
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName, { keyPath: 'id' });
        if (!req.result.objectStoreNames.contains(META_STORE)) req.result.createObjectStore(META_STORE);
      };
      req.onsuccess = () => {
        // A later version of this database (another tab, a newer build) must not wait on this
        // connection: let go of it, and open again on the next call.
        req.result.onversionchange = () => {
          req.result.close();
          opening = null;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
      // `onblocked` is not final (the request can still succeed once the other tab lets go).
    }).catch((e: unknown) => {
      opening = null; // a refusal is not remembered: the next call tries again
      throw e;
    });
    return opening;
  };

  /** One request in its own transaction; settles on the TRANSACTION (a write can abort at commit). */
  async function run<R>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest, store: string = storeName): Promise<R> {
    const db = await open();
    return new Promise<R>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      const fail = () => reject(req.error ?? tx.error ?? new DOMException('IndexedDB transaction failed', 'AbortError'));
      req.onerror = fail;
      tx.onerror = fail;
      tx.onabort = fail;
      tx.oncomplete = () => resolve(req.result as R);
    });
  }
  const readAll = async (): Promise<Item[]> => (await run<Item[] | undefined>('readonly', (s) => s.getAll())) ?? [];
  const readOne = async (id: string): Promise<Item | undefined> => (await run<Item | undefined>('readonly', (s) => s.get(id))) ?? undefined;
  const missing = (id: string) => new Error(`Item not found: ${id}`);

  /** Read the record `id`, then write `next(found)` (or delete it when `next` is null), in ONE
   *  transaction: another tab's delete cannot land between the read and the write. */
  async function modify(id: string, next: ((found: Item) => T) | null): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let out: T | undefined;
      const read = store.get(id);
      read.onsuccess = () => {
        if (read.result === undefined) return void (tx.abort(), reject(missing(id)));
        if (next) store.put((out = next(read.result as Item)));
        else store.delete(id);
      };
      const fail = () => reject(tx.error ?? read.error ?? new DOMException('IndexedDB transaction failed', 'AbortError'));
      tx.onerror = fail;
      tx.onabort = fail;
      tx.oncomplete = () => resolve(out as T);
    });
  }

  return {
    async getList(params: GetListParams): Promise<GetListResult<T>> {
      let items = await readAll();
      if (params.filter) items = items.filter(filterToFunction(params.filter));
      if (params.search) {
        const q = params.search.toLowerCase();
        items = items.filter((i) => typeof i.name === 'string' && i.name.toLowerCase().includes(q));
      }
      const total = items.length;
      if (params.sort?.length) {
        const cmp = (a: unknown, b: unknown) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : (a as number) < (b as number) ? -1 : 1);
        items.sort((a, b) => {
          for (const s of params.sort!) {
            const c = cmp(a[s.id], b[s.id]);
            if (c !== 0) return s.desc ? -c : c;
          }
          return 0;
        });
      }
      if (params.pagination) {
        const { page, pageSize } = params.pagination;
        items = items.slice((page - 1) * pageSize, page * pageSize);
      }
      return { data: items as T[], total };
    },
    async getOne(id) {
      const found = await readOne(id);
      if (!found) throw missing(id);
      return found as T;
    },
    async create(data) {
      const item = { ...data, id: data.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } as T;
      await run('readwrite', (s) => s.add(item));
      return item;
    },
    async update(id, data) {
      return modify(id, (found) => ({ ...found, ...data, id }) as unknown as T);
    },
    async updateMany(ids, data) {
      const out: T[] = [];
      for (const id of ids) if (await readOne(id)) out.push(await this.update(id, data));
      return out;
    },
    async delete(id) {
      await modify(id, null);
    },
    async deleteMany(ids) {
      for (const id of ids) await run('readwrite', (s) => s.delete(id));
    },
    async upsert(data) {
      await run('readwrite', (s) => s.put(data));
      return data;
    },
    probe: async () => void (await open()),
    async imported() {
      return (await run<unknown>('readonly', (s) => s.get(MIGRATED_MARK), META_STORE)) !== undefined;
    },
    async importOnce(items) {
      const db = await open();
      // The legacy collection can hold two records with one id (two saves of one name at
      // once over a provider that checks nothing) or a record with no key at all; `add`
      // refuses both and aborts the whole copy, on every page load, so the migration never
      // takes effect on that device. The first record of an id is the one the player was
      // shown (`getOne` finds the first); a keyless record stays in the legacy key, which
      // the copy never touches, and is said.
      const seen = new Set<string>();
      const copy: Record<string, unknown>[] = [];
      for (const item of items) {
        const id = (item as { id?: unknown } | null)?.id;
        if (typeof id !== 'string') {
          console.warn('[thoremin] a stored record with no string id was left out of the IndexedDB copy', item);
          continue;
        }
        if (seen.has(id)) {
          console.warn(`[thoremin] a duplicated stored record (${id}) was left out of the IndexedDB copy; the first one is kept`);
          continue;
        }
        seen.add(id);
        copy.push(item as Record<string, unknown>);
      }
      const attempt = () =>
        new Promise<boolean>((resolve, reject) => {
          const tx = db.transaction([storeName, META_STORE], 'readwrite');
          const meta = tx.objectStore(META_STORE);
          let stored = false;
          const mark = meta.get(MIGRATED_MARK);
          mark.onsuccess = () => {
            if (mark.result !== undefined) return;
            for (const item of copy) tx.objectStore(storeName).add(item);
            meta.put(Date.now(), MIGRATED_MARK);
            stored = true;
          };
          tx.oncomplete = () => resolve(stored);
          tx.onabort = () => reject(tx.error ?? new DOMException('IndexedDB transaction failed', 'AbortError'));
        });
      try {
        return await attempt();
      } catch (e) {
        // A record of the same id: another tab copied first (the whole copy aborted, nothing of
        // ours was kept). If the marker says so, there is nothing left to do.
        if ((e as { name?: string })?.name === 'ConstraintError' && (await this.imported())) return false;
        throw e;
      }
    },
    getCapabilities() {
      return { canCreate: true, canUpdate: true, canDelete: true, canBulkUpdate: true, canBulkDelete: true, canUpsert: true, serverSort: false, serverFilter: false, serverSearch: false, serverPagination: false };
    },
  };
}

/** A best-effort hint, kept outside IndexedDB, that the copy completed on this device. */
export interface MigrationFlag {
  done(): boolean;
  mark(): void;
}

export interface MigratingProviderOptions<T> {
  /** Where the collection lives from now on (IndexedDB). */
  primary: IdbProvider<T>;
  /** Where it lived (localStorage): read once, then left exactly as it was. */
  legacy: DataProvider<T>;
  /** A hint only (the marker in IndexedDB is the truth, localStorage may be full): when set and
   *  IndexedDB then cannot be opened, the legacy records are shown read-only. */
  flag: MigrationFlag;
}

/**
 * The provider a collection uses while it moves from `legacy` to `primary` (see the module
 * comment). It settles once per page which of the two it is: `primary` after a successful (or
 * already recorded) copy, `legacy` when `primary` cannot be used (read-only if a copy had
 * completed on this device), and every call goes to that one. Nothing is ever written to or
 * removed from `legacy` by the copy.
 */
export function createMigratingProvider<T extends { id: string }>({ primary, legacy, flag }: MigratingProviderOptions<T>): DataProvider<T> {
  let settled: Promise<DataProvider<T>> | null = null;
  const active = (): Promise<DataProvider<T>> =>
    (settled ??= (async () => {
      try {
        await primary.probe();
        if (!(await primary.imported())) await primary.importOnce((await legacy.getList({})).data);
        flag.mark();
        return primary;
      } catch (e) {
        console.warn('categorizers: IndexedDB is not usable here, the localStorage records are used as before:', e);
        return flag.done() ? readOnly(legacy) : legacy;
      }
    })());
  return {
    getList: async (p) => (await active()).getList(p),
    getOne: async (id) => (await active()).getOne(id),
    create: async (d) => (await active()).create(d),
    update: async (id, d) => (await active()).update(id, d),
    updateMany: async (ids, d) => (await active()).updateMany(ids, d),
    delete: async (id) => (await active()).delete(id),
    deleteMany: async (ids) => (await active()).deleteMany(ids),
    upsert: async (d) => {
      const p = await active();
      return p.upsert ? p.upsert(d) : p.create(d);
    },
    getCapabilities: () => primary.getCapabilities!(),
  };
}

/** `provider` for reading only: a write rejects, saying why. */
function readOnly<T>(provider: DataProvider<T>): DataProvider<T> {
  const refuse = (): Promise<never> => Promise.reject(new Error('The saved categorizers are in IndexedDB, which could not be opened: they are shown read-only until it can'));
  return { ...provider, create: refuse, update: refuse, updateMany: refuse, delete: refuse, deleteMany: refuse, upsert: refuse };
}
