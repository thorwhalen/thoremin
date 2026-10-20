// @vitest-environment jsdom
/**
 * The "too dark" status line in the take (#348): the session store reads the room's light from
 * the live frame once a second while a take runs, and the panel says so with a status line (not
 * a modal) that goes away when the light returns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource, FACE_SCRIPT } from '@thoremin/ext-faces/app/sources';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { syntheticExpressionVector } from '@thoremin/ext-faces/lib/synthetic';
import { DARK_ROOM_MESSAGE } from '@thoremin/sdk/enroll/light';
import '@/app/dials/useDialsSettings';

const FRAME_MS = 33;
let clock = 1000;
let luma = 120;

function deps(): FaceSessionDeps {
  const source = syntheticSource(() => clock, { ...FACE_SCRIPT, vectorAt: (_ms, frame) => syntheticExpressionVector('rest', frame) });
  return {
    source: () => ({ ...source, video: () => ({}) as MediaStream }),
    thumbs: memoryThumbStore(),
    frames: () => ({ grab: async () => null, luma: () => luma, close: () => undefined }),
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: FRAME_MS,
    claim: () => undefined,
    newTakeId: () => 'take-1',
    isoNow: () => '2026-10-19T00:00:00.000Z',
  };
}

/** Advance the fake clock `ms`, in steps of a few poll intervals: each `act` is a React flush, and the test
 *  spent most of its time (5.4 s of the runner's 5 s limit, under load) flushing once per 33 ms poll. The
 *  light is read once a second, so a 100 ms step loses nothing. */
const STEP_MS = 100;
async function run(ms: number) {
  for (let t = 0; t < ms; t += STEP_MS) {
    clock += STEP_MS;
    await act(() => vi.advanceTimersByTimeAsync(STEP_MS));
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clock = 1000;
  luma = 120;
});

describe('the dark-room status line', () => {
  it('appears after a few dim readings, as a status and not a dialog, and goes when the light returns', { timeout: 30_000 }, async () => {
    vi.useFakeTimers();
    const store = createFaceSessionStore(deps());
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    act(() => store.getState().start());
    await run(2500);
    expect(screen.queryByText(DARK_ROOM_MESSAGE)).toBeNull();
    luma = 40;
    await run(4500);
    const line = screen.getByText(DARK_ROOM_MESSAGE);
    expect(line.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('dialog')).toBeNull();
    luma = 130;
    await run(4500);
    expect(screen.queryByText(DARK_ROOM_MESSAGE)).toBeNull();
  });
});

describe('the dark-room status line in the live test (#348)', () => {
  it('follows the light while the test runs, is cleared when it stops, and is absent without frames', async () => {
    const { createFaceTestStore } = await import('@thoremin/ext-faces/app/testStore');
    const { liveModel } = await import('@thoremin/sdk/enroll/live');
    const { SYNTHETIC_TIMELINE } = await import('@thoremin/ext-faces/lib/synthetic');
    vi.useFakeTimers();
    const session = createFaceSessionStore({ ...deps(), source: () => ({ ...syntheticSource(() => clock), video: () => null }), frames: () => null });
    act(() => session.getState().start());
    await run(SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs));
    await act(async () => void (await session.getState().stop()));
    const working = session.getState().working!;
    const base = { source: () => ({ ...syntheticSource(() => clock), video: () => ({}) as MediaStream }), claim: () => undefined, now: () => clock, pollMs: FRAME_MS, publishMs: 100 };
    const test = createFaceTestStore({ ...base, frames: () => ({ grab: async () => null, luma: () => luma, close: () => undefined }) });
    const bare = createFaceTestStore(base);
    luma = 120;
    test.getState().start(liveModel(working));
    bare.getState().start(liveModel(working));
    await run(2500);
    expect(test.getState().tooDark).toBe(false);
    luma = 40;
    await run(4500);
    expect(test.getState().tooDark).toBe(true);
    expect(bare.getState().tooDark).toBe(false);
    luma = 130;
    await run(4500);
    expect(test.getState().tooDark).toBe(false);
    luma = 40;
    await run(4500);
    expect(test.getState().tooDark).toBe(true);
    test.getState().stop();
    expect(test.getState().tooDark).toBe(false);
    bare.getState().stop();
  }, 60_000);
});
