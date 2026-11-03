/**
 * The carve tool's live test hears the categorizer's moving gestures (#954), through the test
 * store, on the scripted waving hand read as the merged live vector (`hand.right.*`), projected
 * as the categorizer reads it: Trying counts each gesture's fires and says while its listener
 * warms; the quiz asks a gesture and takes a fire as the answer (a movement begun in the relax
 * does not answer it); the everyday check counts every fire, under the gesture's name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFaceTestStore } from '@thoremin/ext-faces/app/testStore';
import type { FaceSource } from '@thoremin/ext-faces/app/sources';
import { checkLabels, checkTargets, liveModel } from '@thoremin/sdk/enroll/live';
import { everydayResult } from '@thoremin/sdk/enroll/everyday';
import type { QuizTrial } from '@thoremin/sdk/enroll/quiz';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { FACES } from '../helpers/extensions';
import { withRecordedGesture } from '../helpers/gesture_categorizer';
import { waveTake, type WaveScript } from '../helpers/wave_take';

const POLL_MS = 33;
let clock = 0;

/** A source playing `take`'s frames on the store's clock (each frame under its own stamp). */
function playing(script: Partial<WaveScript>): { source: () => FaceSource; waves: { startMs: number; endMs: number }[]; endMs: number } {
  const take = waveTake({ seed: 4, ...script });
  const frameMs = take.frames[1].t - take.frames[0].t;
  const source = (): FaceSource => ({
    kind: 'synthetic',
    read: () => {
      const f = take.frames[Math.min(take.frames.length - 1, Math.floor(clock / frameMs))];
      return { vector: f.v, t: f.t };
    },
    video: () => null,
    dispose: () => undefined,
  });
  return { source, waves: take.waves, endMs: take.frames.at(-1)!.t };
}

async function runTo(ms: number) {
  while (clock < ms) {
    clock += POLL_MS;
    await vi.advanceTimersByTimeAsync(POLL_MS);
  }
}

const LIVE = liveModel(withRecordedGesture(), {}, { modality: handModality });
const store = (source: () => FaceSource) => createFaceTestStore({ source, claim: () => undefined, now: () => clock, pollMs: POLL_MS, publishMs: 100 });

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => vi.useRealTimers());

describe.runIf(FACES)('the live test hears the gestures (#954)', () => {
  it('the live model carries the gestures, one derivation whatever the tuning; the checks target them after the categories', () => {
    expect(LIVE.gestures?.names).toEqual([{ id: 'gesture-1', label: 'wave' }]);
    expect(LIVE.gestures!.model.gestures.map((g) => g.gesture)).toEqual(['gesture-1']);
    // One derivation per gestures section: a re-tune keeps the very model (and so a listener warm).
    const c = withRecordedGesture();
    expect(liveModel(c, { sensitivity: 1.5 }, { modality: handModality }).gestures).toBe(liveModel(c, {}, { modality: handModality }).gestures);
    const kinds = checkTargets(LIVE).map((t) => t.kind);
    expect(kinds.at(-1)).toBe('gesture');
    expect(kinds.indexOf('gesture')).toBe(LIVE.model.categories.length);
    expect(checkLabels(LIVE).get('gesture-1')).toBe('wave');
  });

  it('Trying: each wave fires once; the listener says it is warming first, then not', async () => {
    const play = playing({ waves: 3, restMs: 2500 });
    const test = store(play.source);
    test.getState().start(LIVE);
    await runTo(POLL_MS * 3);
    expect(test.getState().gesturesWarming).toBe(true);
    await runTo(play.waves[0].startMs);
    expect(test.getState().gesturesWarming).toBe(false);
    await runTo(play.endMs);
    expect(test.getState().gestureFires).toEqual({ 'gesture-1': 3 });
    expect(test.getState().lastGesture).toBe('gesture-1');
    // A re-tune keeps the listener (and its count); stopping clears it.
    test.getState().retune(liveModel(withRecordedGesture(), { sensitivity: 1.2 }, { modality: handModality }));
    expect(test.getState().gestureFires).toEqual({ 'gesture-1': 3 });
    test.getState().stop();
    expect(test.getState().gesturesWarming).toBe(false);
  });

  it('the quiz asks the gesture and a wave after the prompt answers it in time', async () => {
    // The prompt comes after the relax (2 s); the wave starts 1 s later.
    const play = playing({ waves: 1, restMs: 3000 });
    const test = store(play.source);
    let done: readonly QuizTrial[] | null = null;
    test.getState().startQuiz(LIVE, { order: ['gesture-1'], onDone: (trials) => (done = trials) });
    await runTo(play.endMs);
    expect(done).not.toBeNull();
    expect(done![0]).toMatchObject({ categoryId: 'gesture-1', outcome: 'hit' });
    test.getState().stop();
  });

  it('a wave begun in the relax does not answer the prompt', async () => {
    const play = playing({ waves: 1, restMs: 2500 });
    const test = store(play.source);
    let done: readonly QuizTrial[] | null = null;
    // The prompt comes mid-wave (relax 3 s, the wave 2.5 to 3.5 s).
    test.getState().startQuiz(LIVE, { order: ['gesture-1'], relaxMs: 3000, onDone: (trials) => (done = trials) });
    await runTo(3000 + 5500);
    expect(done![0]).toMatchObject({ categoryId: 'gesture-1', outcome: 'miss' });
    test.getState().stop();
  });

  it('the everyday check counts every fire under the gesture\'s name', async () => {
    const play = playing({ waves: 2, restMs: 2000 });
    const test = store(play.source);
    let result: ReturnType<typeof everydayResult> | null = null;
    test.getState().startEveryday(LIVE, { durationMs: play.endMs - POLL_MS, onDone: (check, t) => (result = everydayResult(check, t, checkLabels(LIVE), 'now')) });
    await runTo(play.endMs);
    expect(result).not.toBeNull();
    expect(result!.fires['gesture-1']).toBe(2);
    expect(result!.labels['gesture-1']).toBe('wave');
    test.getState().stop();
  });
});
