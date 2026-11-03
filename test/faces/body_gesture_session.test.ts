/**
 * "Your poses" records a named moving gesture as "Your hand shapes" does (#954): the body modality's
 * `gestureCollects` (its positions), the scripted body waving its right arm
 * (`?carve.source=synthetic`'s gesture source), through the very same session store, take and
 * edits as the hand's; and the live test then hears the recorded gesture on another scripted wave.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceTestStore } from '@thoremin/ext-faces/app/testStore';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { memoryThumbStore, type FrameOpener } from '@thoremin/ext-faces/app/thumbnails';
import { BODY_GESTURE_SCRIPT, BODY_SCRIPT, type FaceSource } from '@thoremin/ext-faces/app/sources';
import { gestureCards } from '@thoremin/ext-faces/lib/gestureView';
import { gestureCue, recordsGestures } from '@thoremin/ext-faces/lib/gestureTake';
import { SYNTHETIC_BODY_GESTURE } from '@thoremin/ext-faces/lib/synthetic_gesture';
import { liveModel } from '@thoremin/sdk/enroll/live';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { BODY_GESTURE_GROUPS } from '@thoremin/sdk/features/body_groups';
import { FACES } from '../helpers/extensions';

const POLL_MS = 33;
let clock = 0;
const frames: FrameOpener = () => ({ grab: async () => null, close: () => {} });
const memory = () => createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] });
const DEMO = readFileSync(join(process.cwd(), 'public/categorizers/demo-poses.json'), 'utf8');

/** A scripted source on the fake clock, from when it is opened (each read its own frame). */
const scripted = (script: typeof BODY_SCRIPT) => (): FaceSource => {
  const start = clock;
  let frame = 0;
  return { kind: 'synthetic', read: () => ({ vector: script.vectorAt(clock - start, frame++), t: clock }), video: () => null, dispose: () => {} };
};

function deps(): FaceSessionDeps {
  return {
    source: scripted(BODY_SCRIPT),
    gestureSource: scripted(BODY_GESTURE_SCRIPT),
    thumbs: memoryThumbStore(),
    frames,
    models: createCategorizerStore(bodyModality, { provider: memory() }),
    modality: bodyModality,
    now: () => clock,
    pollMs: POLL_MS,
    claim: () => undefined,
    newTakeId: () => 'take-b',
    isoNow: () => '2026-11-03T00:00:00.000Z',
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += POLL_MS) {
    clock += POLL_MS;
    await vi.advanceTimersByTimeAsync(POLL_MS);
  }
}

/** Long enough for the rest, its beat and five repetitions of the scripted wave. */
const TAKE_MS = SYNTHETIC_BODY_GESTURE.restMs + 6 * (SYNTHETIC_BODY_GESTURE.repetitionMs + SYNTHETIC_BODY_GESTURE.pauseMs);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
});
afterEach(() => vi.useRealTimers());

describe.runIf(FACES)('a body gesture, recorded and heard (#954)', () => {
  it('the body records gestures, through its positions', () => {
    expect(recordsGestures(bodyModality)).toBe(true);
    const cue = gestureCue(bodyModality, { id: 'c', name: 'wave' });
    expect(cue.collects).toMatchObject({ groups: [...BODY_GESTURE_GROUPS], omit: [] });
  });

  it('Your poses: rest, five waves of the arm, one undoable edit; the live test then hears a wave', async () => {
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(s().importFile(DEMO)).toBe(true);
    expect(s().phase).toBe('saved');
    const before = s().working!;
    expect(s().recordGesture('wave')).toBe(true);
    await run(TAKE_MS);
    expect(s().phase).toBe('saved');
    const g = s().working!.gestures!.items;
    expect(g.map((x) => [x.id, x.label, x.traces.length])).toEqual([['gesture-1', 'wave', 5]]);
    expect(g[0].features.length).toBeGreaterThan(0);
    expect(g[0].features.every((f) => f.startsWith('body.pos.'))).toBe(true);
    expect(gestureCards(s().working!)[0].chip).toMatchObject({ grade: 'distinct' });
    s().undo();
    expect(s().working).toEqual(before);
    s().redo();

    // The live test, on another scripted wave of the body.
    const live = liveModel(s().working!, {}, { modality: bodyModality });
    expect(live.gestures?.names).toEqual([{ id: 'gesture-1', label: 'wave' }]);
    const test = createFaceTestStore({ source: scripted(BODY_GESTURE_SCRIPT), claim: () => undefined, now: () => clock, pollMs: POLL_MS, publishMs: 100 });
    test.getState().start(live);
    await run(SYNTHETIC_BODY_GESTURE.restMs + 3 * (SYNTHETIC_BODY_GESTURE.repetitionMs + SYNTHETIC_BODY_GESTURE.pauseMs));
    expect(test.getState().gestureFires['gesture-1']).toBe(3);
    test.getState().stop();
  }, 60_000);
});
