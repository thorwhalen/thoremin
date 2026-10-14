// @vitest-environment jsdom
/**
 * The orphan sweep of the stills store (#569): a still no saved categorizer's samples name is
 * listed, and removed only when asked; the reference count spans every modality and record; an
 * unreadable record vetoes the whole sweep; the localStorage flag is what turns it on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { importCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { createCategorizerIndex, createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { STILL_SWEEP_FLAG_KEY, STILL_SWEEP_SEEN_KEY, orphanStillKeys, resetSweepForTests, sweepOrphanStills, sweepOrphanStillsOnce } from '@thoremin/ext-faces/app/orphanStills';

const demo = (): PersonalCategorizer => {
  const r = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
  if (!r.ok) throw new Error(r.error);
  return r.categorizer;
};
const blob = () => new Blob(['x']);
const memory = () => createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] });

async function fixture() {
  const provider = memory();
  const c = demo();
  const ids = c.samples.map((s) => s.id);
  await createCategorizerStore(faceModality, { provider, legacy: null }).save('Smile', { categorizer: c });
  // The same holds under a second record (another modality): their stills are shared.
  await createCategorizerStore(handModality, { provider, legacy: null }).save('Smile', { categorizer: { ...c, modality: undefined } });
  const index = createCategorizerIndex({ provider, legacy: null });
  const thumbs = memoryThumbStore();
  for (const id of ids) await thumbs.put(id, blob());
  await thumbs.put('take-old:7', blob());
  await thumbs.put('take-old:8', blob());
  return { provider, index, thumbs, ids };
}

beforeEach(() => {
  localStorage.clear();
  resetSweepForTests();
});

describe('the orphan sweep', () => {
  it('orphanStillKeys is the keys nobody references, sorted', () => {
    expect(orphanStillKeys(['b', 'a', 'c'], new Set(['b']))).toEqual(['a', 'c']);
  });

  it('lists the orphans and deletes nothing by default', async () => {
    const { index, thumbs, ids } = await fixture();
    const r = await sweepOrphanStills({ thumbs, index });
    expect(r).toEqual({ orphans: ['take-old:7', 'take-old:8'], removed: [] });
    expect((await thumbs.keys()).length).toBe(ids.length + 2);
  });

  it('removes only orphans an earlier sweep also found, and keeps every referenced still', async () => {
    const { index, thumbs, ids } = await fixture();
    expect((await sweepOrphanStills({ thumbs, index, remove: true })).removed).toEqual([]);
    const r = await sweepOrphanStills({ thumbs, index, remove: true, seen: new Set(['take-old:7']) });
    expect(r.removed).toEqual(['take-old:7']);
    expect((await thumbs.keys()).sort()).toEqual([...ids, 'take-old:8'].sort());
  });

  it('keeps a still while ANY record names it (the count spans the collection)', async () => {
    const { provider, index, thumbs, ids } = await fixture();
    const seen = new Set(await thumbs.keys());
    // Delete the face record: the hand record still names the same holds.
    await provider.delete('smile');
    await sweepOrphanStills({ thumbs, index, remove: true, seen });
    expect((await thumbs.keys()).sort()).toEqual([...ids].sort());
  });

  it('never deletes when no record is readable while stills exist (a fallen-back collection)', async () => {
    const { provider, index, thumbs, ids } = await fixture();
    const seen = new Set(await thumbs.keys());
    await provider.delete('smile');
    await provider.delete('hand:smile');
    const r = await sweepOrphanStills({ thumbs, index, remove: true, seen });
    expect(r.removed).toEqual([]);
    expect((await thumbs.keys()).length).toBe(ids.length + 2);
  });

  it('never deletes while a record kept outside the collection is not in it', async () => {
    const { index, thumbs, ids } = await fixture();
    const seen = new Set(await thumbs.keys());
    const r = await sweepOrphanStills({ thumbs, index, remove: true, seen, outside: async () => ['legacy-only'] });
    expect(r.removed).toEqual([]);
    expect((await thumbs.keys()).length).toBe(ids.length + 2);
  });

  it('does nothing when a record cannot be read', async () => {
    const { provider, index, thumbs, ids } = await fixture();
    await provider.create({ id: 'broken', name: 'broken', createdAt: 1 } as unknown as CategorizerRecord);
    const r = await sweepOrphanStills({ thumbs, index, remove: true, seen: new Set(await thumbs.keys()) });
    expect(r).toEqual({ orphans: [], removed: [] });
    expect((await thumbs.keys()).length).toBe(ids.length + 2);
  });

  it('the once-per-page sweep remembers orphans, and deletes them on a later page only behind the flag', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const a = await fixture();
    const opts = { index: a.index, outside: async () => [] as string[] };
    // Page 1, flag set: the orphans were not seen before, so none goes.
    localStorage.setItem(STILL_SWEEP_FLAG_KEY, 'delete');
    expect((await sweepOrphanStillsOnce(a.thumbs, opts))?.removed).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STILL_SWEEP_SEEN_KEY)!)).toEqual(['take-old:7', 'take-old:8']);
    // Page 2, flag off: listed, nothing goes.
    resetSweepForTests();
    localStorage.removeItem(STILL_SWEEP_FLAG_KEY);
    expect((await sweepOrphanStillsOnce(a.thumbs, opts))?.removed).toEqual([]);
    // Page 3, flag set: they go.
    resetSweepForTests();
    localStorage.setItem(STILL_SWEEP_FLAG_KEY, 'delete');
    expect((await sweepOrphanStillsOnce(a.thumbs, opts))?.removed).toEqual(['take-old:7', 'take-old:8']);
    expect((await a.thumbs.keys()).sort()).toEqual([...a.ids].sort());
    info.mockRestore();
  });
});
