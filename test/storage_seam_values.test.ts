// @vitest-environment jsdom
/**
 * The key-value half of the storage seam (#659): the stores that are not collections (the
 * instrument profiles and their scalars, the instrument metadata blob) and the tool pins read
 * what they always wrote, under the same keys, and follow a host that replaces the target.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { createLocalStorageProfileStorage } from '@zodal/dials-ui';
import { hasHostValues, hostValues, localStorageCollectionProvider, memoryValues, noopValues, provideStorage, type StorageHost } from '@thoremin/sdk-ui/storage';
import { TOOL_PINS_STORAGE_KEY, createToolPinsProvider } from '@/app/tools/toolsCollection';
import { readInstrumentMeta, writeInstrumentMeta } from '@/app/library/store';
import { getDefaultName, getSelectedName, instruments, setDefaultName, setSelectedName } from '@/app/dials/instruments';

afterEach(() => {
  provideStorage(null);
  localStorage.clear();
});

/** A host whose key-value target is `mem` (collections stay in localStorage). */
function valuesHost(mem = memoryValues()): { host: StorageHost; mem: ReturnType<typeof memoryValues> } {
  return { host: { collection: localStorageCollectionProvider, values: () => mem }, mem };
}

describe('the key-value target', () => {
  it('defaults to localStorage, resolved on every call', () => {
    const v = hostValues(noopValues);
    v.setItem('k', '1');
    expect(localStorage.getItem('k')).toBe('1');
    const { host, mem } = valuesHost();
    provideStorage(host);
    v.setItem('k', '2');
    expect(mem.getItem('k')).toBe('2');
    expect(localStorage.getItem('k')).toBe('1');
  });

  it('a host that swaps only the collections keeps localStorage for the values (never drops them)', () => {
    provideStorage({ collection: localStorageCollectionProvider });
    hostValues(noopValues).setItem('k', 'kept');
    expect(localStorage.getItem('k')).toBe('kept');
    expect(hasHostValues()).toBe(true);
  });

  it('the shell installs its target before any store module loads', () => {
    const app = readFileSync('src/app/App.tsx', 'utf8');
    expect(app.match(/^import\s.*$/m)?.[0]).toBe("import './host/storage';");
    const main = readFileSync('src/main.tsx', 'utf8');
    const appImports = [...main.matchAll(/^import .*from '\.\/app\/([^']+)'/gm)].map((m) => m[1]);
    expect(appImports[0]).toBe('App.tsx');
  });

  it('uses the fallback while the host has none', () => {
    provideStorage({ collection: localStorageCollectionProvider, values: () => null });
    const fallback = memoryValues();
    hostValues(fallback).setItem('k', 'x');
    expect(fallback.getItem('k')).toBe('x');
    expect(hasHostValues()).toBe(false);
    expect(localStorage.getItem('k')).toBeNull();
  });
});

describe('tool pins on the storage seam (#659)', () => {
  it('reads what the old direct provider wrote, under the same key', async () => {
    await createLocalStorageProvider<{ id: string }>({ storageKey: TOOL_PINS_STORAGE_KEY, idField: 'id' }).create({ id: 'lab', pinned: true } as never);
    expect(await createToolPinsProvider().getOne('lab')).toMatchObject({ id: 'lab', pinned: true });
  });

  it('follows a host that replaces the target', async () => {
    const asked: string[] = [];
    const mem = createInMemoryProvider<{ id: string }>([], { idField: 'id' });
    provideStorage({
      collection: <T extends { id: string }>(key: string) => {
        asked.push(key);
        return mem as unknown as DataProvider<T>;
      },
    });
    await createToolPinsProvider().create({ id: 'lab', pinned: false } as never);
    expect(asked).toContain(TOOL_PINS_STORAGE_KEY);
    expect(await mem.getOne('lab')).toMatchObject({ id: 'lab', pinned: false });
    expect(localStorage.getItem(TOOL_PINS_STORAGE_KEY)).toBeNull();
  });
});

describe('the instrument metadata blob on the seam (#659)', () => {
  const META = { Bell: { starred: true, tagIds: [] } };

  it('reads what the old code wrote, under the same key', async () => {
    localStorage.setItem('thoremin.library.instrumentMeta', JSON.stringify(META));
    expect(await readInstrumentMeta()).toMatchObject(META);
  });

  it('follows a host that replaces the target', async () => {
    const { host, mem } = valuesHost();
    provideStorage(host);
    await writeInstrumentMeta(META as never);
    expect(JSON.parse(mem.getItem('thoremin.library.instrumentMeta')!)).toMatchObject(META);
    expect(localStorage.getItem('thoremin.library.instrumentMeta')).toBeNull();
    expect(await readInstrumentMeta()).toMatchObject(META);
  });
});

describe('the instrument profiles and their scalars on the seam (#659)', () => {
  it('reads what dials-ui\'s localStorage storage wrote, under the same key', async () => {
    const layer = { values: {} };
    await createLocalStorageProfileStorage('thoremin.instruments').write([{ name: 'Mine', layer, savedAt: 1 } as never]);
    expect((await instruments.list()).map((p) => p.name)).toContain('Mine');
  });

  it('what it writes, dials-ui\'s own localStorage reader reads back', async () => {
    await instruments.save('RoundTrip', {} as never);
    const old = await createLocalStorageProfileStorage('thoremin.instruments').read();
    expect(old.map((p) => p.name)).toContain('RoundTrip');
  });

  it('a corrupt stored list reads as empty, as before', async () => {
    localStorage.setItem('thoremin.instruments', '{not json');
    expect(await instruments.list()).toEqual([]);
  });

  it('the selected and default names keep their keys', () => {
    setSelectedName('Bell');
    setDefaultName('Reed');
    expect(localStorage.getItem('thoremin.instruments.selected')).toBe('Bell');
    expect(localStorage.getItem('thoremin.instruments.default')).toBe('Reed');
    setSelectedName('');
    expect(localStorage.getItem('thoremin.instruments.selected')).toBeNull();
  });

  it('profiles and names follow a host that replaces the target', async () => {
    const { host, mem } = valuesHost();
    provideStorage(host);
    await instruments.save('Moved', {} as never);
    setSelectedName('Moved');
    setDefaultName('Moved');
    expect(JSON.parse(mem.getItem('thoremin.instruments')!).map((p: { name: string }) => p.name)).toContain('Moved');
    expect(getSelectedName()).toBe('Moved');
    expect(getDefaultName()).toBe('Moved');
    expect(localStorage.getItem('thoremin.instruments')).toBeNull();
    expect(localStorage.getItem('thoremin.instruments.selected')).toBeNull();
  });
});

describe('the zustand persist stores on the seam (#659)', () => {
  // Imported lazily so the store modules see this file's jsdom window, like the app's.
  const stores = async () => {
    const { useControls } = await import('@/app/store');
    const { useVoice } = await import('@thoremin/sdk-ui/enroll/voiceRuntime');
    const { useTrainerPrefs } = await import('@/slices/trainer/app/prefs');
    const { useCategoryBinding, CATEGORY_PREFS_STORAGE_KEY } = await import('@/app/enroll/categoryBinding');
    return [
      { key: 'thoremin-controls', write: (n: number) => useControls.setState({ octaveShift: n % 2 }), field: 'octaveShift' },
      { key: 'thoremin-trainer-voice', write: (n: number) => useVoice.getState().setEnabled(n % 2 === 1), field: 'enabled' },
      { key: 'thoremin-trainer-prefs', write: (n: number) => useTrainerPrefs.getState().setRecordTake(n % 2 === 1), field: 'recordTake' },
      { key: CATEGORY_PREFS_STORAGE_KEY, write: (n: number) => useCategoryBinding.getState().setEnabled(n % 2 === 1), field: 'enabled' },
    ];
  };

  it('each writes under its own key in localStorage by default, as before', async () => {
    for (const s of await stores()) {
      s.write(1);
      const blob = JSON.parse(localStorage.getItem(s.key) ?? 'null') as { state: Record<string, unknown> } | null;
      expect(blob?.state, s.key).toHaveProperty(s.field);
    }
  });

  it('each restores its state from a blob already under its key', async () => {
    const { useVoice } = await import('@thoremin/sdk-ui/enroll/voiceRuntime');
    const { useTrainerPrefs } = await import('@/slices/trainer/app/prefs');
    const { useCategoryBinding, CATEGORY_PREFS_STORAGE_KEY } = await import('@/app/enroll/categoryBinding');
    useVoice.setState({ enabled: false });
    useTrainerPrefs.setState({ manualAdvance: false });
    useCategoryBinding.setState({ holdMs: 100 });
    localStorage.setItem('thoremin-trainer-voice', JSON.stringify({ state: { enabled: true }, version: 0 }));
    localStorage.setItem('thoremin-trainer-prefs', JSON.stringify({ state: { recordTake: true, manualAdvance: true }, version: 0 }));
    const binding = JSON.parse(localStorage.getItem(CATEGORY_PREFS_STORAGE_KEY) ?? '{"state":{},"version":0}') as { state: Record<string, unknown>; version: number };
    localStorage.setItem(CATEGORY_PREFS_STORAGE_KEY, JSON.stringify({ ...binding, state: { ...binding.state, holdMs: 777 } }));
    await useVoice.persist.rehydrate();
    await useTrainerPrefs.persist.rehydrate();
    await useCategoryBinding.persist.rehydrate();
    expect(useVoice.getState().enabled).toBe(true);
    expect(useTrainerPrefs.getState().manualAdvance).toBe(true);
    expect(useCategoryBinding.getState().holdMs).toBe(777);
  });

  it('each follows a host that replaces the target', async () => {
    const { host, mem } = valuesHost();
    provideStorage(host);
    for (const s of await stores()) {
      s.write(0);
      s.write(1);
      expect(JSON.parse(mem.getItem(s.key) ?? 'null')?.state, s.key).toHaveProperty(s.field);
      expect(localStorage.getItem(s.key), s.key).toBeNull();
    }
  });
});
