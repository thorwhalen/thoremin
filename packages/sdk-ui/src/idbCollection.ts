/**
 * A zodal `DataProvider` over IndexedDB, and the migration from a localStorage-backed one
 * (#412). A named collection whose records outgrow localStorage's ~5 MB budget (saved
 * categorizers: a sample is about 2 KB, a record may hold two thousand) moves to one IndexedDB
 * object store, a record per key, so a save rewrites one record and not the whole collection.
 *
 * Two pieces, each a seam:
 * - {@link createIdbProvider}: the `DataProvider` (a record per key, `id`). Reading a
 *   collection is one `getAll`; a write is one record.
 * - {@link createMigratingProvider}: the EXPAND/MIGRATE step. On first use on a device every
 *   record of the `legacy` provider (the localStorage one) is copied into the `primary` one,
 *   exactly as stored and never over a record already there, and a flag says it was done.
 *   The legacy store is NEVER written or deleted here (the contract step is later); a build
 *   from before still reads it on a rollback, though what the new build saves afterwards is
 *   not copied back. Where IndexedDB is absent or refuses to open (a private window, a test
 *   runtime) the legacy provider is used as it always was, and the copy is retried next load.
 */
import type { DataProvider, GetListParams, GetListResult } from '@zodal/store';
import { filterToFunction } from '@zodal/store';

type Item = Record<string, unknown>;

/** The IndexedDB provider, with the one operation the migration needs. */
export interface IdbProvider<T> extends DataProvider<T> {
  /** Store `item` unless a record of its id is there (atomic); whether it was stored. */
  addIfAbsent(item: T): Promise<boolean>;
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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((e: unknown) => {
      opening = null; // a refusal is not remembered: the next call tries again
      throw e;
    });
    return opening;
  };

  /** One request in its own transaction; settles on the TRANSACTION (a write can abort at commit). */
  async function run<R>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<R> {
    const db = await open();
    return new Promise<R>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
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
      const found = await readOne(id);
      if (!found) throw missing(id);
      const item = { ...found, ...data, id } as T;
      await run('readwrite', (s) => s.put(item));
      return item;
    },
    async updateMany(ids, data) {
      const out: T[] = [];
      for (const id of ids) if (await readOne(id)) out.push(await this.update(id, data));
      return out;
    },
    async delete(id) {
      if (!(await readOne(id))) throw missing(id);
      await run('readwrite', (s) => s.delete(id));
    },
    async deleteMany(ids) {
      for (const id of ids) await run('readwrite', (s) => s.delete(id));
    },
    async upsert(data) {
      await run('readwrite', (s) => s.put(data));
      return data;
    },
    async addIfAbsent(item) {
      try {
        await run('readwrite', (s) => s.add(item));
        return true;
      } catch (e) {
        if ((e as { name?: string })?.name === 'ConstraintError') return false;
        throw e;
      }
    },
    getCapabilities() {
      return { canCreate: true, canUpdate: true, canDelete: true, canBulkUpdate: true, canBulkDelete: true, canUpsert: true, serverSort: false, serverFilter: false, serverSearch: false, serverPagination: false };
    },
  };
}

/** Whether a one-time copy has run on this device. */
export interface MigrationFlag {
  done(): boolean;
  mark(): void;
}

export interface MigratingProviderOptions<T> {
  /** Where the collection lives from now on (IndexedDB). */
  primary: IdbProvider<T>;
  /** Where it lived (localStorage): read once, then left exactly as it was. */
  legacy: DataProvider<T>;
  flag: MigrationFlag;
}

/**
 * The provider a collection uses while it moves from `legacy` to `primary` (see the module
 * comment). It settles once per page which of the two it is: `primary` after a successful
 * (or already recorded) copy, `legacy` when `primary` cannot be used, and every call goes to
 * that one. Nothing is ever written to or removed from `legacy` by the copy.
 */
export function createMigratingProvider<T extends { id: string }>({ primary, legacy, flag }: MigratingProviderOptions<T>): DataProvider<T> {
  let settled: Promise<DataProvider<T>> | null = null;
  const active = (): Promise<DataProvider<T>> =>
    (settled ??= (async () => {
      try {
        await primary.getList({}); // opens the database: throws where IndexedDB is absent or refuses
        if (!flag.done()) {
          for (const raw of (await legacy.getList({})).data) await primary.addIfAbsent(raw);
          flag.mark();
        }
        return primary;
      } catch (e) {
        console.warn('categorizers: IndexedDB is not usable here, the localStorage records are used as before:', e);
        return legacy;
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
