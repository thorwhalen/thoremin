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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
/** How long, in REAL milliseconds, to wait for the node to reach a state. The slow step is the
 *  loader's dynamic import, which takes real time (a loaded runner needs more), so the budget is a
 *  deadline, not a count of turns: 500 turns pass in about a millisecond. `performance` is real
 *  (only `setTimeout` / `clearTimeout` are faked). */
const SETTLE_MS = 5_000;
/** How long, in real ms, nothing may load after the runner has failed for good. */
const QUIET_AFTER_FAILED_MS = 200;
/** Let promises, the module loader and zero-delay timers run until `reached()` (the loader's dynamic
 *  import settles on a real turn of the event loop, hence `setImmediate`); throws when the deadline
 *  passes, so a slow runner fails here, saying what it waited for, never later on an assertion about
 *  a state still on its way. */
const settleUntil = async (reached: () => boolean, what = 'the expected state'): Promise<void> => {
  const end = performance.now() + SETTLE_MS;
  while (!reached()) {
    if (performance.now() > end) throw new Error(`never reached ${what} within ${SETTLE_MS} ms`);
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((r) => setImmediate(r));
  }
};

/** One camera frame: the video advances, then the pump's animation frame runs. */
const step = (): void => {
  video.currentTime += 1 / 30;
  const due = frames;
  frames = [];
  for (const cb of due) cb();
};

// Resolve the tasks-vision module once, so the first main-thread load pays no module resolution.
beforeAll(async () => {
  await import('@mediapipe/tasks-vision');
});

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
  // Several waits of up to SETTLE_MS each: the test's own timeout is well above one, so a slow runner
  // fails on the labelled wait that never arrived, not on vitest's generic timeout.
  it('says replacing, retrying, then failed, and emits no hand in any of them', { timeout: 30_000 }, async () => {
    const quiet = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'info').mockImplementation(() => {})];
    try {
      type Out = { hands: { hands: unknown[] }; status: unknown };
      const node = webcamHandsNode.make(webcamHandsNode.params.parse({ delegate: 'CPU' }));
      // `process` is synchronous here (it returns the cached frame), so a state can be polled.
      const out = (): Out => node.process({}, ctx) as Out;
      await node.init!({ ...ctx, resources: { video, [HAND_RUNNER_RESOURCE_KEY]: 'worker' } } as NodeContext);
      // Until the model lands the source says it is loading (#922), with no hand.
      expect(node.process({}, ctx)).toMatchObject({ status: HANDS_STATUS.loading, hands: { hands: [] } });
      await settleUntil(() => node.process({}, ctx).status !== HANDS_STATUS.loading, 'the worker loaded');
      step();
      await settleUntil(() => out().hands.hands.length > 0, 'a hand inferred');
      const before = out();
      expect(before.hands.hands).toHaveLength(1);
      expect(before.status).toBe(HANDS_STATUS.active);

      // The worker dies; the main thread's load fails, and is tried again after a wait.
      let rejectLoad: (e: Error) => void = () => {};
      createFromOptions.mockImplementation(() => new Promise((_, reject) => (rejectLoad = reject)));
      FakeWorker.last!.onerror!(new Event('error'));
      await settleUntil(() => createFromOptions.mock.calls.length > 0, 'the main-thread replacement asked for');
      const replacing = out();
      expect(replacing.status).toBe(HANDS_STATUS.replacing);
      expect(replacing.hands.hands).toEqual([]);

      createFromOptions.mockRejectedValue(new Error('offline'));
      rejectLoad(new Error('offline'));
      await settleUntil(() => out().status === HANDS_STATUS.retrying, HANDS_STATUS.retrying.message);
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
      // Failed is for good: no load is asked for after it.
      const loadsAtFailure = createFromOptions.mock.calls.length;
      await vi.advanceTimersByTimeAsync(2 * MAIN_REPLACEMENT_RETRY_MS);
      // A wrongly scheduled load would reach createFromOptions only after a real turn (the dynamic
      // import), so drain for real time before counting.
      const quietUntil = performance.now() + QUIET_AFTER_FAILED_MS;
      await settleUntil(() => performance.now() > quietUntil, 'a quiet spell after failed');
      expect(createFromOptions).toHaveBeenCalledTimes(loadsAtFailure);
      node.dispose!();
    } finally {
      quiet.forEach((s) => s.mockRestore());
    }
  });
});
