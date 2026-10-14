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
    expect(take.restMotion()!).toBeGreaterThan(10 * FACE_SESSION_DEFAULTS.restMovingAt);
    take.push(syntheticExpressionVector('rest', f++), (t += FRAME_MS));
    expect(take.restMotion()!).toBeLessThan(FACE_SESSION_DEFAULTS.restMovingAt);
    take.push({}, (t += FRAME_MS));
    expect(take.restMotion()).toBeNull(); // no face in the last frame
  });
});

describe('the rest ring in the panel', () => {
  it('fills during the rest, says "stay relaxed" when the face moves, and gives way to the hold ring', async () => {
    vi.useFakeTimers();
    // The face smiles from 1.5 s to 1.8 s into the rest.
    const store = createFaceSessionStore(deps(restingSource((ms) => ms >= 1500 && ms < 1800)));
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    act(() => store.getState().explore());
    await run(100);
    // Click 3 from a cold load (Tools, Your faces, Record my faces, then this).
    fireEvent.click(screen.getByRole('button', { name: /Start capturing/ }));
    const ring = () => screen.queryByRole('progressbar', { name: 'The rest' });
    expect(ring()).not.toBeNull();
    expect(screen.queryByText(/Stay relaxed/)).toBeNull();

    await run(1000);
    const early = Number(ring()!.getAttribute('aria-valuenow'));
    expect(early).toBeGreaterThan(20);
    expect(early).toBeLessThan(45);
    expect(ring()!.getAttribute('data-progress-tone')).toBe('normal');

    // Into the smile: "stay relaxed", held a second past it, then calm again.
    await run(600);
    expect(screen.getByText(/Stay relaxed/)).toBeTruthy();
    expect(ring()!.getAttribute('data-progress-tone')).toBe('warn');
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

  it('a still rest never says "stay relaxed"', async () => {
    vi.useFakeTimers();
    const store = createFaceSessionStore(deps());
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
