/**
 * Recording a named gesture into a hand categorizer, through the session store (#754): the
 * scripted waving hand (`?carve.source=synthetic`'s gesture source), the rest, "Do the wave 5
 * times", the repetitions joining the working categorizer as one undoable edit; the Gestures
 * section's edits; Save and reopen showing the same chips (a fresh carve and a reopened one behave
 * alike); Cancel and Stop.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { memoryThumbStore, type FrameOpener } from '@thoremin/ext-faces/app/thumbnails';
import { HAND_GESTURE_SCRIPT, HAND_SCRIPT, type FaceSource } from '@thoremin/ext-faces/app/sources';
import { handModalityUi } from '@thoremin/ext-faces/app/handModality';
import { gestureCards } from '@thoremin/ext-faces/lib/gestureView';
import { gestureCue } from '@thoremin/ext-faces/lib/gestureTake';
import { SYNTHETIC_GESTURE } from '@thoremin/ext-faces/lib/synthetic_gesture';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { exportCategorizer, gestureFrameCount, MAX_GESTURE_FRAMES } from '@thoremin/sdk/enroll/categorizer';
import { TAKE_ROOM_DEFAULTS } from '@thoremin/sdk/enroll/gestures';
import { FACES } from '../helpers/extensions';

let clock = 0;
const frames: FrameOpener = () => ({ grab: async () => null, close: () => {} });
const memory = () => createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] });
const DEMO = readFileSync(join(process.cwd(), 'public/categorizers/demo-hand-shapes.json'), 'utf8');

/** A scripted source on the fake clock, from when it is opened. */
const scripted = (script: typeof HAND_SCRIPT) => (): FaceSource => {
  const start = clock;
  let frame = 0;
  return { kind: 'synthetic', read: () => ({ vector: script.vectorAt(clock - start, frame++), t: clock }), video: () => null, dispose: () => {} };
};

const claims: boolean[] = [];
function deps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source: scripted(HAND_SCRIPT),
    gestureSource: scripted(HAND_GESTURE_SCRIPT),
    thumbs: memoryThumbStore(),
    frames,
    region: handModalityUi.region,
    models: createCategorizerStore(handModality, { provider: memory() }),
    modality: handModality,
    now: () => clock,
    pollMs: 33,
    claim: (on) => claims.push(on),
    newTakeId: () => 'take-g',
    isoNow: () => '2026-11-03T00:00:00.000Z',
    ...over,
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
}

/** Long enough for the rest, its beat and five repetitions of the scripted wave. */
const TAKE_MS = SYNTHETIC_GESTURE.restMs + 6 * (SYNTHETIC_GESTURE.repetitionMs + SYNTHETIC_GESTURE.pauseMs);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  claims.length = 0;
});
afterEach(() => vi.useRealTimers());

/** A store with the demo hand categorizer open (phase `saved`). */
function opened(over: Partial<FaceSessionDeps> = {}) {
  const store = createFaceSessionStore(deps(over));
  expect(store.getState().importFile(DEMO)).toBe(true);
  expect(store.getState().phase).toBe('saved');
  return store;
}

describe.runIf(FACES)('a named gesture recorded into the working categorizer', () => {
  it('the prompt is a gesture cue over the hand\'s positions; a face records none', () => {
    const cue = gestureCue(handModality, { id: 'c', name: ' wave ' });
    expect(cue.instruction).toBe('Do the wave 5 times; pause between.');
    expect(cue.gesture).toBe('wave');
    expect(cue.collects.groups).toEqual(['hand.position.raw']);
    expect(() => gestureCue(faceModality, { id: 'c', name: 'nod' })).toThrow();
    const face = createFaceSessionStore(deps({ modality: faceModality, models: createCategorizerStore(faceModality, { provider: memory() }) }));
    expect(face.getState().recordGesture('nod')).toBe(false);
  });

  it('rest, then five waves: one undoable edit, claimed while live, the same chips after Save and reopen', async () => {
    const store = opened();
    const before = store.getState().working!;
    const s = () => store.getState();
    expect(s().recordGesture('wave')).toBe(true);
    expect(s().phase).toBe('gesture');
    expect(s().gesture).toMatchObject({ name: 'wave', step: 'rest', count: 0, target: 5 });
    expect(claims).toEqual([true]);
    await run(SYNTHETIC_GESTURE.restMs);
    expect(s().gesture?.step).toBe('gesture');
    expect(s().gesture?.say).toBe('Do the wave 5 times; pause between.');
    await run(TAKE_MS - SYNTHETIC_GESTURE.restMs);
    // Enough at five: the take ends by itself and the waves join the document.
    expect(s().phase).toBe('saved');
    expect(claims).toEqual([true, false]);
    const g = s().working!.gestures!.items;
    expect(g.map((x) => [x.id, x.label, x.traces.length])).toEqual([['gesture-1', 'wave', 5]]);
    expect(g[0].features.every((f) => f.endsWith('.x') || f.endsWith('.y'))).toBe(true);
    expect(s().notice).toMatch(/^Added 5 repetitions of "wave"\./);
    expect(s().dirty).toBe(true);
    // Undo returns the categorizer as it was; redo the gestures.
    s().undo();
    expect(s().working).toEqual(before);
    s().redo();
    expect(s().working!.gestures!.items).toHaveLength(1);
    const fresh = gestureCards(s().working!);
    expect(fresh[0].traces).toHaveLength(5);
    expect(fresh[0].traces[0].points.length).toBeGreaterThan(2);
    // One gesture of five alike repetitions, nothing to confuse it with.
    expect(fresh[0].chip).toMatchObject({ grade: 'distinct', word: 'distinct' });
    // Saved and reopened: the same document, the same chips.
    const kept = s().working!.gestures;
    expect(await s().save('Shapes and waves')).toBe(true);
    const [saved] = s().saved;
    await s().open(saved.id);
    expect(s().phase).toBe('saved');
    expect(s().working!.gestures).toEqual(kept);
    expect(gestureCards(s().working!)).toEqual(fresh);
  }, 60_000);

  it('the Gestures edits: record more, rename, drop a repetition, merge, delete, each undoable', async () => {
    const store = opened();
    const s = () => store.getState();
    s().recordGesture('wave');
    await run(TAKE_MS);
    expect(s().recordMoreGesture('gesture-1')).toBe(true);
    expect(s().gesture).toMatchObject({ name: 'wave', into: 'gesture-1' });
    await run(TAKE_MS);
    const traces = s().working!.gestures!.items[0].traces;
    expect(traces).toHaveLength(10);
    expect(new Set(traces.map((t) => t.id)).size).toBe(10);
    expect(s().renameGesture('gesture-1', 'hello')).toBe(true);
    expect(s().working!.gestures!.items[0].label).toBe('hello');
    expect(s().dropGestureTrace('gesture-1', traces[0].id)).toBe(true);
    expect(s().working!.gestures!.items[0].traces).toHaveLength(9);
    s().recordGesture('wave two');
    await run(TAKE_MS);
    expect(s().working!.gestures!.items.map((g) => g.label)).toEqual(['hello', 'wave two']);
    expect(s().mergeGestures('gesture-2', 'gesture-1')).toBe(true);
    expect(s().working!.gestures!.items.map((g) => [g.label, g.traces.length])).toEqual([['hello', 14]]);
    s().undo();
    expect(s().working!.gestures!.items).toHaveLength(2);
    expect(s().deleteGesture('gesture-2')).toBe(true);
    expect(s().deleteGesture('gesture-1')).toBe(true);
    expect(s().working!.gestures).toBeUndefined();
    expect(s().renameGesture('gesture-1', 'x')).toBe(false);
  }, 120_000);

  it('Record more is refused when the take BEGINS if its repetitions might not fit the file (#954 review)', async () => {
    const store = opened();
    const s = () => store.getState();
    s().recordGesture('wave');
    await run(TAKE_MS);
    const c = s().working!;
    const g = c.gestures!.items[0];
    const perTrace = g.traces[0].rows.length;
    // Copies of the first repetition up to just under the bound, less than a take's worth of room.
    const room = Math.ceil((5 * TAKE_ROOM_DEFAULTS.maxTraceMs * TAKE_ROOM_DEFAULTS.fps) / 1000);
    const copies = Math.floor((MAX_GESTURE_FRAMES - room / 2) / perTrace);
    const full = { ...c, gestures: { ...c.gestures!, items: [{ ...g, traces: Array.from({ length: copies }, (_, i) => ({ ...g.traces[0], id: `copy#${i}` })) }] } };
    expect(gestureFrameCount(full.gestures)).toBeLessThanOrEqual(MAX_GESTURE_FRAMES);
    expect(s().importFile(exportCategorizer(full))).toBe(true);
    expect(s().recordMoreGesture('gesture-1')).toBe(false);
    expect(s().phase).toBe('saved');
    expect(s().notice).toMatch(/^Not recorded: the gestures already hold \d+ frames of movement/);
  }, 120_000);

  it('Stop keeps what was cut; Cancel (or closing the tool) keeps nothing and returns as it was', async () => {
    const store = opened();
    const s = () => store.getState();
    s().recordGesture('wave');
    await run(SYNTHETIC_GESTURE.restMs + 3 * (SYNTHETIC_GESTURE.repetitionMs + SYNTHETIC_GESTURE.pauseMs));
    const cut = s().gesture!.count;
    expect(cut).toBeGreaterThanOrEqual(2);
    s().finishGesture();
    expect(s().phase).toBe('saved');
    expect(s().working!.gestures!.items[0].traces).toHaveLength(cut);
    expect(s().notice).toContain('5 were asked for');
    const before = s().working;
    s().recordGesture('nod');
    await run(SYNTHETIC_GESTURE.restMs);
    s().cancelRecording();
    expect(s().phase).toBe('saved');
    expect(s().working).toBe(before);
    expect(s().notice).toBe('The gesture take was stopped. Nothing was added.');
    expect(claims.at(-1)).toBe(false);
    // A rest with no movement cuts nothing: Stop says so and adds nothing.
    s().recordGesture('still');
    await run(1000);
    s().finishGesture();
    expect(s().working).toBe(before);
    expect(s().notice).toMatch(/No repetition of "still" was cut/);
  }, 60_000);
});
