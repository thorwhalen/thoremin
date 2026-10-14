/**
 * #385 E7 through the stores, on the synthetic face: a burst recorded under a typed name (a
 * labelled hold) lands in the category of that name at every k; a burst too short takes nothing;
 * a named burst merged into a saved categorizer joins the category of that name. The quiz scores
 * a scripted face (hit, slow, miss) and its result is kept with the saved record; the everyday
 * check counts accidental fires; a per-category size is a tuning kept with the record that changes
 * what the live reader reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceTestStore } from '@thoremin/ext-faces/app/testStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import type { FaceSource } from '@thoremin/ext-faces/app/sources';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE, syntheticExpressionVector } from '@thoremin/ext-faces/lib/synthetic';
import { createLiveReader, liveModel } from '@thoremin/sdk/enroll/live';
import { placeOf } from '@thoremin/sdk/enroll/sorting';
import { QUIZ_DEFAULTS, summarizeQuiz, type QuizTrial } from '@thoremin/sdk/enroll/quiz';
import { everydayResult } from '@thoremin/sdk/enroll/everyday';

let clock = 0;
const models = () => createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] }));

function sessionDeps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: models(),
    now: () => clock,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => `take-${clock}`,
    isoNow: () => '2026-10-13T00:00:00.000Z',
    ...over,
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
}

const { restMs, holdMs, glideMs } = SYNTHETIC_TIMELINE;
const SPAN = holdMs + glideMs;
const CYCLE = 6 * SPAN;
/** When (synthetic ms) the n-th smile (0-based) is fully held. */
const smileAt = (n: number) => restMs + glideMs + 150 + n * CYCLE;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
});
afterEach(() => vi.useRealTimers());

/** Run the store's take to synthetic ms `to` (from the take's start `t0`). */
const until = (t0: number, to: number) => run(Math.max(0, t0 + to - clock));

describe('labelled bursts (#385 E7)', () => {
  it("a named burst's holds land in one category of that name at every k", async () => {
    const store = createFaceSessionStore(sessionDeps());
    const s = () => store.getState();
    s().start();
    const t0 = clock;
    // Two smiles named "grin", each a burst of about 0.8 s; the surprise between is the
    // sampler's, unnamed.
    for (const n of [0, 1]) {
      await until(t0, smileAt(n));
      expect(s().phase).toBe('faces');
      s().setBurstName('grin');
      s().beginBurst();
      expect(s().burst).toMatchObject({ label: 'grin' });
      await run(800);
      const before = s().points;
      s().endBurst();
      expect(s().burst).toBeNull();
      expect(s().points).toBe(before + 1);
    }
    // A burst too short takes nothing, and says so.
    s().setBurstName('');
    const n = s().points;
    s().beginBurst();
    await run(66);
    s().endBurst();
    expect(s().points).toBe(n);
    expect(s().notice).toMatch(/too short/);
    await until(t0, 3 * CYCLE + restMs);
    await s().stop();
    expect(s().phase).toBe('carved');
    const w = s().working!;
    const grin = w.categories.find((c) => c.label === 'grin')!;
    expect(grin).toBeDefined();
    const named = Object.entries(w.pins ?? {}).filter(([, to]) => to === grin.id).map(([id]) => id);
    expect(named).toHaveLength(2);
    const { minK, maxK } = s().view!;
    expect(maxK).toBeGreaterThan(minK);
    for (let k = minK; k <= maxK; k++) {
      s().setK(k);
      const at = s().working!;
      const places = new Set(named.map((id) => placeOf(at, id)));
      expect(places.size, `k=${k}`).toBe(1);
      expect(at.categories.find((c) => c.id === [...places][0])?.label, `k=${k}`).toBe('grin');
    }
  });

  it('a burst from Pause stays paused; a named burst merged into a saved one joins that category', async () => {
    const store = createFaceSessionStore(sessionDeps());
    const s = () => store.getState();
    s().start();
    let t0 = clock;
    await until(t0, restMs + 3 * CYCLE);
    await s().stop();
    const smile = s().working!.categories.find((c) => /happ|smil/i.test(c.label)) ?? s().working!.categories[0];
    expect(await s().save('Mine')).toBe(true);
    await s().open(s().saved[0].id);
    const label = s().working!.categories.find((c) => c.id === smile.id)?.label ?? smile.label;
    s().startMerge('samples');
    t0 = clock;
    await until(t0, smileAt(0) - 400);
    s().pause();
    expect(s().phase).toBe('paused');
    await until(t0, smileAt(0));
    // Named after an existing category, case changed: it joins it.
    s().setBurstName(label.toUpperCase());
    s().beginBurst();
    await run(700);
    s().endBurst();
    expect(s().phase).toBe('paused');
    expect(s().points).toBe(1);
    await s().stop();
    expect(s().phase).toBe('saved');
    const w = s().working!;
    const added = w.samples.find((x) => x.id.startsWith(`take-${t0}`))!;
    expect(added).toBeDefined();
    const cat = w.categories.find((c) => c.members.includes(added.id))!;
    expect(cat.label.toLowerCase()).toBe(label.toLowerCase());
    expect(w.pins?.[added.id]).toBe(cat.id);
  });
});

/** A face that holds whatever the script says now, with the synthetic jitter. */
function scriptedFace(script: () => string): FaceSource {
  let frame = 0;
  return { kind: 'synthetic', read: () => ({ vector: syntheticExpressionVector(script(), frame++), t: clock }), video: () => null, dispose: () => {} };
}

async function savedCategorizer() {
  const store = createFaceSessionStore(sessionDeps());
  const s = () => store.getState();
  s().start();
  await run(restMs + 2 * CYCLE);
  await s().stop();
  expect(await s().save('Mine')).toBe(true);
  await s().open(s().saved[0].id);
  return { store, s };
}

/** Which category the live model reads for a held synthetic expression. */
function categoryFor(live: ReturnType<typeof liveModel>, expression: string): string | null {
  const reader = createLiveReader(live);
  let id: string | null = null;
  for (let f = 0; f < 20; f++) id = reader.push(syntheticExpressionVector(expression, f)).categoryId;
  return id;
}

describe('the quiz on a scripted synthetic face (#385 E7)', () => {
  it('scores hit, slow and miss, and the result is kept with the saved record', async () => {
    const { s } = await savedCategorizer();
    const live = liveModel(s().working!, s().tuning);
    const ids = { smile: categoryFor(live, 'smile'), surprise: categoryFor(live, 'surprise'), frown: categoryFor(live, 'frown') };
    expect(new Set(Object.values(ids)).size).toBe(3);
    expect(Object.values(ids)).not.toContain(null);
    const order = [ids.smile!, ids.surprise!, ids.frown!];
    // The player: rests in the relax; smile at once (hit); surprise after 3 s (slow); a smile
    // when frown is asked (miss).
    let face = 'rest';
    const test = createFaceTestStore({ source: () => scriptedFace(() => face), claim: () => undefined, now: () => clock, pollMs: 33, publishMs: 100 });
    let done: readonly QuizTrial[] | null = null;
    test.getState().startQuiz(live, { order, onDone: (trials) => (done = trials) });
    const answer: Record<string, { face: string; afterMs: number }> = {
      [ids.smile!]: { face: 'smile', afterMs: 200 },
      [ids.surprise!]: { face: 'surprise', afterMs: 3000 },
      [ids.frown!]: { face: 'smile', afterMs: 200 },
    };
    for (let i = 0; i < 900 && !done; i++) {
      await run(33);
      const step = test.getState().quiz?.step;
      if (step?.kind === 'ask') face = step.elapsedMs >= answer[step.categoryId].afterMs ? answer[step.categoryId].face : 'rest';
      else face = 'rest';
    }
    expect(done).not.toBeNull();
    const byId = new Map(done!.map((t) => [t.categoryId, t]));
    expect(byId.get(ids.smile!)).toMatchObject({ outcome: 'hit' });
    expect(byId.get(ids.smile!)!.timeToHitMs!).toBeLessThanOrEqual(QUIZ_DEFAULTS.hitMs);
    expect(byId.get(ids.surprise!)).toMatchObject({ outcome: 'slow' });
    expect(byId.get(ids.frown!)).toMatchObject({ outcome: 'miss', confusedWith: ids.smile });
    // Kept with the categorizer on Save, and read back.
    const labels = new Map(live.model.categories.map((c) => [c.id, c.label]));
    s().setChecks({ quiz: summarizeQuiz(done!, labels, '2026-10-13T00:00:00.000Z') });
    expect(s().dirty).toBe(true);
    expect(await s().save('Mine')).toBe(true);
    const id = s().openId!;
    s().reset();
    await s().open(id);
    expect(s().checks.quiz?.categories[ids.frown!]).toMatchObject({ asked: 1, misses: 1, confusedWith: ids.smile });
    test.getState().stop();
  });

  it('the everyday check counts what fired while the player did other things', async () => {
    const { s } = await savedCategorizer();
    const live = liveModel(s().working!, s().tuning);
    const smile = categoryFor(live, 'smile')!;
    let face = 'rest';
    const test = createFaceTestStore({ source: () => scriptedFace(() => face), claim: () => undefined, now: () => clock, pollMs: 33, publishMs: 100 });
    let result: ReturnType<typeof everydayResult> | null = null;
    test.getState().startEveryday(live, { durationMs: 6000, onDone: (check, t) => (result = everydayResult(check, t, new Map([[smile, 'smile']]), 'now')) });
    // Talking: two brief smiles in six seconds.
    for (let ms = 0; ms < 6500; ms += 33) {
      face = (ms > 1000 && ms < 1600) || (ms > 3500 && ms < 4100) ? 'smile' : 'rest';
      await run(33);
    }
    expect(result).not.toBeNull();
    expect(result!.fires[smile]).toBe(2);
    expect(test.getState().everyday).toMatchObject({ done: true });
    test.getState().stop();
  });

  it("a category's size is a tuning kept with the record that changes what is read", async () => {
    const { s } = await savedCategorizer();
    const live = liveModel(s().working!, s().tuning);
    const smile = categoryFor(live, 'smile')!;
    const label = live.model.categories.find((c) => c.id === smile)!.label;
    const size = (scale: number) => ({ sizes: { [smile]: { scale, label } } });
    s().setTuning(size(2));
    expect(s().tuning.sizes).toEqual({ [smile]: { scale: 2, label } });
    expect(liveModel(s().working!, s().tuning).model.categories.find((c) => c.id === smile)?.scale).toBe(2);
    // Back to 1 is no size at all (the default).
    s().setTuning(size(1));
    expect(s().tuning.sizes).toEqual({});
    s().setTuning(size(0.5));
    expect(await s().save('Mine')).toBe(true);
    const id = s().openId!;
    s().reset();
    await s().open(id);
    expect(s().tuning.sizes).toEqual({ [smile]: { scale: 0.5, label } });
    // A renamed category is another category: the size no longer applies to it.
    s().rename(smile, 'something else');
    expect(liveModel(s().working!, s().tuning).model.categories.find((c) => c.id === smile)?.scale).toBeUndefined();
  });
});

describe('a burst across a pause or a resume (review)', () => {
  it('Resume while a burst from Pause is held: one hold for the burst, and capture goes on', async () => {
    const store = createFaceSessionStore(sessionDeps());
    const s = () => store.getState();
    s().start();
    const t0 = clock;
    await until(t0, smileAt(0) - 300);
    s().pause();
    await until(t0, smileAt(0));
    s().beginBurst();
    await run(400);
    const before = s().points;
    // Space (Resume) with B still down: the burst ends as one hold, then capture resumes.
    s().toggleCapture();
    expect(s().phase).toBe('faces');
    expect(s().burst).toBeNull();
    expect(s().points).toBe(before + 1);
    s().endBurst(); // the key's release, now a no-op
    expect(s().points).toBe(before + 1);
    // The next faces are still taken.
    await until(t0, smileAt(1));
    expect(s().points).toBeGreaterThan(before + 2);
    await s().stop();
    expect(s().phase).toBe('carved');
  });

  it('Stop with a burst held keeps it as a hold', async () => {
    const store = createFaceSessionStore(sessionDeps());
    const s = () => store.getState();
    s().start();
    s().setBurstName('held');
    const t0 = clock;
    await until(t0, restMs + 2 * CYCLE);
    s().beginBurst();
    await run(400);
    await s().stop();
    expect(s().working!.categories.some((c) => c.label === 'held')).toBe(true);
    // A new take starts with no name for its bursts.
    s().reset();
    expect(s().burstName).toBe('');
  });
});
