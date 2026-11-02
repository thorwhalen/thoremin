/**
 * The device cache of timelines, by content key: a zodal `DataProvider` over IndexedDB (a record
 * per entry), behind the SDK's `ContextCache` contract. Where IndexedDB is absent or refuses (a
 * private window, a test runtime), an in-memory cache stands in.
 */
import { createIdbProvider } from '@thoremin/sdk-ui/idbCollection';
import { memoryContextCache, type ContextCache } from '@thoremin/sdk/context/cache';
import type { MusicalContext } from '@thoremin/sdk/context/schema';

interface Entry {
  id: string;
  context: MusicalContext;
}

/** A cache over IndexedDB, falling back to memory when IndexedDB cannot be used. */
export function createContextCache({ dbName = 'thoremin.musicContext' }: { dbName?: string } = {}): ContextCache {
  if (typeof indexedDB === 'undefined') return memoryContextCache();
  const provider = createIdbProvider<Entry>({ dbName, storeName: 'contexts' });
  const memory = memoryContextCache();
  return {
    async get(key) {
      try {
        return (await provider.getOne(key)).context;
      } catch {
        return memory.get(key);
      }
    },
    async set(key, context) {
      await memory.set(key, context);
      try {
        await provider.create({ id: key, context });
      } catch {
        await provider.update(key, { context }).catch(() => undefined);
      }
    },
  };
}
