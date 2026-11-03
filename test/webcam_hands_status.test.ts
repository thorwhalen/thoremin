/**
 * `webcam-hands` says why its hands stopped, and stops drawing them (#737), through the node
 * itself rather than the pure `handsStatus`: a worker that infers a hand, then dies, while the
 * main-thread replacement hangs (replacing), fails and waits (retrying), and runs out of tries
 * (failed). In every state but running, `process()` emits the empty frame: a held last frame
 * would keep a voice droning and a skeleton drawn beside "Hands: ... stopped".
 *
 * MediaPipe is mocked (the pattern of `webcam_hands_count.test.ts`), the Worker is a fake that
 * answers the real worker protocol, and frames are driven through the pump's animation frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import type { FromWorker, ToWorker, WorkerLike } from '@/nodes/sources/hand_runner';

const { createFromOptions } = vi.hoisted(() => ({ createFromOptions: vi.fn(async (_f: unknown, _o: unknown): Promise<unknown> => ({})) }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  HandLandmarker: { createFromOptions },
}));

import { MAIN_REPLACEMENT_RETRIES, MAIN_REPLACEMENT_RETRY_MS } from '@/nodes/sources/hand_runner';
import { HAND_RUNNER_RESOURCE_KEY, HANDS_STATUS, webcamHandsNode } from '@/nodes/sources/webcam_hands';

/** One hand of 21 landmarks, as the worker's landmarker would answer. */
const ONE_HAND = {
  landmarks: [Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.02 * i, z: 0 }))],
  handedness: [[{ categoryName: 'Right', score: 0.9 }]],
};

/** A worker that starts, answers every frame with one hand, and dies when told to. */
class FakeWorker implements WorkerLike {
  static last: FakeWorker | null = null;
  onmessage: ((ev: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((ev: ErrorEvent | Event) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(m: ToWorker): void {
    const answer = (data: FromWorker) => queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<FromWorker>));
    if (m.type === 'init') answer({ type: 'ready', delegate: m.options.delegate });
    if (m.type === 'frame') answer({ type: 'result', id: m.id, result: ONE_HAND });
  }
  terminate(): void {}
}

const g = globalThis as Record<string, unknown>;
const STUBBED = ['requestAnimationFrame', 'cancelAnimationFrame', 'Worker', 'createImageBitmap', 'OffscreenCanvas'] as const;
let saved: Record<string, unknown> = {};
let frames: (() => void)[] = [];
const video = { readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0 };
const ctx = { tick: 0, time: 0, dt: 0, resources: {} } as unknown as NodeContext;
/** The most turns of the event loop to wait for the node to reach a state (a loaded machine
 *  needs more than an idle one; a state that never comes fails the expectation after). */
const MAX_TURNS = 500;
/** Let promises, the module loader and zero-delay timers run until `reached()` (`setTimeout` is
 *  fake; the loader's dynamic import settles on a real turn of the event loop, hence `setImmediate`). */
/** Turn the event loop until `reached` holds; throws if it never does, so a slow runner fails here
 *  with a clear message, never later on an assertion about a state that was still on its way. */
const settleUntil = async (reached: () => boolean, what = 'the expected state'): Promise<void> => {
  for (let i = 0; i < MAX_TURNS; i++) {
    if (reached()) return;
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((r) => setImmediate(r));
  }
  if (!reached()) throw new Error(`never reached ${what} in ${MAX_TURNS} turns`);
};

/** One camera frame: the video advances, then the pump's animation frame runs. */
const step = (): void => {
  video.currentTime += 1 / 30;
  const due = frames;
  frames = [];
  for (const cb of due) cb();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  saved = Object.fromEntries(STUBBED.map((k) => [k, g[k]]));
  frames = [];
  g.requestAnimationFrame = (cb: () => void) => frames.push(cb);
  g.cancelAnimationFrame = () => {};
  g.Worker = FakeWorker;
  g.createImageBitmap = async () => ({ close: () => {} });
  g.OffscreenCanvas = class {};
  video.currentTime = 0;
  createFromOptions.mockReset();
});

afterEach(() => {
  for (const k of STUBBED) g[k] = saved[k];
  vi.useRealTimers();
});

describe('webcam-hands when its hand model stops', () => {
  it('says replacing, retrying, then failed, and emits no hand in any of them', async () => {
    const quiet = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'info').mockImplementation(() => {})];
    try {
      type Out = { hands: { hands: unknown[] }; status: unknown };
      const node = webcamHandsNode.make(webcamHandsNode.params.parse({ delegate: 'CPU' }));
      // `process` is synchronous here (it returns the cached frame), so a state can be polled.
      const out = (): Out => node.process({}, ctx) as Out;
      await node.init!({ ...ctx, resources: { video, [HAND_RUNNER_RESOURCE_KEY]: 'worker' } } as NodeContext);
      // Until the model lands the source says it is loading (#922), with no hand.
      expect(node.process({}, ctx)).toMatchObject({ status: HANDS_STATUS.loading, hands: { hands: [] } });
      await settleUntil(() => node.process({}, ctx).status !== HANDS_STATUS.loading);
      step();
      await settleUntil(() => out().hands.hands.length > 0);
      const before = out();
      expect(before.hands.hands).toHaveLength(1);
      expect(before.status).toBe(HANDS_STATUS.active);

      // The worker dies; the main thread's load fails, and is tried again after a wait.
      let rejectLoad: (e: Error) => void = () => {};
      createFromOptions.mockImplementation(() => new Promise((_, reject) => (rejectLoad = reject)));
      FakeWorker.last!.onerror!(new Event('error'));
      await settleUntil(() => createFromOptions.mock.calls.length > 0);
      const replacing = out();
      expect(replacing.status).toBe(HANDS_STATUS.replacing);
      expect(replacing.hands.hands).toEqual([]);

      createFromOptions.mockRejectedValue(new Error('offline'));
      rejectLoad(new Error('offline'));
      await settleUntil(() => out().status === HANDS_STATUS.retrying);
      const retrying = out();
      expect(retrying.status).toBe(HANDS_STATUS.retrying);
      expect(retrying.status).not.toMatchObject({ message: expect.stringContaining('main thread') });
      expect(retrying.hands.hands).toEqual([]);

      for (let i = 0; i < MAIN_REPLACEMENT_RETRIES; i++) {
        const loads = createFromOptions.mock.calls.length;
        await vi.advanceTimersByTimeAsync(MAIN_REPLACEMENT_RETRY_MS); // the wait is over: load again
        // The new load is asked for, then refused: wait for the state that refusal leads to (the load
        // chain is several promises long, longer since the runner became a lazyResource, #922).
        const expected = i < MAIN_REPLACEMENT_RETRIES - 1 ? HANDS_STATUS.retrying : HANDS_STATUS.failed;
        await settleUntil(() => createFromOptions.mock.calls.length > loads && out().status === expected, `${expected.message} after load ${i + 1}`);
        expect(out().status).toBe(expected);
        expect(out().hands.hands).toEqual([]);
      }
      const failed = out();
      expect(failed.status).toBe(HANDS_STATUS.failed);
      expect(failed.hands.hands).toEqual([]);
      node.dispose!();
    } finally {
      quiet.forEach((s) => s.mockRestore());
    }
  });
});
