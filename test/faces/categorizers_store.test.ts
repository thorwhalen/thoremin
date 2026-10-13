// @vitest-environment jsdom
/**
 * One collection for every personal categorizer (#385 E8, #387 C5): `thoremin.categorizers`, read
 * through a view per modality. The expand step: the face collection of before
 * (`thoremin.faceCategorizers`) is copied in once per device, the old key left as it was, and a
 * migrated face categorizer still plays (the instrument's dial names it by the same id).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { importCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { localStorageCollectionProvider } from '@thoremin/sdk-ui/namedCollection';
import {
  CATEGORIZERS_MIGRATED_KEY,
  CATEGORIZERS_STORAGE_KEY,
  LEGACY_FACE_STORAGE_KEY,
  categorizerId,
  createCategorizerStore,
  migrateLegacyFaces,
  type CategorizerRecord,
  type MigrationFlag,
} from '@thoremin/ext-faces/app/categorizers';
import { createFaceModelStore } from '@thoremin/ext-faces/app/models';
import { browserPlayDeps } from '@thoremin/ext-faces/app/categorizerPlay';
import { categorizerPlay } from '@thoremin/ext-faces/lib/play';

const demo = (): PersonalCategorizer => {
  const r = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
  if (!r.ok) throw new Error(r.error);
  return r.categorizer;
};

const memory = () => createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] });
const flag = (): MigrationFlag & { marks: number } => {
  let done = false;
  const f = { marks: 0, done: () => done, mark: () => ((done = true), f.marks++) };
  return f;
};

beforeEach(() => localStorage.clear());

describe('the one categorizer collection', () => {
  it('keeps each modality to its own view, under its own ids', async () => {
    const provider = memory();
    const faces = createCategorizerStore(faceModality, { provider });
    const hands = createCategorizerStore(handModality, { provider });
    const c = demo();
    const face = await faces.save('Smile', { categorizer: c });
    const hand = await hands.save('Smile', { categorizer: { ...c, modality: undefined } });
    expect(face.id).toBe('smile');
    expect(hand.id).toBe('hand:smile');
    expect(categorizerId(handModality, ' A fist! ')).toBe('hand:a-fist');
    expect(hand.model.categorizer.modality).toBe('hand');
    expect((await faces.list()).map((x) => x.id)).toEqual(['smile']);
    expect((await hands.list()).map((x) => x.id)).toEqual(['hand:smile']);
    // A view never loads, replaces or removes another's record.
    expect(await faces.load('hand:smile')).toBeNull();
    await faces.remove('hand:smile');
    expect((await hands.list()).length).toBe(1);
    // Both live in one collection.
    expect((await provider.getList({})).data.length).toBe(2);
  });

  it('copies the old face collection once, and never back after a delete', async () => {
    const legacy = memory();
    const c = demo();
    await legacy.create({ id: 'my-faces', name: 'My faces', createdAt: 5, model: { categorizer: { ...c, modality: undefined } } } as CategorizerRecord);
    await legacy.create({ id: 'broken', name: 'Broken', createdAt: 6, model: { categorizer: { nope: 1 } } } as unknown as CategorizerRecord);
    const target = memory();
    const f = flag();
    expect(await migrateLegacyFaces(target, legacy, f)).toBe(1);
    expect(await migrateLegacyFaces(target, legacy, f)).toBe(0);
    expect(f.marks).toBe(1);
    const faces = createCategorizerStore(faceModality, { provider: target, legacy, flag: f });
    const [rec] = await faces.list();
    expect(rec).toMatchObject({ id: 'my-faces', name: 'My faces', createdAt: 5 });
    expect((await faces.load('my-faces'))!.model.categorizer.modality).toBe('face');
    await faces.remove('my-faces');
    expect(await createCategorizerStore(faceModality, { provider: target, legacy, flag: f }).list()).toEqual([]);
    // The old collection is left as it was (a rollback loses nothing; E10 removes it).
    expect((await legacy.getList({})).data.length).toBe(2);
  });

  it('a face categorizer saved before E8 is found, by the same id, and still plays', async () => {
    const c = demo();
    // As a build before #385 E8 saved it: the face collection's own key, no `modality`.
    await localStorageCollectionProvider<CategorizerRecord>(LEGACY_FACE_STORAGE_KEY).create({ id: 'my-smile', name: 'My smile', createdAt: 1, model: { categorizer: { ...c, modality: undefined } } } as CategorizerRecord);
    expect(localStorage.getItem(CATEGORIZERS_STORAGE_KEY)).toBeNull();

    // The tool's list, the editor section's list and the instrument's resolver all read the new view.
    expect((await createFaceModelStore().list()).map((x) => x.id)).toEqual(['my-smile']);
    expect(localStorage.getItem(CATEGORIZERS_MIGRATED_KEY)).toBe('1');
    const loaded = await browserPlayDeps().load('my-smile');
    expect(loaded).not.toBeNull();
    const play = categorizerPlay({ id: 'my-smile', name: loaded!.name, categorizer: loaded!.model.categorizer, tuning: loaded!.model.tuning });
    expect(play.id).toBe('my-smile');
    expect(play.live.model.categories.map((x) => x.label)).toEqual(c.categories.map((x) => x.label));
    // A hand categorizer saved beside it is not one the face chords can read.
    await createCategorizerStore(handModality).save('Fist', { categorizer: c });
    expect(await browserPlayDeps().load('hand:fist')).toBeNull();
    expect((await createFaceModelStore().list()).map((x) => x.id)).toEqual(['my-smile']);
  });
});
