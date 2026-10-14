// @vitest-environment jsdom
/**
 * Saved categorizers in IndexedDB (#412): the records of `thoremin.categorizers` outgrew
 * localStorage's shared ~5 MB (a sample is ~2 KB, a record may hold 2000). The EXPAND/MIGRATE
 * step, through the DataProvider seam: on first use every localStorage record is copied into
 * IndexedDB as stored (face, hand and pose records, with their samples' ids that name their
 * stills, a pose's stick figures and supporting frames), the old key is left exactly as it was,
 * and where IndexedDB cannot be used the localStorage records keep working as before.
 *
 * Each case imports the modules fresh (`vi.resetModules`): the default provider settles once
 * per page, so a fresh import is a page load.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importCategorizer, MAX_CATEGORIZER_SAMPLES, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import type { CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { createIdbProvider } from '@thoremin/sdk-ui/idbCollection';
import { installFakeIndexedDb, type FakeIndexedDb } from '../helpers/fakeIndexedDb';

const KEY = 'thoremin.categorizers';
const demo = (): PersonalCategorizer => {
  const r = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
  if (!r.ok) throw new Error(r.error);
  return r.categorizer;
};

/** The demo (85 face samples, support rows, neutral bin) as a record of another modality, the pose
 *  one with a stick figure per sample as a carve writes them. */
const record = (id: string, name: string, c: PersonalCategorizer, createdAt: number): CategorizerRecord =>
  ({ id, name, createdAt, model: { categorizer: c } }) as CategorizerRecord;
const withSkeletons = (c: PersonalCategorizer): PersonalCategorizer => ({
  ...c,
  samples: c.samples.map((s) => ({
    ...s,
    skeleton: { head: [0, 1.4], hip: [0, 0], wrist: [0.4, 0.9] } as Record<string, [number, number]>,
    support: [c.features.map(() => 0.25), c.features.map(() => 0.5)], // a hold's dwell window, one row per frame
  })),
});
const records = (): CategorizerRecord[] => {
  const c = demo();
  return [
    record('my-faces', 'My faces', { ...c, modality: 'face' }, 3),
    record('hand:my-fist', 'My fist', { ...c, modality: 'hand' }, 2),
    record('body:my-poses', 'My poses', { ...withSkeletons(c), modality: 'body' }, 1),
  ];
};

let idb: FakeIndexedDb | null = null;
beforeEach(() => localStorage.clear());
afterEach(() => {
  idb?.uninstall();
  idb = null;
  vi.restoreAllMocks();
});

/** A page load: fresh modules over what the browser holds. */
async function pageLoad() {
  vi.resetModules();
  const m = await import('@thoremin/sdk-ui/enroll/categorizers');
  return {
    faces: m.createCategorizerStore(faceModality),
    hands: m.createCategorizerStore(handModality),
    poses: m.createCategorizerStore(bodyModality),
    index: m.createCategorizerIndex(),
    m,
  };
}
const seedLocalStorage = (rs: CategorizerRecord[]) => localStorage.setItem(KEY, JSON.stringify(rs));
const storedIds = (): string[] => [...(idb?.data.values() ?? [])].map((r) => (r as { id: string }).id).sort();

describe('the expand/migrate step (#412)', () => {
  it('copies face, hand and pose records into IndexedDB as stored, and leaves the old key untouched', async () => {
    idb = installFakeIndexedDb();
    const seeded = records();
    seedLocalStorage(seeded);
    const before = localStorage.getItem(KEY);

    const { faces, hands, poses, m } = await pageLoad();
    expect((await faces.list()).map((r) => r.id)).toEqual(['my-faces']);
    expect((await hands.list()).map((r) => r.id)).toEqual(['hand:my-fist']);
    expect((await poses.list()).map((r) => r.id)).toEqual(['body:my-poses']);

    expect(storedIds()).toEqual(['body:my-poses', 'hand:my-fist', 'my-faces']);
    // The records are the stored ones, sample ids (the stills' keys), stick figures and all.
    const pose = (await poses.load('body:my-poses'))!;
    expect(pose.model.categorizer.samples.map((s) => s.id)).toEqual(seeded[2].model.categorizer.samples.map((s) => s.id));
    expect(pose.model.categorizer.samples[0].skeleton).toEqual({ head: [0, 1.4], hip: [0, 0], wrist: [0.4, 0.9] });
    expect(pose.model.categorizer.samples.some((s) => s.support?.length)).toBe(true);
    // Nothing is deleted from the old store, and the flag says it was done.
    expect(localStorage.getItem(KEY)).toBe(before);
    expect(localStorage.getItem(m.CATEGORIZERS_IDB_MIGRATED_KEY)).toBe('1');
  });

  it('after the copy IndexedDB is the store: saves and deletes land there, the old key never changes, and nothing is copied back', async () => {
    idb = installFakeIndexedDb();
    seedLocalStorage(records());
    const before = localStorage.getItem(KEY);
    const first = await pageLoad();
    await first.faces.save('Wink', { categorizer: demo() });
    await first.faces.remove('my-faces');

    const second = await pageLoad(); // the next page load
    expect((await second.faces.list()).map((r) => r.id)).toEqual(['wink']);
    expect(storedIds()).toEqual(['body:my-poses', 'hand:my-fist', 'wink']);
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it('a record already in IndexedDB is never overwritten by the copy (a second tab, a retried copy)', async () => {
    idb = installFakeIndexedDb();
    const [face] = records();
    seedLocalStorage([face]);
    idb.data.set('my-faces', { ...face, name: 'Edited in IndexedDB' });
    const { faces } = await pageLoad();
    expect((await faces.list()).map((r) => r.name)).toEqual(['Edited in IndexedDB']);
  });

  it('a record that no longer validates is copied too (a migration drops nothing), listed, and deletable', async () => {
    idb = installFakeIndexedDb();
    seedLocalStorage([...records(), { id: 'broken', name: 'Broken', createdAt: 9, model: { categorizer: { nope: 1 } } } as unknown as CategorizerRecord]);
    const { index } = await pageLoad();
    expect((await index.list()).map((r) => r.id)).toContain('broken');
    expect(storedIds()).toContain('broken');
    await index.remove('broken');
    expect(storedIds()).not.toContain('broken');
  });
});

describe('a categorizer at the sample bound (#412)', () => {
  it('saves and reloads through the browser provider', async () => {
    idb = installFakeIndexedDb();
    const c = demo();
    const base = c.samples[0];
    const bulk = Array.from({ length: MAX_CATEGORIZER_SAMPLES - c.samples.length }, (_, i) => ({ ...base, id: `bulk:${i}` }));
    const big: PersonalCategorizer = { ...c, samples: [...c.samples, ...bulk], neutral: [...c.neutral, ...bulk.map((s) => s.id)] };
    expect(big.samples).toHaveLength(MAX_CATEGORIZER_SAMPLES);
    expect(JSON.stringify(big).length).toBeGreaterThan(3_000_000);
    const { faces } = await pageLoad();
    await faces.save('Big', { categorizer: big });
    expect(localStorage.getItem(KEY)).toBeNull(); // nothing is written to the 5 MB budget

    const { faces: reloaded } = await pageLoad();
    expect((await reloaded.load('big'))!.model.categorizer.samples).toHaveLength(MAX_CATEGORIZER_SAMPLES);
  });
});

describe('where IndexedDB cannot be used (#412)', () => {
  it('no IndexedDB: the localStorage records are used as before, and written there', async () => {
    seedLocalStorage(records());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { faces, m } = await pageLoad();
    expect((await faces.list()).map((r) => r.id)).toEqual(['my-faces']);
    await faces.save('Wink', { categorizer: demo() });
    expect((JSON.parse(localStorage.getItem(KEY)!) as { id: string }[]).map((r) => r.id)).toContain('wink');
    expect(localStorage.getItem(m.CATEGORIZERS_IDB_MIGRATED_KEY)).toBeNull(); // retried on the next load
  });

  it('a copy that fails (a full disk): localStorage keeps serving, nothing is lost, the flag is not set', async () => {
    idb = installFakeIndexedDb({ failWrites: true });
    seedLocalStorage(records());
    const before = localStorage.getItem(KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { faces, m } = await pageLoad();
    expect((await faces.list()).map((r) => r.id)).toEqual(['my-faces']);
    expect(localStorage.getItem(KEY)).toBe(before);
    expect(localStorage.getItem(m.CATEGORIZERS_IDB_MIGRATED_KEY)).toBeNull();

    idb.failWrites = false; // the disk has room on the next load: the copy completes
    const { faces: next } = await pageLoad();
    expect((await next.list()).map((r) => r.id)).toEqual(['my-faces']);
    expect(storedIds()).toEqual(['body:my-poses', 'hand:my-fist', 'my-faces']);
  });
});

describe('the IndexedDB DataProvider', () => {
  it('is a zodal DataProvider: create, getOne, update, delete, and a refused duplicate', async () => {
    idb = installFakeIndexedDb();
    const p = createIdbProvider<{ id: string; name: string; n?: number }>({ dbName: 'x' });
    await p.create({ id: 'a', name: 'A' });
    expect(await p.getOne('a')).toEqual({ id: 'a', name: 'A' });
    expect(await p.update('a', { n: 2 })).toEqual({ id: 'a', name: 'A', n: 2 });
    expect(await p.addIfAbsent({ id: 'a', name: 'other' })).toBe(false);
    expect(await p.addIfAbsent({ id: 'b', name: 'B' })).toBe(true);
    expect((await p.getList({ search: 'b' })).data.map((r) => r.id)).toEqual(['b']);
    await p.delete('a');
    await expect(p.getOne('a')).rejects.toThrow(/not found/);
    expect((await p.getList({})).total).toBe(1);
  });
});
