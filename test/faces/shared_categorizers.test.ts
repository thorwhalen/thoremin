/**
 * Shared face categorizers (#330 P5): the ids, the shipped index and files, the source that
 * fetches them, the loader that plays a `shared:` id like a saved one, and "copy to my
 * categorizers". The shipped demo is rebuilt from the real recording and compared with the
 * committed file, so it stays exactly what its label says it is.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportCategorizer, importCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import {
  entryModality,
  isSharedId,
  parseSharedIndex,
  readSharedFile,
  SHARED_INDEX_FORMAT,
  sharedId,
  sharedName,
  SHARED_MODALITIES,
  withSlotIds,
} from '@thoremin/ext-faces/lib/shared';
import { copyName, copySharedToMine, createSharedSource } from '@thoremin/ext-faces/app/sharedModels';
import { retryCategorizerPlay, startCategorizerPlay, useCategorizerPlay } from '@thoremin/ext-faces/app/categorizerPlay';
import { replayNode } from '@thoremin/dag';
import type { ExpressionScores } from '@thoremin/sdk/music/expression';
import { faceCategorizerNode } from '@thoremin/ext-faces/nodes/face_categorizer';
import { DEFAULT_FACE_CATEGORIZER } from '@thoremin/ext-faces/schema';
import { RECORDING_FPS, recordedFrames, SEGMENTS } from '../helpers/faceRecording';
import type { FaceModelRecord, SavedFaceModel } from '@thoremin/ext-faces/app/models';
import { categorizerPlay } from '@thoremin/ext-faces/lib/play';
import type { FaceCategorizerPlay } from '@thoremin/ext-faces/lib/play';
import { slugId } from '@thoremin/sdk/util/ids';
import { buildDemoCategorizer, DEMO_ENTRY, SHARED_PUBLIC_DIR, toJson } from '../../scripts/faces/lib_demo_categorizer';
import twoFacesV1 from './fixtures/two_faces.categorizer.json';

/** The version-1 fixture, read as this build reads a file (migrated to the current version). */
const twoFacesRead = importCategorizer(twoFacesV1);
if (!twoFacesRead.ok) throw new Error(twoFacesRead.error);
const twoFaces: PersonalCategorizer = twoFacesRead.categorizer;

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
    const file = twoFaces;
    const renamed = { ...file, categories: file.categories.map((c, i) => ({ ...c, id: `x${i}` })) };
    const r = readSharedFile(exportCategorizer(renamed));
    expect(r.ok && r.categorizer.categories.map((c) => c.id)).toEqual(['cat-1', 'cat-2']);
    expect(withSlotIds(renamed).categories.map((c) => c.label)).toEqual(file.categories.map((c) => c.label));
    expect(readSharedFile({ ...file, modality: 'hand' })).toMatchObject({ ok: false });
    const many = { ...file, samples: Array.from({ length: 13 }, (_, i) => ({ ...file.samples[0], id: `m-${i}` })), categories: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, label: `face ${i}`, members: [`m-${i}`] })), neutral: [] };
    expect(readSharedFile(many)).toMatchObject({ ok: false, error: expect.stringMatching(/more than the 12/) });
  });

  it('every shipped entry is a readable categorizer of its modality, and its file is listed', () => {
    const { entries, error } = parseSharedIndex(read('index.json'));
    expect(error).toBeNull();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const r = readSharedFile(read(`${e.name}.json`), SHARED_MODALITIES[entryModality(e)]);
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

  it('the committed demo file, played on the recording it was made from, reads its faces', async () => {
    const r = readSharedFile(read(`${DEMO_ENTRY.name}.json`));
    if (!r.ok) throw new Error(r.error);
    const play = categorizerPlay({ id: sharedId(DEMO_ENTRY.name), name: DEMO_ENTRY.label, categorizer: r.categorizer });
    const frames = recordedFrames();
    const node = faceCategorizerNode.make(faceCategorizerNode.params.parse({}));
    const read_ = await replayNode(node, { face: frames, model: frames.map(() => play), config: frames.map(() => ({ ...DEFAULT_FACE_CATEGORIZER, id: play.id })) }, { dt: 1 / RECORDING_FPS });
    const names = read_.map((o) => (o.expression as ExpressionScores).personal?.name ?? null);
    const settled = (a: number, b: number) => names.slice(a, b + 1);
    // Well inside each segment (past the tracker's entry), the demo reads what was recorded.
    const mostly = (xs: (string | null)[], name: string) => xs.filter((x) => x === name).length / xs.length;
    expect(mostly(settled(SEGMENTS.smile[0] + 8, SEGMENTS.smile[1] - 4), 'smile')).toBeGreaterThan(0.9);
    expect(mostly(settled(SEGMENTS.open[0] + 8, SEGMENTS.open[1] - 2), 'open smile')).toBeGreaterThan(0.9);
    expect(settled(SEGMENTS.rest[0], SEGMENTS.rest[1]).every((x) => x === null)).toBe(true);
  });
});

describe('the shared source', () => {
  it('lists the shipped index, loads a file once per page as a record with no stills and no tuning', async () => {
    const { source, fetched } = shippedSource();
    const a = await source.load(sharedId(DEMO_ENTRY.name));
    const b = await source.load(sharedId(DEMO_ENTRY.name));
    expect(a).toBe(b);
    expect(a).toMatchObject({ id: 'shared:demo-smile', name: DEMO_ENTRY.label });
    expect(a?.model).not.toHaveProperty('tuning');
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
    // A failed fetch: missing, then playable on a retry once the file is back.
    const flaky = new Set(['categorizers/index.json']);
    const retried = shippedSource(flaky);
    stop();
    const stop2 = startCategorizerPlay({
      load: (id) => retried.source.load(id),
      dial: () => ({ id: dialId }),
      subscribe: () => () => undefined,
      onModelsChanged: () => () => undefined,
      publish: () => undefined,
    });
    await expect.poll(() => useCategorizerPlay.getState().phase).toBe('missing');
    flaky.clear();
    retryCategorizerPlay();
    await expect.poll(() => useCategorizerPlay.getState().phase).toBe('ready');
    stop2();
    retryCategorizerPlay(); // stopped: a no-op
    const stop3 = startCategorizerPlay({
      load: (id) => (isSharedId(id) ? source.load(id) : Promise.resolve(null)),
      dial: () => ({ id: dialId }),
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
      onModelsChanged: () => () => undefined,
      publish: (p) => published.push(p),
    });
    await expect.poll(() => useCategorizerPlay.getState().phase).toBe('ready');
    dialId = 'shared:gone';
    for (const l of listeners) l();
    await expect.poll(() => useCategorizerPlay.getState().phase).toBe('missing');
    expect(published.at(-1)).toBeNull();
    stop3();
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

  it('names the copy so that it replaces none of the player\'s, by name or by slug', () => {
    const taken = (...names: string[]) => names.map((name) => ({ id: slugId(name, 'faces'), name }));
    expect(copyName('Demo', [])).toBe('Demo');
    expect(copyName('Demo', taken('demo'))).toBe('Demo (2)');
    expect(copyName('Demo', taken('Demo', 'Demo (2)'))).toBe('Demo (3)');
    // Different names, one slug: the collection would replace the player's record.
    expect(copyName('Demo: smile and open smile', taken('demo smile and open smile'))).toBe('Demo: smile and open smile (2)');
    expect(copyName('Demo: a', taken('Demo - a', 'demo a 2'))).toBe('Demo: a (3)');
  });

  it('never replaces a player\'s record whose name slugs like the shared label', async () => {
    const { source } = shippedSource();
    const mine = memoryMine();
    const own = await mine.save('demo smile and open smile', { categorizer: { ...twoFaces, name: 'mine' } });
    const copy = await copySharedToMine(sharedId(DEMO_ENTRY.name), source, mine);
    expect(copy?.id).not.toBe(own.id);
    expect(mine.records.get(own.id)?.model.categorizer.name).toBe('mine');
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
    expect(first?.model).toEqual({ categorizer: { ...shared, name: DEMO_ENTRY.label } });
    expect(await copySharedToMine('shared:gone', source, mine)).toBeNull();
  });
});
