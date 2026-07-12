/**
 * Lab-view-SPECIFIC persistence (#119): what the lab-view schema round-trips (the group
 * selection + normalizer mode + layout + derived formulas) and how it heals an older blob
 * — the "own zodal collection, out of the control-store version" requirement.
 *
 * The generic CRUD contract these views share with the instrument presets (slug ids,
 * save/overwrite, ordering, remove, missing → null) is asserted once for both in
 * `named_collection.test.ts`. Uses an in-memory provider, so it runs in Node with no
 * localStorage.
 */
import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createLabViewStore } from '@/app/lab/labViews';
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
  it('round-trips the config payload (groups + mode + columns + derived)', async () => {
    const s = store();
    await s.save('Mouth Grip', sampleConfig(), 1000);
    const loaded = await s.load('mouth-grip');
    expect(loaded?.config.groups).toContain('face.geom.mouth');
    expect(loaded?.config.normalizer).toBe('quantile');
    expect(loaded?.config.columns).toBe(4);
    expect(loaded?.config.derived[0]).toEqual({ id: 'grip', formula: 'hand_right_index_curl + hand_right_middle_curl' });
  });

  it('heals an older blob (missing fields fill from defaults)', () => {
    const parsed = LabViewConfigSchema.parse({ groups: ['face.head'] });
    expect(parsed.normalizer).toBe('minmax');
    expect(parsed.columns).toBe(3);
    expect(parsed.derived).toEqual([]);
    expect(parsed.showMarkers).toBe(true);
  });
});
