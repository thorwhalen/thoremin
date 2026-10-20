/**
 * The IndexedDB `DataProvider` (`@thoremin/sdk-ui/idbCollection`, #412) on its own, over the
 * in-memory fake (`test/helpers/fakeIndexedDb.ts`). `test/faces/categorizers_idb.test.ts` drives
 * it through the categorizer collection (the copy from localStorage, a page load at a time);
 * this file pins the provider's own contract, which that one reaches only in part: the list
 * query (filter, search, sort, pages), the bulk verbs, a refused open retried on the next call,
 * a newer database version letting go of the connection, a failed write rejecting, the copy
 * racing another tab, and the migrating provider's fallbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataProvider } from '@zodal/store';
import { createIdbProvider, createMigratingProvider, type IdbProvider } from '@thoremin/sdk-ui/idbCollection';
import { installFakeIndexedDb, type FakeIndexedDb } from './helpers/fakeIndexedDb';

interface Rec {
  id: string;
  name?: string;
  n?: number | null;
  tag?: string;
}

const g = globalThis as unknown as { indexedDB?: { open: (...a: unknown[]) => unknown } };

let idb: FakeIndexedDb | null = null;
let provider: IdbProvider<Rec>;

beforeEach(() => {
  idb = installFakeIndexedDb();
  provider = createIdbProvider<Rec>({ dbName: 'test-db' });
});
afterEach(() => {
  idb?.uninstall();
  idb = null;
  vi.restoreAllMocks();
});

const seed = async (recs: Rec[]) => {
  for (const r of recs) await provider.upsert!(r);
};

describe('createIdbProvider: the list query', () => {
  const RECS: Rec[] = [
    { id: 'a', name: 'Alpha', n: 3, tag: 'x' },
    { id: 'b', name: 'beta', n: 1, tag: 'y' },
    { id: 'c', name: 'Gamma', n: 2, tag: 'x' },
    { id: 'd', n: null, tag: 'x' },
  ];
  beforeEach(() => seed(RECS));

  it('lists everything with no params', async () => {
    const { data, total } = await provider.getList({});
    expect(total).toBe(4);
    expect(data.map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters with a zodal filter expression', async () => {
    const { data, total } = await provider.getList({ filter: { field: 'tag', operator: 'eq', value: 'x' } });
    expect(total).toBe(3);
    expect(data.map((r) => r.id).sort()).toEqual(['a', 'c', 'd']);
  });

  it('searches names case-insensitively, skipping records with no name', async () => {
    const { data } = await provider.getList({ search: 'A' });
    expect(data.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    expect((await provider.getList({ search: 'gam' })).data.map((r) => r.id)).toEqual(['c']);
  });

  it('sorts ascending and descending, a missing value first, ties broken by the next key', async () => {
    const up = await provider.getList({ sort: [{ id: 'n', desc: false }] });
    expect(up.data.map((r) => r.id)).toEqual(['d', 'b', 'c', 'a']);
    const down = await provider.getList({ sort: [{ id: 'n', desc: true }] });
    expect(down.data.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
    const byTag = await provider.getList({ sort: [{ id: 'tag', desc: false }, { id: 'id', desc: true }] });
    expect(byTag.data.map((r) => r.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('pages after filtering and sorting; the total counts every match', async () => {
    const page = await provider.getList({ sort: [{ id: 'id', desc: false }], pagination: { page: 2, pageSize: 3 } });
    expect(page.total).toBe(4);
    expect(page.data.map((r) => r.id)).toEqual(['d']);
  });
});

describe('createIdbProvider: records', () => {
  it('creates with the id given, or one made up; a taken id is refused', async () => {
    const made = await provider.create({ name: 'no id' } as Rec);
    expect(made.id).toMatch(/^\d+-[a-z0-9]+$/);
    expect(await provider.getOne(made.id)).toEqual(made);
    await provider.create({ id: 'k', name: 'k' });
    await expect(provider.create({ id: 'k', name: 'again' })).rejects.toMatchObject({ name: 'ConstraintError' });
  });

  it('getOne of a missing record rejects, naming it', async () => {
    await expect(provider.getOne('nope')).rejects.toThrow('Item not found: nope');
  });

  it('update merges and keeps the id; a missing record rejects and writes nothing', async () => {
    await seed([{ id: 'a', name: 'A', n: 1 }]);
    expect(await provider.update('a', { n: 2, id: 'other' } as Partial<Rec>)).toEqual({ id: 'a', name: 'A', n: 2 });
    await expect(provider.update('zz', { n: 1 })).rejects.toThrow('Item not found: zz');
    expect([...idb!.data.keys()]).toEqual(['a']);
  });

  it('updateMany updates the records that exist and skips the others', async () => {
    await seed([{ id: 'a', n: 1 }, { id: 'b', n: 1 }]);
    const out = await provider.updateMany!(['a', 'gone', 'b'], { tag: 't' });
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
    expect((await provider.getList({})).data.every((r) => r.tag === 't')).toBe(true);
  });

  it('delete removes one record; a missing one rejects', async () => {
    await seed([{ id: 'a' }, { id: 'b' }]);
    await provider.delete('a');
    expect([...idb!.data.keys()]).toEqual(['b']);
    await expect(provider.delete('a')).rejects.toThrow('Item not found: a');
  });

  it('deleteMany removes each, a missing id being no error', async () => {
    await seed([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    await provider.deleteMany!(['a', 'c', 'missing']);
    expect([...idb!.data.keys()]).toEqual(['b']);
  });

  it('a write the browser cannot keep rejects with its error', async () => {
    idb!.failWrites = true;
    await expect(provider.upsert!({ id: 'a' })).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(idb!.data.size).toBe(0);
  });

  it('declares every capability but the server-side query', () => {
    expect(provider.getCapabilities!()).toMatchObject({ canCreate: true, canUpsert: true, serverSort: false, serverFilter: false });
  });
});

describe('createIdbProvider: opening the database', () => {
  it('rejects where IndexedDB is absent', async () => {
    idb!.uninstall();
    idb = null;
    delete g.indexedDB;
    await expect(provider.probe()).rejects.toThrow('IndexedDB is not available');
  });

  it('a refused open is not remembered: the next call opens again', async () => {
    const real = g.indexedDB!.open;
    let refuse = true;
    g.indexedDB!.open = (...a: unknown[]) => {
      if (!refuse) return real(...a);
      const req = { error: new DOMException('refused', 'UnknownError'), onerror: null as null | (() => void) };
      setTimeout(() => req.onerror?.(), 0);
      return req;
    };
    await expect(provider.probe()).rejects.toMatchObject({ name: 'UnknownError' });
    refuse = false;
    await expect(provider.probe()).resolves.toBeUndefined();
  });

  it('opens once while the connection lasts, and again after a newer version asks it to let go', async () => {
    const open = vi.fn(g.indexedDB!.open);
    g.indexedDB!.open = open;
    await provider.probe();
    await provider.getList({});
    expect(open).toHaveBeenCalledTimes(1);
    const db = (open.mock.results[0].value as { result: { close: () => void; onversionchange: () => void } }).result;
    const close = vi.spyOn(db, 'close');
    db.onversionchange!();
    expect(close).toHaveBeenCalledOnce();
    await provider.getList({});
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('createIdbProvider: importOnce', () => {
  it('stores the items and the marker together, once', async () => {
    expect(await provider.imported()).toBe(false);
    expect(await provider.importOnce([{ id: 'a' }, { id: 'b' }])).toBe(true);
    expect(await provider.imported()).toBe(true);
    expect(await provider.importOnce([{ id: 'c' }])).toBe(false);
    expect([...idb!.data.keys()].sort()).toEqual(['a', 'b']);
  });

  it('a record already there aborts the whole copy; with no marker the error is raised', async () => {
    await seed([{ id: 'b', name: 'mine' }]);
    await expect(provider.importOnce([{ id: 'a' }, { id: 'b' }])).rejects.toMatchObject({ name: 'ConstraintError' });
    expect([...idb!.data.keys()]).toEqual(['b']);
    expect(await provider.imported()).toBe(false);
  });

  it('a record already there because another tab copied first is no error', async () => {
    await seed([{ id: 'b' }]);
    vi.spyOn(provider, 'imported').mockResolvedValue(true);
    expect(await provider.importOnce([{ id: 'b' }])).toBe(false);
  });
});

describe('createMigratingProvider: the fallbacks', () => {
  const legacyOf = (recs: Rec[], { upsert = true } = {}): DataProvider<Rec> => {
    const store = new Map(recs.map((r) => [r.id, r]));
    const p: DataProvider<Rec> = {
      getList: async () => ({ data: [...store.values()], total: store.size }),
      getOne: async (id) => store.get(id)!,
      create: async (d) => (store.set(d.id!, d as Rec), d as Rec),
      update: async (id, d) => ({ ...store.get(id)!, ...d }),
      updateMany: async () => [],
      delete: async (id) => void store.delete(id),
      deleteMany: async () => undefined,
    };
    if (upsert) p.upsert = async (d) => (store.set(d.id, d), d);
    return p;
  };
  const flag = (done = false) => ({ done: () => done, mark: vi.fn() });

  it('copies once, marks the hint and then serves every verb from IndexedDB', async () => {
    const f = flag();
    const legacy = legacyOf([{ id: 'old', name: 'Old' }]);
    const p = createMigratingProvider({ primary: provider, legacy, flag: f });
    expect((await p.getList({})).data).toEqual([{ id: 'old', name: 'Old' }]);
    expect(f.mark).toHaveBeenCalledOnce();
    await p.create({ id: 'n1' });
    await p.update('n1', { name: 'N' });
    await p.updateMany!(['n1'], { tag: 't' });
    await p.upsert!({ id: 'n2' });
    expect(await p.getOne('n1')).toEqual({ id: 'n1', name: 'N', tag: 't' });
    await p.delete('n2');
    await p.deleteMany!(['old']);
    expect([...idb!.data.keys()]).toEqual(['n1']);
    // The legacy store was never written.
    expect((await legacy.getList({})).data).toEqual([{ id: 'old', name: 'Old' }]);
    expect(p.getCapabilities!()).toEqual(provider.getCapabilities!());
  });

  it('without IndexedDB and no copy yet, the legacy provider is used as before (create when it has no upsert)', async () => {
    idb!.uninstall();
    idb = null;
    delete g.indexedDB;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = legacyOf([], { upsert: false });
    const create = vi.spyOn(legacy, 'create');
    const p = createMigratingProvider({ primary: provider, legacy, flag: flag(false) });
    await p.upsert!({ id: 'x' });
    expect(create).toHaveBeenCalledWith({ id: 'x' });
  });

  it('without IndexedDB after a copy on this device, the legacy records are read-only and a write says why', async () => {
    idb!.uninstall();
    idb = null;
    delete g.indexedDB;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = createMigratingProvider({ primary: provider, legacy: legacyOf([{ id: 'old' }]), flag: flag(true) });
    expect((await p.getList({})).total).toBe(1);
    for (const write of [() => p.create({ id: 'y' }), () => p.update('old', {}), () => p.delete('old'), () => p.upsert!({ id: 'z' })])
      await expect(write()).rejects.toThrow(/read-only/);
  });
});
