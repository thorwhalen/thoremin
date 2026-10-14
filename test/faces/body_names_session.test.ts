/**
 * Default pose names end to end (#383, body-movement B3): a scripted take of a vocabulary's poses
 * through "Your poses" (the session store over the body modality), carved, and named. The
 * acceptance: every category is named for the pose its holds were taken in, no name twice, and a
 * pose outside the vocabulary gets `pose n`. The vocabulary follows the context: standing by
 * default, seated when the take never saw the legs, conductor when asked for (the Conductor
 * tool's entry point), and its choice is kept on the file and by a re-cut.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFaceSessionStore } from '@thoremin/ext-faces/app/sessionStore';
import { exportCategorizer, importCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { unknownVocabulary } from '@thoremin/sdk/enroll/modality';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import type { PoseName } from '../helpers/body_poses';
import { deps, namesByPose, resetPoseClock, STREAM, take } from '../helpers/pose_take';

beforeEach(() => {
  vi.useFakeTimers();
  resetPoseClock();
});
afterEach(() => vi.useRealTimers());

const STANDING: readonly PoseName[] = ['arms up', 'left arm up', 'right arm up', 'arms out', 'hands together', 'lean left', 'lean right', 'crouch'];

describe('Your poses names its categories from the vocabulary of its context', () => {
  it('standing: every pose named for itself, never twice; the rest is Neutral', async () => {
    const store = await take(STANDING);
    const got = namesByPose(store, STANDING);
    for (const g of got) expect(g.label).toBe(g.pose);
    expect(new Set(got.map((g) => g.label)).size).toBe(STANDING.length);
    const c = store.getState().working!;
    expect(c.vocabulary).toBeUndefined();
    expect(c.neutral.length).toBeGreaterThan(0);
  }, 60_000);

  it('a pose outside the vocabulary gets `pose n`', async () => {
    const names: readonly PoseName[] = ['arms up', 'arms forward', 'crouch'];
    const store = await take(names);
    const got = namesByPose(store, names);
    expect(got.find((g) => g.pose === 'arms up')!.label).toBe('arms up');
    expect(got.find((g) => g.pose === 'crouch')!.label).toBe('crouch');
    expect(got.find((g) => g.pose === 'arms forward')!.label).toMatch(/^pose \d+$/);
  }, 60_000);

  it('seated (the legs never seen): the seated set, no crouch', async () => {
    const names: readonly PoseName[] = ['arms up', 'left arm up', 'arms out', 'hands together', 'lean right'];
    const store = await take(names, { legs: false });
    const c = store.getState().working!;
    expect(c.features.some((f) => /knee|thigh|shank/.test(f))).toBe(false);
    for (const g of namesByPose(store, names, false)) expect(g.label).toBe(g.pose);
  }, 60_000);

  it('conductor (asked for): ready, fermata, cut-off; kept on the file, by a re-cut and by an import', async () => {
    const names: readonly PoseName[] = ['ready', 'fermata', 'cut-off'];
    const store = await take(names, { vocabulary: 'conductor' });
    expect(store.getState().vocabulary).toBe('conductor');
    for (const g of namesByPose(store, names)) expect(g.label).toBe(g.pose);
    const c = store.getState().working!;
    expect(c.vocabulary).toBe('conductor');
    // A re-cut names its new categories from the same vocabulary.
    store.getState().setK(2);
    store.getState().setK(3);
    expect(store.getState().working!.categories.map((x) => x.label).sort()).toEqual(['cut-off', 'fermata', 'ready']);
    const back = importCategorizer(exportCategorizer(store.getState().working!));
    expect(back.ok && back.categorizer.vocabulary).toBe('conductor');
    // The choice was this take's: the next one starts from coverage again.
    store.getState().reset();
    expect(store.getState().vocabulary).toBeNull();
  }, 60_000);

  it('an imported file with a vocabulary the body does not have: opened without it, and the notice says so (#465)', async () => {
    const names: readonly PoseName[] = ['ready', 'fermata', 'cut-off'];
    const store = await take(names, { vocabulary: 'conductor' });
    const doc = JSON.parse(exportCategorizer(store.getState().working!));
    // A known id is kept without a word about it.
    expect(store.getState().importFile(JSON.stringify(doc))).toBe(true);
    expect(store.getState().working!.vocabulary).toBe('conductor');
    expect(store.getState().notice).not.toMatch(/vocabulary/);
    expect(store.getState().importFile(JSON.stringify({ ...doc, vocabulary: 'standing' }))).toBe(true);
    expect(store.getState().working!.vocabulary).toBeUndefined();
    expect(store.getState().vocabulary).toBeNull();
    expect(store.getState().notice).toMatch(/"standing" is not one body categorizers have \(conductor\)/);
  }, 60_000);

  it('unknownVocabulary: face and hand have none, so any id is unknown', () => {
    expect(unknownVocabulary(bodyModality, {})).toBeNull();
    expect(unknownVocabulary(bodyModality, { vocabulary: 'conductor' })).toBeNull();
    expect(unknownVocabulary(faceModality, { vocabulary: 'conductor' })).toMatch(/not one face categorizers have, so/);
  });

  it('the vocabulary is chosen before the take, and a reset returns to the choice', async () => {
    const store = createFaceSessionStore(deps(() => ({ kind: 'synthetic', read: () => null, video: () => STREAM, dispose: () => {} })));
    expect(store.getState().vocabulary).toBeNull();
    store.getState().setVocabulary('conductor');
    expect(store.getState().vocabulary).toBe('conductor');
    store.getState().setVocabulary(null);
    expect(store.getState().vocabulary).toBeNull();
  });
});
