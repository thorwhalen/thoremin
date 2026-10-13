/**
 * Test and correct a saved face categorizer, end to end through the stores (#330 P3), with the
 * synthetic face and in-memory stores: open a saved one; test it live (the readout settles on
 * each scripted expression, and "none of these" on the rest in reject mode; the test holds its
 * own claim); correct it ("this face is X", a sample moved) and tune it, then save, and the
 * reopened record carries both; export it and import the file back (validated, refused when
 * newer or broken); and merge a new take into it (P1's `mergeSession`, both seeds).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceTestStore } from '@thoremin/ext-faces/app/testStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_EXPRESSIONS, SYNTHETIC_TIMELINE, syntheticPhase } from '@thoremin/ext-faces/lib/synthetic';
import { liveModel } from '@thoremin/ext-faces/lib/live';
import { categoryOf, CORRECTION_CUE } from '@thoremin/ext-faces/lib/corrections';
import { CATEGORIZER_VERSION } from '@thoremin/sdk/enroll/categorizer';
import { SEED_CUE } from '@thoremin/sdk/enroll/from_model';

let clock = 0;
const claims: string[] = [];
const models = () => createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] }));

function sessionDeps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    grab: async (_b, seconds) => seconds.map(() => null),
    models: models(),
    now: () => clock,
    pollMs: 33,
    claim: (on) => claims.push(`session:${on}`),
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

const TAKE_MS = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);

/** A session store with one saved categorizer ("Mine"), open. */
async function savedAndOpen(mode: 'reject' | 'partition' = 'reject') {
  const store = createFaceSessionStore(sessionDeps());
  const s = () => store.getState();
  s().setMode(mode);
  s().start();
  await run(TAKE_MS);
  await s().stop();
  expect(s().phase).toBe('carved');
  expect(s().dirty).toBe(true);
  expect(await s().save('Mine')).toBe(true);
  expect(s().dirty).toBe(false);
  await s().open(s().saved[0].id);
  expect(s().phase).toBe('saved');
  expect(s().working).not.toBeNull();
  return { store, s };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  claims.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('testing a categorizer live', () => {
  it('reads each scripted expression as its category, and the rest as none of these', async () => {
    const { s } = await savedAndOpen('reject');
    const test = createFaceTestStore({ source: () => syntheticSource(() => clock), claim: (on) => claims.push(`test:${on}`), now: () => clock, pollMs: 33, publishMs: 100 });
    const started = clock;
    test.getState().start(liveModel(s().working!, s().tuning));
    expect(test.getState().running).toBe(true);
    expect(claims.at(-1)).toBe('test:true');
    const seen = new Map<string, Set<string>>();
    const cycle = SYNTHETIC_TIMELINE.restMs + 8 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
    for (let t = 0; t < cycle; t += 33) {
      await run(33);
      const r = test.getState().reading;
      // Read only well into a hold (past the glide and the hysteresis).
      const now = syntheticPhase(clock - started);
      const earlier = syntheticPhase(clock - started - 500);
      if (!r || now.mix < 1 || earlier.mix < 1 || earlier.to !== now.to || clock - started < 500) continue;
      const key = SYNTHETIC_EXPRESSIONS[now.to].name;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(r.label ?? (r.rejected ? 'none' : '?'));
    }
    expect(seen.get('rest')).toEqual(new Set(['none']));
    const expressions = [...seen.keys()].filter((k) => k !== 'rest');
    expect(expressions.length).toBeGreaterThanOrEqual(3);
    // Each expression settles on ONE category, and no two share it.
    const labels = expressions.map((k) => [...seen.get(k)!].filter((l) => l !== 'none'));
    for (const l of labels) expect(l.length).toBeLessThanOrEqual(1);
    expect(new Set(labels.flat()).size).toBe(labels.flat().length);
    test.getState().stop();
    expect(test.getState().running).toBe(false);
    expect(claims.at(-1)).toBe('test:false');
  });
});

describe('correcting and tuning', () => {
  it('a live face added, a sample moved, a tuning set: saved together, and reopened', async () => {
    const { s } = await savedAndOpen('reject');
    const before = s().working!;
    const [a, b] = before.categories;
    const face = before.samples[a.members[0]].vector;
    expect(s().correct(a.id, face)).toBe(true);
    expect(s().dirty).toBe(true);
    expect(s().working!.samples).toHaveLength(before.samples.length + 1);
    expect(s().working!.samples.at(-1)!.cue).toBe(CORRECTION_CUE);
    const j = b.members[0];
    expect(s().move(j, a.id)).toBe(true);
    expect(categoryOf(s().working!, j)).toBe(a.id);
    // A refused move says why and changes nothing.
    const lone = s().working!.categories.find((c) => c.members.length === 1);
    if (lone) {
      expect(s().move(lone.members[0], null)).toBe(false);
      expect(s().notice).toMatch(/at least one/);
    }
    s().setTuning({ sensitivity: 1.5, rejectScale: 2, distance: 0.5 });
    expect(s().tuning).toEqual({ sensitivity: 1.5, rejectScale: 2, distance: 0.5 });
    s().setTuning({ sensitivity: 99 });
    expect(s().tuning.sensitivity).toBe(2);
    const id = s().openId!;
    expect(await s().save('Mine')).toBe(true);
    expect(s().dirty).toBe(false);
    s().reset();
    await s().open(id);
    expect(s().working!.samples).toHaveLength(before.samples.length + 1);
    expect(categoryOf(s().working!, j)).toBe(a.id);
    expect(s().tuning).toEqual({ sensitivity: 2, rejectScale: 2, distance: 0.5 });
    expect(s().saved).toHaveLength(1);
  });
});

describe('a categorizer as a file', () => {
  it('exports and imports back unsaved with no pictures; saving keeps it; bad files are refused', async () => {
    const { s } = await savedAndOpen('partition');
    s().setTuning({ sensitivity: 1.5 });
    const file = s().exportFile()!;
    expect(file.name).toBe('Mine');
    const parsed = JSON.parse(file.text);
    expect(parsed.version).toBe(CATEGORIZER_VERSION);
    expect(parsed.tuning).toBeUndefined(); // the room is not part of the file
    s().reset();
    expect(s().importFile(file.text)).toBe(true);
    expect(s().phase).toBe('saved');
    expect(s().openId).toBeNull();
    expect(s().dirty).toBe(true);
    expect(s().hasVideo).toBe(false);
    expect(s().notice).toMatch(/replaces the one you have/);
    expect(s().working!.categories.map((c) => c.label)).toEqual(parsed.categories.map((c: { label: string }) => c.label));
    expect(await s().save('Imported')).toBe(true);
    expect(s().saved.map((m) => m.name).sort()).toEqual(['Imported', 'Mine']);

    expect(s().importFile('{ not json')).toBe(false);
    expect(s().notice).toMatch(/not JSON/);
    expect(s().importFile(JSON.stringify({ ...parsed, version: CATEGORIZER_VERSION + 1 }))).toBe(false);
    expect(s().notice).toMatch(/newer thoremin/);
    expect(s().importFile(JSON.stringify({ ...parsed, k: 99 }))).toBe(false);
    expect(s().notice).toMatch(/invalid categorizer/);
    // A refused import leaves what was open.
    expect(s().working!.name).toBe('Imported');
  });
});

describe('merging a new take (model from a model)', () => {
  it('seed samples: the new faces join the categories, everything already there stays', async () => {
    const { s } = await savedAndOpen('reject');
    const before = s().working!;
    s().startMerge('samples');
    expect(s().phase).toBe('rest');
    expect(s().merging).toBe('samples');
    await run(TAKE_MS);
    await s().stop();
    expect(s().phase).toBe('saved');
    expect(s().merging).toBeNull();
    expect(s().dirty).toBe(true);
    expect(s().notice).toMatch(/^Merged/);
    const merged = s().working!;
    expect(merged.samples.length).toBeGreaterThan(before.samples.length);
    expect(merged.samples.slice(0, before.samples.length)).toEqual(before.samples);
    expect(merged.categories.map((c) => [c.id, c.label])).toEqual(before.categories.map((c) => [c.id, c.label]));
    expect(s().name).toBe('Mine');
    expect(await s().save('Mine')).toBe(true);
    expect(s().saved).toHaveLength(1);
  });

  it('seed centroids: only the categories are kept, learned again from the take', async () => {
    const { s } = await savedAndOpen('reject');
    const before = s().working!;
    s().startMerge('centroids');
    await run(TAKE_MS);
    await s().stop();
    const merged = s().working!;
    expect(merged.samples.slice(0, before.k).every((x) => x.cue === SEED_CUE)).toBe(true);
    expect(merged.samples.length).toBeGreaterThan(before.k);
    expect(merged.categories.map((c) => c.id)).toEqual(before.categories.map((c) => c.id));
  });

  it('an empty merge take changes nothing and returns to the categorizer', async () => {
    const { s } = await savedAndOpen('reject');
    const before = s().working!;
    s().startMerge('samples');
    await run(500);
    await s().stop();
    expect(s().phase).toBe('saved');
    expect(s().working).toEqual(before);
    expect(s().notice).toMatch(/Nothing was merged/);
  });
});
