/**
 * The hand source says why the hands stopped (#737). Before, a dead worker whose main-thread
 * replacement could not load left `webcam-hands` holding its last frame with nothing on screen
 * but a frozen instrument. Now every hand source has a `status` port (the body sources' shared
 * `LoadStatus` vocabulary), the runner reports `replacing` / `failed`, and the overlay prints
 * "Hands: ..." beside the body's line while the hands are not working.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { createHandRunner, MAIN_REPLACEMENT_RETRIES, type FromWorker, type HandRunner, type LandmarkerOptions, type ToWorker, type WorkerLike, type WorkerRunnerDeps } from '@/nodes/sources/hand_runner';
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
  it('running, then replacing while the main thread tries to load, then failed once every try is spent', async () => {
    const quiet = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'info').mockImplementation(() => {})];
    const timers: (() => void)[] = [];
    const w = new FakeWorker();
    const loadMain = vi.fn(async () => {
      throw new Error('offline');
    });
    const runner = await createHandRunner('auto', OPTIONS, () => {}, { loadMain, worker: deps(w, timers) });
    expect(runner.state?.()).toBe('running');
    const armed = timers.length;
    w.onerror!(new Event('error'));
    await flush();
    expect(runner.state?.()).toBe('replacing');
    for (let i = 0; i < MAIN_REPLACEMENT_RETRIES; i++) {
      timers[armed + i]!();
      await flush();
      expect(runner.state?.()).toBe(i < MAIN_REPLACEMENT_RETRIES - 1 ? 'replacing' : 'failed');
    }
    quiet.forEach((s) => s.mockRestore());
  });
});

describe('handsStatus', () => {
  const runnerIn = (state?: 'running' | 'replacing' | 'failed'): HandRunner => ({ where: 'main', offer: () => true, setNumHands: async () => {}, close: () => {}, ...(state ? { state: () => state } : {}) });

  it('names each state, and allocates nothing per tick', () => {
    expect(handsStatus({ runner: null, initFailed: false, handsInView: false })).toBe(HANDS_STATUS.loading);
    expect(handsStatus({ runner: null, initFailed: true, handsInView: false })).toBe(HANDS_STATUS.initFailed);
    expect(handsStatus({ runner: runnerIn('replacing'), initFailed: false, handsInView: true })).toBe(HANDS_STATUS.replacing);
    expect(handsStatus({ runner: runnerIn('failed'), initFailed: false, handsInView: false })).toBe(HANDS_STATUS.failed);
    expect(handsStatus({ runner: runnerIn('running'), initFailed: false, handsInView: false })).toBe(HANDS_STATUS.ready);
    // A runner with no state (one thread for good) is running.
    expect(handsStatus({ runner: runnerIn(), initFailed: false, handsInView: true })).toBe(HANDS_STATUS.active);
    expect(HANDS_STATUS.failed.phase).toBe('error');
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
  const drawWith = (handsStatus: unknown) => {
    const rc = makeRecordingCanvas();
    const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse({}));
    handlers.process({ hands: { width: 640, height: 480, hands: [] }, handsStatus, octaveShift: 0 }, { tick: 0, time: 0, dt: 0, resources: { canvas: rc.canvas, video: rc.video } } as NodeContext);
    return rc.texts();
  };
  it('prints the failure or the loading state, and nothing when ready or active', () => {
    expect(drawWith(HANDS_STATUS.failed)).toContain(`Hands: ${HANDS_STATUS.failed.message}`);
    expect(drawWith(HANDS_STATUS.loading)).toContain(`Hands: ${HANDS_STATUS.loading.message}`);
    for (const quiet of [HANDS_STATUS.ready, HANDS_STATUS.active, undefined]) expect(drawWith(quiet).some((t) => t.startsWith('Hands:'))).toBe(false);
  });
});
