// @vitest-environment jsdom
/**
 * The stores #659 listed that built their own localStorage provider now go through the storage
 * seam: a record written the way they always wrote it (their key, `@zodal/store-localstorage`)
 * still reads back through the seam, and a host that replaces the target is followed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { provideStorage, type StorageHost } from '@thoremin/sdk-ui/storage';
import { BAR_PINS_STORAGE_KEY, createBarPinsProvider } from '@thoremin/sdk-ui/enroll/barPins';
import { INSTRUMENTS_VIEW_STORAGE_KEY, createInstrumentsViewProvider } from '@/app/library/instrumentsViewPrefs';

afterEach(() => {
  provideStorage(null);
  localStorage.clear();
});

const CASES = [
  { name: 'bar pins', key: BAR_PINS_STORAGE_KEY, make: () => createBarPinsProvider() as DataProvider<{ id: string }>, record: { id: 'pins', byModality: { face: ['a'] } } },
  { name: 'Instruments view', key: INSTRUMENTS_VIEW_STORAGE_KEY, make: () => createInstrumentsViewProvider() as DataProvider<{ id: string }>, record: { id: 'instruments', collapsed: ['air'], view: 'grid' } },
];

describe('stores on the storage seam (#659)', () => {
  for (const c of CASES) {
    it(`${c.name}: reads what the old direct provider wrote, under the same key`, async () => {
      await createLocalStorageProvider<{ id: string }>({ storageKey: c.key, idField: 'id' }).create(c.record as never);
      const got = await c.make().getOne('id' in c.record ? c.record.id : '');
      expect(got).toMatchObject(c.record);
    });

    it(`${c.name}: follows a host that replaces the target`, async () => {
      const asked: string[] = [];
      const mem = createInMemoryProvider<{ id: string }>([], { idField: 'id' });
      const host: StorageHost = {
        collection: <T extends { id: string }>(key: string) => {
          asked.push(key);
          return mem as unknown as DataProvider<T>;
        },
      };
      provideStorage(host);
      await c.make().create(c.record as never);
      expect(asked).toContain(c.key);
      expect(await mem.getOne(c.record.id)).toMatchObject(c.record);
      expect(localStorage.getItem(c.key)).toBeNull();
    });
  }
});
