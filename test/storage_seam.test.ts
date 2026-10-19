/**
 * The storage seam (#600 S12): every named collection reaches its provider through
 * `@thoremin/sdk-ui/storage`, so the shell picks the target once. A store made before the shell
 * installs its target still follows it (the default provider resolves the host on each access),
 * every member of the host's provider is forwarded (the optional ones too), and the default is
 * the localStorage target every store used before the seam.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { z } from 'zod';
import { hostCollection, provideStorage, storage, type StorageHost } from '@thoremin/sdk-ui/storage';
import { createNamedCollectionStore } from '@thoremin/sdk-ui/namedCollection';

const Schema = z.object({ id: z.string(), name: z.string(), createdAt: z.number(), payload: z.number() });
type Rec = z.infer<typeof Schema>;
const createStore = createNamedCollectionStore<Rec, 'payload'>({ schema: Schema, storageKey: 'thoremin-seam-test', payloadKey: 'payload', idFallback: 'r' });

/** A host backed by one in-memory provider per key, recording which keys it was asked for. */
function memoryHost(): StorageHost & { asked: string[]; providers: Map<string, DataProvider<{ id: string }>> } {
  const providers = new Map<string, DataProvider<{ id: string }>>();
  const asked: string[] = [];
  return {
    asked,
    providers,
    collection<T extends { id: string }>(key: string) {
      asked.push(key);
      if (!providers.has(key)) providers.set(key, createInMemoryProvider<{ id: string }>([]) as DataProvider<{ id: string }>);
      return providers.get(key) as unknown as DataProvider<T>;
    },
  };
}

afterEach(() => provideStorage(null));

describe('the storage seam (#600 S12)', () => {
  it('a store made BEFORE the shell installs its target writes to that target', async () => {
    const store = createStore();
    const host = memoryHost();
    provideStorage(host);
    await store.save('One', 1, 10);
    expect(host.asked).toEqual(['thoremin-seam-test']);
    expect((await host.providers.get('thoremin-seam-test')!.getList({})).data).toEqual([{ id: 'one', name: 'One', createdAt: 10, payload: 1 }]);
    expect(await store.list()).toEqual([{ id: 'one', name: 'One', createdAt: 10 }]);
  });

  it('an extension reaches a declared store\'s collection by the store, one provider per key per host', async () => {
    const host = memoryHost();
    provideStorage(host);
    const p = storage().collection<{ id: string; v: number }>({ legacyKey: 'thoremin.ext-store' });
    await p.create({ id: 'a', v: 1 });
    await p.create({ id: 'b', v: 2 });
    expect((await p.getList({})).data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(host.asked).toEqual(['thoremin.ext-store']);
  });

  it('forwards every member of the host\'s provider, its absence too', () => {
    const upsert = async (d: { id: string }) => d;
    provideStorage({ collection: () => ({ ...createInMemoryProvider<{ id: string }>([]), upsert }) as never });
    const withUpsert = hostCollection<{ id: string }>('thoremin.a');
    expect(typeof withUpsert.upsert).toBe('function');
    expect('upsert' in withUpsert).toBe(true);
    provideStorage({ collection: () => createInMemoryProvider<{ id: string }>([]) as never });
    expect('subscribe' in hostCollection<{ id: string }>('thoremin.b')).toBe(false);
  });

  it('one forwarding provider per key; its members enumerate as the host provider\'s; writing to it is refused', () => {
    provideStorage({ collection: () => createInMemoryProvider<{ id: string }>([]) as never });
    const p = hostCollection<{ id: string }>('thoremin.c');
    expect(hostCollection<{ id: string }>('thoremin.c')).toBe(p);
    expect(Object.keys(p)).toEqual(expect.arrayContaining(['getList', 'create', 'delete']));
    expect(typeof { ...p }.getList).toBe('function');
    expect(() => {
      (p as { getList: unknown }).getList = () => null;
    }).toThrow(/install another host/);
  });

  it('provideStorage returns the target it replaced', () => {
    const a = memoryHost();
    const before = provideStorage(a);
    expect(provideStorage(before)).toBe(a);
  });

  it('defaults to the browser\'s localStorage under the store\'s key (what every store used before)', async () => {
    const items = new Map<string, string>();
    const fake = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    try {
      provideStorage(null);
      await createStore().save('Two', 2, 20);
      expect(JSON.parse(items.get('thoremin-seam-test')!)).toEqual([{ id: 'two', name: 'Two', createdAt: 20, payload: 2 }]);
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', had);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
