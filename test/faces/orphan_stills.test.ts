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
import { STILL_SWEEP_FLAG_KEY, orphanStillKeys, resetSweepForTests, sweepOrphanStills, sweepOrphanStillsOnce } from '@thoremin/ext-faces/app/orphanStills';

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
    expect(r).toEqual({ orphans: ['take-old:7', 'take-old:8'], removed: false });
    expect((await thumbs.keys()).length).toBe(ids.length + 2);
  });

  it('removes the orphans when asked, and keeps every referenced still', async () => {
    const { index, thumbs, ids } = await fixture();
    const r = await sweepOrphanStills({ thumbs, index, remove: true });
    expect(r.removed).toBe(true);
    expect((await thumbs.keys()).sort()).toEqual([...ids].sort());
  });

  it('keeps a still while ANY record names it (the count spans the collection)', async () => {
    const { provider, index, thumbs, ids } = await fixture();
    // Delete the face record: the hand record still names the same holds.
    await provider.delete('smile');
    await sweepOrphanStills({ thumbs, index, remove: true });
    expect((await thumbs.keys()).sort()).toEqual([...ids].sort());
    await provider.delete('hand:smile');
    await sweepOrphanStills({ thumbs, index, remove: true });
    expect(await thumbs.keys()).toEqual([]);
  });

  it('does nothing when a record cannot be read', async () => {
    const { provider, index, thumbs, ids } = await fixture();
    await provider.create({ id: 'broken', name: 'broken', createdAt: 1 } as unknown as CategorizerRecord);
    const r = await sweepOrphanStills({ thumbs, index, remove: true });
    expect(r).toEqual({ orphans: [], removed: false });
    expect((await thumbs.keys()).length).toBe(ids.length + 2);
  });

  it('the once-per-page sweep deletes only behind the localStorage flag', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const a = await fixture();
    expect((await sweepOrphanStillsOnce(a.thumbs, { index: a.index }))?.removed).toBe(false);
    expect(info).toHaveBeenCalledTimes(1);
    resetSweepForTests();
    localStorage.setItem(STILL_SWEEP_FLAG_KEY, 'delete');
    expect((await sweepOrphanStillsOnce(a.thumbs, { index: a.index }))?.removed).toBe(true);
    expect((await a.thumbs.keys()).sort()).toEqual([...a.ids].sort());
    info.mockRestore();
  });
});
