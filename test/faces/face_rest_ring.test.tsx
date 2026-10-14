// @vitest-environment jsdom
/**
 * The rest's progress ring (#403; design C.2): the rest ends by itself once it has its 3 s and
 * its 60 frames in view, and the ring shows how far along it is; moving during it says "stay
 * relaxed". The take's `restProgress` and `restMotion`, and the panel: Tools -> Your
 * faces -> "Record my faces" -> "Start capturing" shows the ring at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, FACE_SESSION_DEFAULTS, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource, FACE_SCRIPT } from '@thoremin/ext-faces/app/sources';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { createFaceTake, FACE_TAKE_DEFAULTS } from '@thoremin/ext-faces/lib/take';
import { syntheticExpressionVector } from '@thoremin/ext-faces/lib/synthetic';
import { syntheticBodyVector } from '@thoremin/ext-faces/lib/synthetic_body';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { recordedFrames, SEGMENTS, vectorOf } from '../helpers/faceRecording';
import '@/app/dials/useDialsSettings'; // the dials host the panel's "Play it" reads

const FRAME_MS = 33;
let clock = 1000;

/** A face at rest, except while `moving(ms since the source began)` says it smiles. */
function restingSource(moving: (ms: number) => boolean = () => false) {
  return syntheticSource(() => clock, {
    ...FACE_SCRIPT,
    vectorAt: (ms, frame) => syntheticExpressionVector(moving(ms) ? 'smile' : 'rest', frame),
  });
}

function deps(source = restingSource()): FaceSessionDeps {
  return {
    source: () => ({ ...source, video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: FRAME_MS,
    claim: () => undefined,
    newTakeId: () => 'take-1',
    isoNow: () => '2026-10-14T00:00:00.000Z',
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += FRAME_MS) {
    clock += FRAME_MS;
    await act(() => vi.advanceTimersByTimeAsync(FRAME_MS));
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clock = 1000;
});

describe("the take's rest progress", () => {
  it('is the lesser of its time and its frames in view, and null outside the rest', () => {
    const take = createFaceTake();
    expect(take.restProgress()).toBeNull();
    take.explore(0);
    expect(take.restProgress()).toBeNull();
    take.start(0);
    expect(take.restProgress()).toBe(0);
    // Fast frames: the frames fill first, the time decides.
    let t = 0;
    for (let f = 0; f < FACE_TAKE_DEFAULTS.minRestFrames; f++) take.push(syntheticExpressionVector('rest', f), (t += 10));
    expect(take.restProgress()).toBeCloseTo(t / FACE_TAKE_DEFAULTS.restMs, 6);
    // Time passes with the face out of view: still 60 of 60 frames, so the time decides.
    take.push({}, FACE_TAKE_DEFAULTS.restMs - 300);
    expect(take.restProgress()).toBeCloseTo(1 - 300 / FACE_TAKE_DEFAULTS.restMs, 6);
    // Both met: the rest is over (no setup steps for a face), the faces begin.
    take.push({}, FACE_TAKE_DEFAULTS.restMs);
    expect(take.phase()).toBe('faces');
    expect(take.restProgress()).toBeNull();
  });

  it('waits for frames when the face is missing for part of the rest', () => {
    const take = createFaceTake();
    take.start(0);
    for (let f = 0; f < 20; f++) take.push(syntheticExpressionVector('rest', f), f * FRAME_MS);
    take.push({}, FACE_TAKE_DEFAULTS.restMs + 500);
    expect(take.phase()).toBe('rest');
    expect(take.restProgress()).toBeCloseTo(20 / FACE_TAKE_DEFAULTS.minRestFrames, 6);
  });
});

describe("the take's rest motion", () => {
  it('is the largest feature off the rest so far, in noise units; a brief movement does not move the rest', () => {
    const take = createFaceTake();
    take.explore(0);
    take.push(syntheticExpressionVector('rest', 0), 1);
    expect(take.restMotion()).toBeNull(); // exploring
    take.start(10);
    let t = 10;
    let f = 1;
    take.push(syntheticExpressionVector('rest', f++), (t += FRAME_MS));
    expect(take.restMotion()).toBeNull(); // no unit yet
    for (let i = 0; i < 40; i++) take.push(syntheticExpressionVector('rest', f++), (t += FRAME_MS));
    const still = take.restMotion()!;
    expect(still).toBeLessThan(FACE_SESSION_DEFAULTS.restMovingAt);
    take.push(syntheticExpressionVector('smile', f++), (t += FRAME_MS));
    expect(take.restMotion()!).toBeGreaterThan(FACE_SESSION_DEFAULTS.restMovingAt);
    take.push(syntheticExpressionVector('rest', f++), (t += FRAME_MS));
    expect(take.restMotion()!).toBeLessThan(FACE_SESSION_DEFAULTS.restMovingAt);
    take.push({}, (t += FRAME_MS));
    expect(take.restMotion()).toBeNull(); // no face in the last frame
  });
});

describe('what the rest motion measures (#403 review)', () => {
  /** A take `n` frames into a still synthetic rest. */
  function restingTake(n = 45) {
    const take = createFaceTake();
    take.start(0);
    for (let f = 0; f < n; f++) take.push(syntheticExpressionVector('rest', f), (f + 1) * FRAME_MS);
    return take;
  }

  it('reads only the features the carve uses: a glance or a lean is not a movement', () => {
    const take = restingTake();
    expect(take.restMotion()!).toBeLessThan(FACE_SESSION_DEFAULTS.restMovingAt);
    const t = 46 * FRAME_MS;
    take.push({ ...syntheticExpressionVector('rest', 46), 'face.gaze.x': 0.3, 'face.head.x': 0.2 }, t);
    expect(take.restMotion()!).toBeLessThan(FACE_SESSION_DEFAULTS.restMovingAt);
  });

  it('settling into the rest does not blunt it: a smile after a moving first second still reads', () => {
    const take = createFaceTake();
    take.start(0);
    let f = 0;
    for (; f < 30; f++) take.push(syntheticExpressionVector(f % 6 < 3 ? 'smile' : 'surprise', f), (f + 1) * FRAME_MS);
    for (; f < 80; f++) take.push(syntheticExpressionVector('rest', f), (f + 1) * FRAME_MS);
    expect(take.restMotion()!).toBeLessThan(FACE_SESSION_DEFAULTS.restMovingAt);
    take.push(syntheticExpressionVector('smile', f), (f + 1) * FRAME_MS);
    expect(take.restMotion()!).toBeGreaterThan(FACE_SESSION_DEFAULTS.restMovingAt);
  });

  it('the recorded face: still through its rest, moving at its smile', () => {
    const frames = recordedFrames();
    // The recording's first frames settle in (the mouth moves; that is a movement, and reads as
    // one); from frame 9 to 14 the face is still (the smile begins to show from 15). Those frames played back and forth,
    // their own jitter, for 3 s.
    const rest = frames.slice(9, 15).map(vectorOf);
    expect(15).toBeLessThan(SEGMENTS.smile[0]);
    const loop = [...rest, ...rest.slice(1, -1).reverse()];
    const take = createFaceTake();
    take.start(0);
    let t = 0;
    let most = 0;
    for (let f = 0; f < 60; f++) {
      take.push(loop[f % loop.length], (t += FRAME_MS));
      most = Math.max(most, take.restMotion() ?? 0);
    }
    expect(take.phase()).toBe('rest');
    expect(most).toBeLessThan(FACE_SESSION_DEFAULTS.restMovingAt);
    take.push(vectorOf(frames[18]), (t += FRAME_MS));
    expect(take.restMotion()!).toBeGreaterThan(FACE_SESSION_DEFAULTS.restMovingAt);
  });

  it('a body take: the ring is the rest only, never the nuisance steps after it', () => {
    const take = createFaceTake({ modality: bodyModality });
    take.start(0);
    let t = 0;
    let f = 0;
    while (take.setupStep() === 0 && f < 300) {
      expect(take.restProgress()).not.toBeNull();
      take.push(syntheticBodyVector(0, f++), (t += FRAME_MS));
    }
    expect(take.phase()).toBe('rest');
    expect(take.setupStep()).toBe(1);
    expect(take.restProgress()).toBeNull();
    expect(take.restMotion()).toBeNull();
  });
});

describe('the rest ring in the panel', () => {
  it('fills during the rest, says "stay relaxed" when the face moves, and gives way to the hold ring', async () => {
    vi.useFakeTimers();
    // The face smiles for half a second, from about 1.1 s into the rest.
    const store = createFaceSessionStore(deps(restingSource((ms) => ms >= 1200 && ms < 1700)));
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    act(() => store.getState().explore());
    await run(100);
    // Click 3 from a cold load (Tools, Your faces, Record my faces, then this).
    fireEvent.click(screen.getByRole('button', { name: /Start capturing/ }));
    const ring = () => screen.queryByRole('progressbar', { name: 'Rest progress' });
    expect(ring()).not.toBeNull();
    expect(screen.queryByText(/Stay relaxed/)).toBeNull();

    await run(1000);
    const early = Number(ring()!.getAttribute('aria-valuenow'));
    expect(early).toBeGreaterThan(20);
    expect(early).toBeLessThan(45);
    const tone = () => ring()!.closest('[data-progress-tone]')!.getAttribute('data-progress-tone');
    expect(tone()).toBe('normal');

    // Into the smile (past its 0.3 s): "stay relaxed", held a second past it, then calm again.
    await run(500);
    expect(screen.getByText(/Stay relaxed/)).toBeTruthy();
    expect(tone()).toBe('warn');
    await run(FACE_SESSION_DEFAULTS.restMovingHoldMs + 200);
    expect(screen.queryByText(/Stay relaxed/)).toBeNull();
    expect(Number(ring()!.getAttribute('aria-valuenow'))).toBeGreaterThan(early);

    // The rest ends by itself; the ring gives way to the hold ring.
    await run(1500);
    expect(store.getState().phase).toBe('faces');
    expect(ring()).toBeNull();
    expect(document.querySelector('[data-hold-ring]')).not.toBeNull();
    store.getState().cancelRecording();
  });

  it('a still rest, a blink in it, never says "stay relaxed"', async () => {
    vi.useFakeTimers();
    const blink = (ms: number) => ms >= 1600 && ms < 1660; // two frames
    const source = syntheticSource(() => clock, {
      ...FACE_SCRIPT,
      vectorAt: (ms, frame) => {
        const v = syntheticExpressionVector('rest', frame);
        return blink(ms) ? { ...v, 'face.blendshape.eye.blinkLeft': 1, 'face.blendshape.eye.blinkRight': 1 } : v;
      },
    });
    const store = createFaceSessionStore(deps(source));
    store.getState().explore();
    await run(100);
    store.getState().start();
    const seen: boolean[] = [];
    const off = store.subscribe((s) => seen.push(s.restMoving));
    await run(FACE_TAKE_DEFAULTS.restMs + 300);
    off();
    expect(store.getState().phase).toBe('faces');
    expect(seen.some(Boolean)).toBe(false);
    store.getState().cancelRecording();
  });
});
