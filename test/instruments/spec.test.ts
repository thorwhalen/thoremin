/**
 * PR 4 of the instruments-as-graphs ADR: the instrument spec as a JOIN of the profile store's
 * Layer, the library's metadata record and the derivation; the derivation's class always
 * wins; branches are explicit when written, derived otherwise; the explicit set still unions
 * a tool's demand; the metadata record heals old records and validates new fields.
 */
import { describe, expect, it } from 'vitest';
import { assembleSpec, classCacheIsStale, InstrumentSpecSchema } from '@/instruments/spec';
import { branchIdsFor } from '@/instruments/derive';
import { InstrumentMetaSchema } from '@/app/library/model';
import { healInstrumentMetaMap } from '@/app/library/store';
import { deriveForName } from '@/app/library/derive';
import { SEED_INSTRUMENTS, instruments } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';

const layer = { 'master.volume': 0.5 };

describe('assembleSpec', () => {
  it('the derived class wins over a stale cache; a legacy cached id is normalised when there is no derivation', () => {
    const derived = { class: 'air' as const, branches: ['air-drum'] };
    expect(assembleSpec({ name: 'X', layer, meta: { class: 'field' }, derived }).class).toBe('air');
    expect(assembleSpec({ name: 'X', layer, meta: { class: 'theremin' } }).class).toBe('field');
    expect(assembleSpec({ name: 'X', layer }).class).toBe('field');
  });

  it('branches are the explicit list when written, else the derived set, else absent; features mirror them', () => {
    const derived = { class: 'field' as const, branches: ['field-voices', 'face-chord'] };
    const explicit = assembleSpec({ name: 'X', layer, meta: { branches: ['field-voices', 'conductor'] }, derived });
    expect(explicit.branches).toEqual(['field-voices', 'conductor']);
    expect(explicit.features).toEqual(['field-voices', 'conductor']);
    const derivedOnly = assembleSpec({ name: 'X', layer, derived });
    expect(derivedOnly.branches).toEqual(['field-voices', 'face-chord']);
    const neither = assembleSpec({ name: 'X', layer });
    expect(neither.branches).toBeUndefined();
    expect(neither.features).toEqual([]);
  });

  it('tags, emoji, image and training pass through; id is the name; the settings are the Layer', () => {
    const spec = assembleSpec({
      name: 'Glass Bells',
      layer,
      meta: { tagIds: ['t1'], emoji: '🔔', image: 'gallery/glass-bells.png', training: { route: 'trainer/sequence?instrument=Glass%20Bells' } },
    });
    expect(spec).toMatchObject({
      id: 'Glass Bells',
      name: 'Glass Bells',
      tags: ['t1'],
      emoji: '🔔',
      image: 'gallery/glass-bells.png',
      training: { route: 'trainer/sequence?instrument=Glass%20Bells' },
      settings: layer,
    });
  });

  it('the schema rejects an unknown class and accepts (normalising) the legacy id', () => {
    const base = { id: 'X', name: 'X', settings: layer };
    expect(() => InstrumentSpecSchema.parse({ ...base, class: 'brass' })).toThrow(/unknown instrument class/);
    expect(InstrumentSpecSchema.parse({ ...base, class: 'theremin' }).class).toBe('field');
  });

  it('classCacheIsStale: missing or disagreeing (after normalisation) is stale', () => {
    expect(classCacheIsStale(undefined, 'field')).toBe(true);
    expect(classCacheIsStale('theremin', 'field')).toBe(false);
    expect(classCacheIsStale('field', 'air')).toBe(true);
  });
});

describe('an explicit branch set still unions what a tool demands', () => {
  const s = settingsFromLayer(SEED_INSTRUMENTS.find((x) => x.name === 'Glass Bells')!.layer);
  it('replaces the derived set', () => {
    expect(branchIdsFor(s).sort()).toEqual(['face-chord', 'face-source', 'field-voices']);
    expect(branchIdsFor(s, { explicit: ['field-voices'] })).toEqual(['field-voices']);
  });
  it('a face-group demand adds the face source to an explicit set that lacks it', () => {
    expect(branchIdsFor(s, { explicit: ['field-voices'], demanded: new Set(['face.geom.mouth']) }).sort()).toEqual(['face-source', 'field-voices']);
  });
  it('null means "derive"', () => {
    expect(branchIdsFor(s, { explicit: null }).sort()).toEqual(['face-chord', 'face-source', 'field-voices']);
  });
});

describe('the metadata record carries the spec fields and heals old records', () => {
  it('an old record without the new fields parses unchanged', () => {
    expect(InstrumentMetaSchema.parse({ starred: true, tagIds: ['a'] })).toEqual({ starred: true, tagIds: ['a'] });
    expect(healInstrumentMetaMap({ X: { starred: false } })).toEqual({ X: { starred: false, tagIds: [] } });
  });
  it('the new fields validate: an empty training route is refused, a branch list and an image reference pass', () => {
    expect(InstrumentMetaSchema.safeParse({ training: { route: '' } }).success).toBe(false);
    const ok = InstrumentMetaSchema.parse({ class: 'air', branches: ['air-drum'], image: 'gallery/drum.png', training: { route: 'trainer' } });
    expect(ok).toMatchObject({ class: 'air', branches: ['air-drum'], image: 'gallery/drum.png', training: { route: 'trainer' } });
  });
});

describe('deriveForName carries the derived branch set and the Layer, so the spec assembles synchronously', () => {
  it('for a seeded instrument', async () => {
    const seed = SEED_INSTRUMENTS.find((x) => x.name === 'Air Drum')!;
    await instruments.save(seed.name, seed.layer);
    const d = await deriveForName(seed.name);
    expect(d).not.toBeNull();
    expect(d!.branches).toEqual(['air-drum']);
    expect(d!.category).toBe('air');
    expect(d!.layer).toBeDefined();
    const spec = assembleSpec({ name: seed.name, layer: d!.layer as Record<string, unknown>, derived: { class: d!.category, branches: d!.branches } });
    expect(spec.class).toBe('air');
    expect(spec.features).toEqual(['air-drum']);
  });
});
