// @vitest-environment jsdom
/**
 * Adversarial audit of the localStorage-to-IndexedDB copy (2026-10-20 review lane, #412):
 * the legacy collection can hold two records with one id (two saves of one name at once
 * over the localStorage provider, which checks nothing), and `add` refuses the second, so
 * the whole copy aborted on every page load and the migration never took effect on that
 * device. The copy keeps the first record of an id (what the player was shown) and leaves
 * a record it cannot key out, with a warning; the legacy key itself is never touched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import type { CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { installFakeIndexedDb, type FakeIndexedDb } from '../helpers/fakeIndexedDb';

const KEY = 'thoremin.categorizers';
const MIGRATED_KEY = 'thoremin.categorizers.idbMigrated';
const demo = (): PersonalCategorizer => {
  const r = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
  if (!r.ok) throw new Error(r.error);
  return r.categorizer;
};
const record = (id: string, name: string, createdAt: number): CategorizerRecord => ({ id, name, createdAt, model: { categorizer: { ...demo(), modality: 'face' } } }) as CategorizerRecord;

let idb: FakeIndexedDb | null = null;
beforeEach(() => localStorage.clear());
afterEach(() => {
  idb?.uninstall();
  idb = null;
  vi.restoreAllMocks();
});

async function pageLoad() {
  vi.resetModules();
  const m = await import('@thoremin/sdk-ui/enroll/categorizers');
  return { faces: m.createCategorizerStore(faceModality), m };
}
const storedIds = (): string[] => [...(idb?.data.values() ?? [])].map((r) => (r as { id: string }).id).sort();

describe('the copy into IndexedDB with a damaged legacy collection', () => {
  it('keeps the first record of a duplicated id, completes, and sets the flag', async () => {
    idb = installFakeIndexedDb();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = record('wink', 'Wink', 1);
    const again = { ...record('wink', 'Wink (later)', 2) };
    localStorage.setItem(KEY, JSON.stringify([first, again, record('smile', 'Smile', 3)]));
    const { faces } = await pageLoad();
    const list = await faces.list();
    expect(list.map((r) => r.id).sort()).toEqual(['smile', 'wink']);
    expect(list.find((r) => r.id === 'wink')?.name).toBe('Wink');
    expect(storedIds()).toEqual(['smile', 'wink']);
    expect(localStorage.getItem(MIGRATED_KEY)).not.toBeNull();
    warn.mockRestore();
  });

  it('leaves a record without an id out of the copy (the legacy key keeps it) and still completes', async () => {
    idb = installFakeIndexedDb();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const keyless = { ...record('x', 'No id', 1) } as Record<string, unknown>;
    delete keyless.id;
    localStorage.setItem(KEY, JSON.stringify([record('smile', 'Smile', 3), keyless]));
    const { faces } = await pageLoad();
    expect((await faces.list()).map((r) => r.id)).toEqual(['smile']);
    expect(localStorage.getItem(MIGRATED_KEY)).not.toBeNull();
    expect(storedIds()).toEqual(['smile']); // the copy holds the keyed record only
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no string id'), expect.anything());
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(2); // never touched
    warn.mockRestore();
  });
});
