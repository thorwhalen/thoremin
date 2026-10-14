/**
 * `webcam-hands` follows the host's hand count on the LIVE landmarker (#325): created with
 * the count the host wants, changed with `setOptions` (never a second landmarker, never a
 * model reload), no inference while a change is in flight, and `maxHands` as the cap and
 * the fallback for a host that says nothing. MediaPipe is mocked; frames are driven through
 * the pump's animation-frame path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '@thoremin/dag';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const { createFromOptions, landmarker, setOptions } = vi.hoisted(() => {
  const setOptions = vi.fn(async (_o: { numHands?: number }) => {});
  const landmarker = { detectForVideo: vi.fn(() => ({ landmarks: [], handedness: [] })), setOptions, close: vi.fn() };
  return { createFromOptions: vi.fn(async (_f: unknown, _o: { numHands?: number }) => landmarker), landmarker, setOptions };
});
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  HandLandmarker: { createFromOptions },
}));

import { HAND_COUNT_RESOURCE_KEY, wantedHands, webcamHandsNode } from '@/nodes/sources/webcam_hands';

const g = globalThis as Record<string, unknown>;
let saved: { raf: unknown; caf: unknown };
let frames: (() => void)[] = [];
const video = { readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0 };

/** One camera frame: the video advances, then the pump's animation frame runs. */
const step = (): void => {
  video.currentTime += 1 / 30;
  const due = frames;
  frames = [];
  for (const cb of due) cb();
};

beforeEach(() => {
  saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  frames = [];
  g.requestAnimationFrame = (cb: () => void) => frames.push(cb);
  g.cancelAnimationFrame = () => {};
  video.currentTime = 0;
  createFromOptions.mockClear();
  setOptions.mockClear();
  setOptions.mockImplementation(async () => {});
  landmarker.detectForVideo.mockClear();
});

afterEach(() => {
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
});

async function start(hands: { n: unknown } | null, maxHands = 2) {
  const node = webcamHandsNode.make(webcamHandsNode.params.parse({ maxHands, delegate: 'CPU' }));
  const resources: Record<string, unknown> = { video };
  if (hands) resources[HAND_COUNT_RESOURCE_KEY] = () => hands.n;
  await node.init!({ tick: 0, time: 0, dt: 0, resources } as unknown as NodeContext);
  return node;
}

describe('wantedHands', () => {
  it('reads the host count, capped by maxHands; maxHands without a usable one', () => {
    expect(wantedHands({ [HAND_COUNT_RESOURCE_KEY]: () => 1 }, 2)).toBe(1);
    expect(wantedHands({ [HAND_COUNT_RESOURCE_KEY]: () => 2 }, 1)).toBe(1);
    expect(wantedHands({}, 2)).toBe(2);
    expect(wantedHands({ [HAND_COUNT_RESOURCE_KEY]: () => 0 }, 2)).toBe(2);
    expect(wantedHands({ [HAND_COUNT_RESOURCE_KEY]: () => 1.5 }, 2)).toBe(2);
    expect(wantedHands({ [HAND_COUNT_RESOURCE_KEY]: 1 }, 2)).toBe(2);
  });
});

describe('webcam-hands follows the host hand count', () => {
  it('is created looking for what the host wants, and looks for maxHands without a host', async () => {
    const a = await start({ n: 1 });
    expect(createFromOptions.mock.calls[0]![1].numHands).toBe(1);
    a.dispose!();
    const b = await start(null);
    expect(createFromOptions.mock.calls[1]![1].numHands).toBe(2);
    b.dispose!();
  });

  it('changes the count on the live landmarker, skipping inference while it changes', async () => {
    const hands = { n: 2 };
    const node = await start(hands);
    step();
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
    expect(setOptions).not.toHaveBeenCalled();

    hands.n = 1;
    step(); // the change starts; this frame is not inferred
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
    await flush();
    expect(setOptions).toHaveBeenCalledWith({ numHands: 1 });
    step();
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
    step();
    expect(setOptions).toHaveBeenCalledTimes(1); // asked once, not per frame
    expect(createFromOptions).toHaveBeenCalledTimes(1); // never a second landmarker

    hands.n = 2;
    step();
    await flush();
    step();
    expect(setOptions).toHaveBeenLastCalledWith({ numHands: 2 });
    expect(setOptions).toHaveBeenCalledTimes(2);
    node.dispose!();
  });

  it('keeps the old count for good when a change fails, and never asks again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setOptions.mockImplementation(async () => {
      throw new Error('graph rebuild failed');
    });
    const hands = { n: 2 };
    const node = await start(hands);
    hands.n = 1;
    step();
    await flush();
    for (let i = 0; i < 5; i++) step();
    expect(setOptions).toHaveBeenCalledTimes(1);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    node.dispose!();
  });
});
