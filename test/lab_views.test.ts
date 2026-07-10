/**
 * Saved lab-view persistence (#119) against the zodal `DataProvider` contract,
 * using an in-memory provider so it runs in Node with no localStorage. Proves the
 * backend is swappable (the same store works over any provider) and the schema
 * round-trips the group selection + normalizer mode + derived formulas — the
 * "own zodal collection, out of the control-store version" requirement.
 */
import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createLabViewStore, labViewId } from '@/app/lab/labViews';
import { LabViewConfigSchema, type LabView, type LabViewConfig } from '@/app/lab/schema';

function sampleConfig(overrides: Partial<LabViewConfig> = {}): LabViewConfig {
  return LabViewConfigSchema.parse({
    groups: ['face.geom.mouth', 'hand.finger.flexion'],
    normalizer: 'quantile',
    columns: 4,
    derived: [{ id: 'grip', formula: 'hand_right_index_curl + hand_right_middle_curl' }],
    ...overrides,
  });
}

function store() {
  return createLabViewStore(createInMemoryProvider<LabView>([], { searchFields: ['name'] }));
}

describe('saved lab views', () => {
  it('slugifies names into stable ids (never empty)', () => {
    expect(labViewId('Mouth + Grip')).toBe('mouth-grip');
    expect(labViewId('   ')).toBe('view');
  });

  it('saves, lists, and round-trips a view (groups + mode + derived)', async () => {
    const s = store();
    await s.save('Mouth Grip', sampleConfig(), 1000);
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'mouth-grip', name: 'Mouth Grip', createdAt: 1000 });

    const loaded = await s.load('mouth-grip');
    expect(loaded?.config.groups).toContain('face.geom.mouth');
    expect(loaded?.config.normalizer).toBe('quantile');
    expect(loaded?.config.columns).toBe(4);
    expect(loaded?.config.derived[0]).toEqual({ id: 'grip', formula: 'hand_right_index_curl + hand_right_middle_curl' });
  });

  it('saving the same name overwrites instead of duplicating', async () => {
    const s = store();
    await s.save('View', sampleConfig({ columns: 2 }), 1000);
    await s.save('View', sampleConfig({ columns: 6 }), 2000);
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect((await s.load('view'))?.config.columns).toBe(6);
    expect((await s.load('view'))?.createdAt).toBe(2000);
  });

  it('orders newest first and removes by id', async () => {
    const s = store();
    await s.save('Old', sampleConfig(), 1000);
    await s.save('New', sampleConfig(), 3000);
    expect((await s.list()).map((v) => v.id)).toEqual(['new', 'old']);
    await s.remove('old');
    expect((await s.list()).map((v) => v.id)).toEqual(['new']);
  });

  it('load of a missing view returns null', async () => {
    expect(await store().load('nope')).toBeNull();
  });

  it('heals an older blob (missing fields fill from defaults)', () => {
    const parsed = LabViewConfigSchema.parse({ groups: ['face.head'] });
    expect(parsed.normalizer).toBe('minmax');
    expect(parsed.columns).toBe(3);
    expect(parsed.derived).toEqual([]);
    expect(parsed.showMarkers).toBe(true);
  });
});
