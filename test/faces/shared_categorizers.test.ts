/**
 * Shared face categorizers (#330 P5): the ids, the shipped index and files, the source that
 * fetches them, the loader that plays a `shared:` id like a saved one, and "copy to my
 * categorizers". The shipped demo is rebuilt from the real recording and compared with the
 * committed file, so it stays exactly what its label says it is.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import {
  isSharedId,
  parseSharedIndex,
  readSharedFile,
  SHARED_INDEX_FORMAT,
  sharedId,
  sharedName,
  withSlotIds,
} from '@thoremin/ext-faces/lib/shared';
import { copyName, copySharedToMine, createSharedSource } from '@thoremin/ext-faces/app/sharedModels';
import { startCategorizerPlay, useCategorizerPlay } from '@thoremin/ext-faces/app/categorizerPlay';
import type { FaceModelRecord, SavedFaceModel } from '@thoremin/ext-faces/app/models';
import { categorizerPlay } from '@thoremin/ext-faces/lib/play';
import type { FaceCategorizerPlay } from '@thoremin/ext-faces/lib/play';
import { slugId } from '@thoremin/sdk/util/ids';
import { buildDemoCategorizer, DEMO_ENTRY, SHARED_PUBLIC_DIR, toJson } from '../../scripts/faces/lib_demo_categorizer';
import twoFaces from './fixtures/two_faces.categorizer.json';

const read = (file: string): unknown => JSON.parse(readFileSync(join(SHARED_PUBLIC_DIR, file), 'utf8'));

/** A source over the committed `public/categorizers/` files, counting fetches. */
function shippedSource(fail: Set<string> = new Set()) {
  const fetched: string[] = [];
  const source = createSharedSource({
    fetchJson: async (path) => {
      fetched.push(path);
      if (fail.has(path)) throw new Error(`${path}: HTTP 503`);
      return read(path.replace(/^categorizers\//, ''));
    },
  });
  return { source, fetched };
}

describe('shared categorizer ids', () => {
  it('are shared:<name>, and no saved id can be one', () => {
    expect(sharedId('demo-smile')).toBe('shared:demo-smile');
    expect(isSharedId('shared:demo-smile')).toBe(true);
    expect(isSharedId('shared:')).toBe(false);
    expect(isSharedId('general')).toBe(false);
    expect(sharedName('shared:demo-smile')).toBe('demo-smile');
    expect(sharedName('my-faces')).toBeNull();
    // A saved categorizer's id is a slug of its name: it never carries the colon.
    for (const name of ['shared:demo-smile', 'Shared: demo', 'shared']) expect(isSharedId(slugId(name, 'faces'))).toBe(false);
  });
});

describe('the shared index and files', () => {
  it('reads an index, drops a repeated name, and refuses what is not one', () => {
    const entry = { name: 'a', label: 'A' };
    expect(parseSharedIndex({ format: SHARED_INDEX_FORMAT, version: 1, categorizers: [entry, { ...entry, label: 'again' }] }).entries).toEqual([entry]);
    expect(parseSharedIndex({ format: 'other', version: 1, categorizers: [] }).error).not.toBeNull();
    expect(parseSharedIndex({ format: SHARED_INDEX_FORMAT, version: 1, categorizers: [{ name: 'Bad Name', label: 'x' }] }).error).not.toBeNull();
  });

  it('gives a file the dial slot ids in order, and refuses a non-face one or one with too many categories', () => {
    const file = twoFaces as unknown as PersonalCategorizer;
    const renamed = { ...file, categories: file.categories.map((c, i) => ({ ...c, id: `x${i}` })) };
    const r = readSharedFile(exportCategorizer(renamed));
    expect(r.ok && r.categorizer.categories.map((c) => c.id)).toEqual(['cat-1', 'cat-2']);
    expect(withSlotIds(renamed).categories.map((c) => c.label)).toEqual(file.categories.map((c) => c.label));
    expect(readSharedFile({ ...file, modality: 'hand' })).toMatchObject({ ok: false });
    const many = { ...file, k: 13, samples: Array.from({ length: 13 }, () => file.samples[0]), categories: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, label: `face ${i}`, members: [i] })) };
    expect(readSharedFile(many)).toMatchObject({ ok: false, error: expect.stringMatching(/more than the 12/) });
  });

  it('every shipped entry is a readable face categorizer, and its file is listed', () => {
    const { entries, error } = parseSharedIndex(read('index.json'));
    expect(error).toBeNull();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const r = readSharedFile(read(`${e.name}.json`));
      expect(r.ok, e.name).toBe(true);
    }
    const files = readdirSync(SHARED_PUBLIC_DIR).filter((f) => f !== 'index.json').map((f) => f.replace(/\.json$/, ''));
    expect(files.sort()).toEqual(entries.map((e) => e.name).sort());
  });

  it('the demo is labelled a demo and is exactly what the builder makes from the real recording', () => {
    const entry = parseSharedIndex(read('index.json')).entries.find((e) => e.name === DEMO_ENTRY.name);
    expect(entry).toEqual(DEMO_ENTRY);
    expect(entry?.demo).toBe(true);
    expect(entry?.label).toMatch(/^Demo/);
    const committed = readFileSync(join(SHARED_PUBLIC_DIR, `${DEMO_ENTRY.name}.json`), 'utf8');
    expect(committed, 'stale demo: run `npm run faces:demo` and commit').toBe(toJson(buildDemoCategorizer()));
  });

  it('the demo plays: two categories, standing in for two different expressions', () => {
    const r = readSharedFile(read(`${DEMO_ENTRY.name}.json`));
    if (!r.ok) throw new Error(r.error);
    const play = categorizerPlay({ id: sharedId(DEMO_ENTRY.name), name: DEMO_ENTRY.label, categorizer: r.categorizer });
    expect(play.live.model.categories.map((c) => c.label)).toEqual(['smile', 'open smile']);
    expect(new Set(play.standsFor).size).toBe(2);
  });
});

describe('the shared source', () => {
  it('lists the shipped index, loads a file once per page as a record with no stills and no tuning', async () => {
    const { source, fetched } = shippedSource();
    const a = await source.load(sharedId(DEMO_ENTRY.name));
    const b = await source.load(sharedId(DEMO_ENTRY.name));
    expect(a).toBe(b);
    expect(a).toMatchObject({ id: 'shared:demo-smile', name: DEMO_ENTRY.label, model: { takeId: null } });
    expect(a?.model.tuning).toBeUndefined();
    expect(fetched).toEqual(['categorizers/index.json', 'categorizers/demo-smile.json']);
    expect(await source.load('shared:not-listed')).toBeNull();
    expect(await source.load('my-faces')).toBeNull();
  });

  it('a failed fetch is tried again on the next ask', async () => {
    const fail = new Set(['categorizers/index.json']);
    const { source } = shippedSource(fail);
    expect((await source.list()).error).toMatch(/503/);
    expect(await source.load(sharedId(DEMO_ENTRY.name))).toBeNull();
    fail.clear();
    expect((await source.list()).entries.map((e) => e.name)).toContain(DEMO_ENTRY.name);
    expect(await source.load(sharedId(DEMO_ENTRY.name))).not.toBeNull();
  });
});

describe('the instrument loader plays a shared id', () => {
  it('resolves shared:<name> through the shared source, untuned, and an unlisted one as missing', async () => {
    const { source } = shippedSource();
    let dialId = sharedId(DEMO_ENTRY.name);
    const listeners = new Set<() => void>();
    const published: (FaceCategorizerPlay | null)[] = [];
    const stop = startCategorizerPlay({
      load: (id) => (isSharedId(id) ? source.load(id) : Promise.resolve(null)),
      dial: () => ({ id: dialId }),
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
      onModelsChanged: () => () => undefined,
      publish: (p) => published.push(p),
    });
    await expect.poll(() => useCategorizerPlay.getState().phase).toBe('ready');
    expect(useCategorizerPlay.getState().categories.map((c) => c.id)).toEqual(['cat-1', 'cat-2']);
    expect(published.at(-1)?.id).toBe('shared:demo-smile');
    dialId = 'shared:gone';
    for (const l of listeners) l();
    await expect.poll(() => useCategorizerPlay.getState().phase).toBe('missing');
    expect(published.at(-1)).toBeNull();
    stop();
  });
});

describe('copy to my categorizers', () => {
  /** An in-memory stand-in for the player's collection (same name = replace, id = slug). */
  function memoryMine() {
    const records = new Map<string, FaceModelRecord>();
    return {
      records,
      list: async () => [...records.values()].map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt })),
      save: async (name: string, model: SavedFaceModel) => {
        const record: FaceModelRecord = { id: slugId(name, 'faces'), name, createdAt: records.size, model };
        records.set(record.id, record);
        return record;
      },
    };
  }

  it('names the copy so that it replaces none of the player\'s', () => {
    expect(copyName('Demo', [])).toBe('Demo');
    expect(copyName('Demo', ['demo'])).toBe('Demo (2)');
    expect(copyName('Demo', ['Demo', 'Demo (2)'])).toBe('Demo (3)');
  });

  it('saves the same file among the player\'s own, with no stills and the default tuning', async () => {
    const { source } = shippedSource();
    const mine = memoryMine();
    const first = await copySharedToMine(sharedId(DEMO_ENTRY.name), source, mine);
    const second = await copySharedToMine(sharedId(DEMO_ENTRY.name), source, mine);
    expect(first?.name).toBe(DEMO_ENTRY.label);
    expect(second?.name).toBe(`${DEMO_ENTRY.label} (2)`);
    expect(first?.id).not.toBe(second?.id);
    expect(isSharedId(first!.id)).toBe(false);
    const shared = (await source.load(sharedId(DEMO_ENTRY.name)))!.model.categorizer;
    expect(first?.model).toEqual({ categorizer: { ...shared, name: DEMO_ENTRY.label }, takeId: null });
    expect(await copySharedToMine('shared:gone', source, mine)).toBeNull();
  });
});
