/**
 * The named-collection CRUD contract (`src/settings/namedCollection.ts`), exercised
 * ONCE over BOTH collections built on it — instrument presets and saved lab views.
 *
 * The two stores used to be copy-pasted, and so were their tests; the shared behaviour
 * (slug ids with a per-collection fallback, save/overwrite-by-name, newest-first listing,
 * remove, missing → null) is asserted here in one parameterized suite. What is genuinely
 * per-collection — schema migration/healing and payload round-tripping — stays in
 * `settings_presets.test.ts` / `lab_views.test.ts`.
 *
 * Run against an in-memory `DataProvider`, so it needs no localStorage and proves the
 * backend is swappable (the same facade works over any provider).
 */
import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createPresetStore, presetId, PRESETS_STORAGE_KEY } from '@/settings/presets';
import { createLabViewStore, labViewId, LAB_VIEWS_STORAGE_KEY } from '@/app/lab/labViews';
import type { NamedCollectionStore, NamedRecord } from '@/settings/namedCollection';
import { SettingsSchema, type Preset } from '@/settings/schema';
import { LabViewConfigSchema, type LabView } from '@/app/lab/schema';

/** One collection under test: how to build an empty store, its id rule, and a payload. */
interface Case<T extends NamedRecord, P> {
  name: string;
  storageKey: string;
  /** The collection's exported id function (the persisted id format — must not drift). */
  idOf: (name: string) => string;
  /** The id an unslugabble name falls back to. */
  idFallback: string;
  store: () => NamedCollectionStore<T, P>;
  payload: () => P;
}

const presetCase: Case<Preset, Preset['settings']> = {
  name: 'presets',
  storageKey: PRESETS_STORAGE_KEY,
  idOf: presetId,
  idFallback: 'preset',
  store: () => createPresetStore(createInMemoryProvider<Preset>([], { searchFields: ['name'] })),
  payload: () =>
    SettingsSchema.parse({
      right: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'warmPad' },
      left: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'glass' },
      syncHands: true,
      masterVolume: 0.4,
      overlay: {},
    }),
};

const labViewCase: Case<LabView, LabView['config']> = {
  name: 'lab views',
  storageKey: LAB_VIEWS_STORAGE_KEY,
  idOf: labViewId,
  idFallback: 'view',
  store: () => createLabViewStore(createInMemoryProvider<LabView>([], { searchFields: ['name'] })),
  payload: () => LabViewConfigSchema.parse({ groups: ['face.geom.mouth'], normalizer: 'quantile' }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CASES = [presetCase, labViewCase] as Case<any, any>[];

describe.each(CASES)('named collection: $name', (c) => {
  it('keeps its own storage key (never share one — that would merge the collections)', () => {
    expect(c.storageKey).toBeTruthy();
    const others = CASES.filter((o) => o.name !== c.name).map((o) => o.storageKey);
    expect(others).not.toContain(c.storageKey);
  });

  it('slugifies names into stable ids, with its own never-empty fallback', () => {
    expect(c.idOf('My Cool Setup!')).toBe('my-cool-setup');
    expect(c.idOf('  Bossa   Nova  ')).toBe('bossa-nova');
    expect(c.idOf('***')).toBe(c.idFallback); // never empty
    expect(c.idOf('   ')).toBe(c.idFallback);
  });

  it('saves, lists, and loads a record by its slug id', async () => {
    const s = c.store();
    await s.save('Swing Lead', c.payload(), 1000);
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'swing-lead', name: 'Swing Lead', createdAt: 1000 });
    expect(await s.load('swing-lead')).toMatchObject({ id: 'swing-lead', name: 'Swing Lead' });
  });

  it('falls back the ID (not the name) for an unslugabble name', async () => {
    const s = c.store();
    const saved = await s.save('***', c.payload(), 1000);
    expect(saved.id).toBe(c.idFallback); // the id must never be empty…
    expect(saved.name).toBe('***'); // …but the player's typed name is kept verbatim
  });

  it('falls back the name too when it is blank (nothing to keep)', async () => {
    const saved = await c.store().save('   ', c.payload(), 1000);
    expect(saved.id).toBe(c.idFallback);
    expect(saved.name).toBe(c.idFallback);
  });

  it('saving the same name overwrites instead of duplicating', async () => {
    const s = c.store();
    await s.save('My Setup', c.payload(), 1000);
    await s.save('My Setup', c.payload(), 2000);
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect((await s.load('my-setup'))?.createdAt).toBe(2000);
  });

  it('orders newest first and removes by id', async () => {
    const s = c.store();
    await s.save('Old', c.payload(), 1000);
    await s.save('New', c.payload(), 3000);
    expect((await s.list()).map((r) => r.id)).toEqual(['new', 'old']);

    await s.remove('old');
    expect((await s.list()).map((r) => r.id)).toEqual(['new']);
  });

  it('load of a missing record returns null', async () => {
    expect(await c.store().load('nope')).toBeNull();
  });
});
