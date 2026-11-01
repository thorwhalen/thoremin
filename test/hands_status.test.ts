/**
 * The hand source says why the hands stopped (#737). Before, a dead worker whose main-thread
 * replacement could not load left `webcam-hands` holding its last frame with nothing on screen
 * but a frozen instrument. Now every hand source has a `status` port (the body sources' shared
 * `LoadStatus` vocabulary), the runner reports `replacing` / `retrying` / `failed`, and the
 * overlay's source-status element prints "Hands: ..." under the body's line while the hands are
 * not working. The node itself (the empty frame while not running) is `webcam_hands_status.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { createHandRunner, MAIN_REPLACEMENT_RETRIES, type FromWorker, type LandmarkerOptions, type ToWorker, type WorkerLike, type WorkerRunnerDeps } from '@/nodes/sources/hand_runner';
import { handsStatus, HANDS_STATUS } from '@/nodes/sources/webcam_hands';
import { syntheticHandsNode } from '@/nodes/sources/synthetic_hands';
import { replayHandsNode } from '@/nodes/sources/replay_hands';
import { SCRIPTED_HANDS_STATUS } from '@/nodes/sources/source_contract';
import { canvasOverlayNode } from '@/nodes/output/canvas_overlay';
import { makeRecordingCanvas } from './helpers/canvas';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const OPTIONS: LandmarkerOptions = { wasmBase: 'w', modelUrl: 'm', delegate: 'CPU', numHands: 2 };

/** A worker that starts, and dies when told to. */
class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((ev: ErrorEvent | Event) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  postMessage(m: ToWorker): void {
    if (m.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', delegate: m.options.delegate } } as MessageEvent<FromWorker>));
  }
  terminate(): void {}
}
function deps(worker: FakeWorker, timers: (() => void)[]): WorkerRunnerDeps {
  return {
    createWorker: () => worker,
    createImageBitmap: async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
    setTimeout: (cb) => timers.push(cb),
    clearTimeout: (h) => {
      timers[(h as number) - 1] = () => {};
    },
  };
}

describe('the runner says whether it is inferring', () => {
  it('running; replacing while the main thread loads; retrying while it waits after a failed load; failed once every try is spent', async () => {
    const quiet = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'info').mockImplementation(() => {})];
    try {
      const timers: (() => void)[] = [];
      const w = new FakeWorker();
      let failLoad: (e: Error) => void = () => {};
      const loadMain = vi.fn((): Promise<never> => new Promise((_, reject) => (failLoad = reject)));
      const runner = await createHandRunner('auto', OPTIONS, () => {}, { loadMain, worker: deps(w, timers) });
      expect(runner.state?.()).toBe('running');
      const armed = timers.length;
      w.onerror!(new Event('error'));
      await flush();
      expect(runner.state?.()).toBe('replacing'); // the main thread is loading
      for (let i = 0; i <= MAIN_REPLACEMENT_RETRIES; i++) {
        failLoad(new Error('offline'));
        await flush();
        expect(runner.state?.()).toBe(i < MAIN_REPLACEMENT_RETRIES ? 'retrying' : 'failed');
        if (i === MAIN_REPLACEMENT_RETRIES) break;
        timers[armed + i]!(); // the wait is over: loading again
        expect(runner.state?.()).toBe('replacing');
      }
    } finally {
      quiet.forEach((s) => s.mockRestore());
    }
  });
});

describe('handsStatus', () => {
  it('names each state, and allocates nothing per tick', () => {
    expect(handsStatus('replacing', true)).toBe(HANDS_STATUS.replacing);
    expect(handsStatus('retrying', false)).toBe(HANDS_STATUS.retrying);
    expect(handsStatus('failed', false)).toBe(HANDS_STATUS.failed);
    expect(handsStatus('running', false)).toBe(HANDS_STATUS.ready);
    expect(handsStatus('running', true)).toBe(HANDS_STATUS.active);
    expect(HANDS_STATUS.failed.phase).toBe('error');
    // Waiting to try again is not "moving to the main thread".
    expect(HANDS_STATUS.retrying.message).not.toContain('main thread');
    // No "loading" or "could not load": init awaits the runner, so process() never runs before it.
    expect(Object.keys(HANDS_STATUS).sort()).toEqual(['active', 'failed', 'ready', 'replacing', 'retrying']);
  });
});

describe('every hand source emits a status', () => {
  const ctx = { tick: 0, time: 0, dt: 1 / 30, resources: {} } as NodeContext;
  it('the synthetic and the replayed hands are ready', async () => {
    const synth = syntheticHandsNode.make(syntheticHandsNode.params.parse({}));
    expect((await synth.process({}, ctx)) as Record<string, unknown>).toMatchObject({ status: SCRIPTED_HANDS_STATUS });
    const replay = replayHandsNode.make(replayHandsNode.params.parse({}));
    expect((await replay.process({}, ctx)) as Record<string, unknown>).toMatchObject({ status: SCRIPTED_HANDS_STATUS });
    for (const node of [syntheticHandsNode, replayHandsNode]) expect(node.outputs.map((o) => o.name)).toEqual(['hands', 'status']);
  });
});

describe('the overlay says why no hand is drawn', () => {
  const BODY_LOADING = { phase: 'loading', message: 'Loading body model...' } as const;
  /** Draw with the given statuses; `params` is the overlay's params (every element on by default). */
  const drawWith = (inputs: { handsStatus?: unknown; bodyStatus?: unknown }, params: Record<string, unknown> = {}) => {
    const rc = makeRecordingCanvas();
    const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(params));
    handlers.process({ hands: { width: 640, height: 480, hands: [] }, ...inputs, octaveShift: 0 }, { tick: 0, time: 0, dt: 0, resources: { canvas: rc.canvas, video: rc.video } } as NodeContext);
    return rc;
  };
  const lines = (rc: ReturnType<typeof makeRecordingCanvas>) => rc.calls.filter((c) => c.m === 'fillText' && /^(Body|Hands): /.test(String(c.args[0]))).map((c) => [c.args[0], c.args[2]]);

  it('prints the replacing, retrying or failed state, and nothing when ready or active', () => {
    for (const s of [HANDS_STATUS.replacing, HANDS_STATUS.retrying, HANDS_STATUS.failed]) expect(drawWith({ handsStatus: s }).texts()).toContain(`Hands: ${s.message}`);
    for (const quiet of [HANDS_STATUS.ready, HANDS_STATUS.active, undefined]) expect(drawWith({ handsStatus: quiet }).texts().some((t) => t.startsWith('Hands:'))).toBe(false);
  });

  it('stacks the body and the hands lines with no gap when one is absent', () => {
    const both = lines(drawWith({ bodyStatus: BODY_LOADING, handsStatus: HANDS_STATUS.failed }));
    expect(both.map(([t]) => t)).toEqual([`Body: ${BODY_LOADING.message}`, `Hands: ${HANDS_STATUS.failed.message}`]);
    expect(both[1][1]).toBeGreaterThan(both[0][1] as number);
    // The hands alone take the first row, where the body's would be.
    expect(lines(drawWith({ handsStatus: HANDS_STATUS.failed }))[0][1]).toBe(both[0][1]);
  });

  it('a failure is not hidden by the landmark, skeleton or status toggles; the passing notes are, by its own', () => {
    const allOff = { landmarks: { show: false }, bodySkeleton: { show: false }, sourceStatus: { show: false } };
    expect(drawWith({ handsStatus: HANDS_STATUS.failed }, allOff).texts()).toContain(`Hands: ${HANDS_STATUS.failed.message}`);
    expect(drawWith({ handsStatus: HANDS_STATUS.replacing }, allOff).texts().some((t) => t.startsWith('Hands:'))).toBe(false);
    // The landmark dots off does not hide a passing note either: only the status's own toggle does.
    expect(drawWith({ handsStatus: HANDS_STATUS.replacing }, { landmarks: { show: false } }).texts()).toContain(`Hands: ${HANDS_STATUS.replacing.message}`);
  });
});
