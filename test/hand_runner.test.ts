/**
 * The hand-model runner seam (#326): the worker runner's frame handling (paired stamps, only
 * the newest frame waits, dropped frames counted as skipped, results routed to their own
 * frame), its hand-count changes, and the automatic fallback to the main thread when the
 * worker cannot start or dies. The worker is a fake that answers like `hands.worker.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createHandRunner,
  workerHandRunner,
  type FromWorker,
  type HandLandmarkerLike,
  type HandResult,
  type LandmarkerOptions,
  type ToWorker,
  type WorkerLike,
  type WorkerRunnerDeps,
} from '@/nodes/sources/hand_runner';
import type { FrameStamp } from '@/nodes/sources/frame_pump';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const OPTIONS: LandmarkerOptions = { wasmBase: 'w', modelUrl: 'm', delegate: 'CPU', numHands: 2 };
const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement;
const stamp = (tMs: number, skipped = 0): FrameStamp => ({ tMs, source: 'capture', lagMs: 5, skipped }) as FrameStamp;
const HAND = { landmarks: [[{ x: 0.5, y: 0.5, z: 0 }]], handedness: [[{ categoryName: 'Left' }]] };

/** A fake worker: records what it is sent; the test answers with `reply`. */
class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((ev: ErrorEvent | Event) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  constructor(private readonly start: 'ready' | 'error' | 'silent' = 'ready') {}
  postMessage(m: ToWorker): void {
    this.sent.push(m);
    if (m.type === 'init' && this.start !== 'silent')
      queueMicrotask(() => this.reply(this.start === 'ready' ? { type: 'ready', delegate: 'CPU' } : { type: 'init-error', message: 'no model' }));
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(m: FromWorker): void {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
  frames(): Extract<ToWorker, { type: 'frame' }>[] {
    return this.sent.filter((m): m is Extract<ToWorker, { type: 'frame' }> => m.type === 'frame');
  }
}

function deps(worker: FakeWorker): WorkerRunnerDeps & { bitmaps: { close: ReturnType<typeof vi.fn> }[] } {
  const bitmaps: { close: ReturnType<typeof vi.fn> }[] = [];
  return {
    bitmaps,
    createWorker: () => worker,
    createImageBitmap: async () => {
      const b = { close: vi.fn() };
      bitmaps.push(b);
      return b as unknown as ImageBitmap;
    },
  };
}

describe('the worker runner', () => {
  it('starts when the worker loads, and refuses frames before', async () => {
    const w = new FakeWorker('silent');
    const pending = workerHandRunner(OPTIONS, () => {}, deps(w));
    expect(w.sent[0]).toEqual({ type: 'init', options: OPTIONS });
    w.reply({ type: 'ready', delegate: 'CPU' });
    const runner = await pending;
    expect(runner.where).toBe('worker');
  });

  it('rejects when the worker cannot load the model', async () => {
    const w = new FakeWorker('error');
    await expect(workerHandRunner(OPTIONS, () => {}, deps(w))).rejects.toThrow('no model');
    expect(w.terminated).toBe(true);
  });

  it('infers at each frame\'s own time and hands back that frame\'s stamp', async () => {
    const w = new FakeWorker();
    const results: HandResult[] = [];
    const runner = await workerHandRunner(OPTIONS, (r) => results.push(r), deps(w));
    expect(runner.offer(video, stamp(100))).toBe(true);
    await flush();
    const [f] = w.frames();
    expect(f!.tMs).toBe(100);
    w.reply({ type: 'result', id: f!.id, result: HAND });
    expect(results).toHaveLength(1);
    expect(results[0]!.stamp.tMs).toBe(100);
    expect(results[0]).toMatchObject({ width: 1280, height: 720, result: HAND });
  });

  it('keeps only the newest frame while busy, and counts the dropped ones as skipped', async () => {
    const w = new FakeWorker();
    const d = deps(w);
    const results: HandResult[] = [];
    const runner = await workerHandRunner(OPTIONS, (r) => results.push(r), d);
    runner.offer(video, stamp(100));
    await flush();
    runner.offer(video, stamp(133));
    runner.offer(video, stamp(166, 1)); // the pump itself skipped one before this
    runner.offer(video, stamp(200));
    await flush();
    expect(w.frames()).toHaveLength(1); // one at a time
    expect(d.bitmaps[1]!.close).toHaveBeenCalled(); // replaced while waiting
    expect(d.bitmaps[2]!.close).toHaveBeenCalled();
    w.reply({ type: 'result', id: w.frames()[0]!.id, result: HAND });
    const second = w.frames()[1]!;
    expect(second.tMs).toBe(200);
    w.reply({ type: 'result', id: second.id, result: HAND });
    // 133 and 166 were dropped; 166 carried one skipped of its own.
    expect(results.map((r) => [r.stamp.tMs, r.stamp.skipped])).toEqual([
      [100, 0],
      [200, 3],
    ]);
  });

  it('goes on after a failed frame', async () => {
    const w = new FakeWorker();
    const results: HandResult[] = [];
    const runner = await workerHandRunner(OPTIONS, (r) => results.push(r), deps(w));
    runner.offer(video, stamp(100));
    await flush();
    runner.offer(video, stamp(133));
    await flush();
    w.reply({ type: 'frame-error', id: w.frames()[0]!.id });
    expect(w.frames()).toHaveLength(2);
    w.reply({ type: 'result', id: w.frames()[1]!.id, result: HAND });
    expect(results.map((r) => r.stamp.tMs)).toEqual([133]);
  });

  it('changes the hand count through the worker', async () => {
    const w = new FakeWorker();
    const runner = await workerHandRunner(OPTIONS, () => {}, deps(w));
    const ok = runner.setNumHands(1);
    const m = w.sent.find((x) => x.type === 'numHands') as Extract<ToWorker, { type: 'numHands' }>;
    expect(m.n).toBe(1);
    w.reply({ type: 'numHands-done', id: m.id });
    await expect(ok).resolves.toBeUndefined();
    const bad = runner.setNumHands(2);
    const m2 = w.sent.filter((x) => x.type === 'numHands').pop() as Extract<ToWorker, { type: 'numHands' }>;
    w.reply({ type: 'numHands-done', id: m2.id, error: 'rebuild failed' });
    await expect(bad).rejects.toThrow('rebuild failed');
  });

  it('closes what is waiting and terminates on close', async () => {
    const w = new FakeWorker();
    const d = deps(w);
    const runner = await workerHandRunner(OPTIONS, () => {}, d);
    runner.offer(video, stamp(100));
    await flush();
    runner.offer(video, stamp(133));
    await flush();
    runner.close();
    expect(d.bitmaps[1]!.close).toHaveBeenCalled();
    expect(w.terminated).toBe(true);
    expect(runner.offer(video, stamp(166))).toBe(false);
  });
});

describe('createHandRunner', () => {
  const mainLandmarker = (): HandLandmarkerLike & { detectForVideo: ReturnType<typeof vi.fn> } => ({
    detectForVideo: vi.fn(() => HAND),
    setOptions: vi.fn(async () => {}),
    close: vi.fn(),
  });

  it('runs on the main thread when asked, or when the browser has no worker', async () => {
    const loadMain = vi.fn(async () => mainLandmarker());
    expect((await createHandRunner('main', OPTIONS, () => {}, { loadMain, worker: deps(new FakeWorker()) })).where).toBe('main');
    expect((await createHandRunner('auto', OPTIONS, () => {}, { loadMain })).where).toBe('main');
    expect(loadMain).toHaveBeenCalledTimes(2);
  });

  it('runs in the worker when it starts, loading nothing on the main thread', async () => {
    const loadMain = vi.fn(async () => mainLandmarker());
    const runner = await createHandRunner('auto', OPTIONS, () => {}, { loadMain, worker: deps(new FakeWorker()) });
    expect(runner.where).toBe('worker');
    expect(loadMain).not.toHaveBeenCalled();
  });

  it('falls back to the main thread when the worker cannot start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loadMain = vi.fn(async () => mainLandmarker());
    const runner = await createHandRunner('worker', OPTIONS, () => {}, { loadMain, worker: deps(new FakeWorker('error')) });
    expect(runner.where).toBe('main');
    expect(loadMain).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('moves to the main thread when the worker dies, looking for the same number of hands', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lm = mainLandmarker();
    const loadMain = vi.fn(async (_o: LandmarkerOptions) => lm);
    const w = new FakeWorker();
    const results: HandResult[] = [];
    const runner = await createHandRunner('auto', OPTIONS, (r) => results.push(r), { loadMain, worker: deps(w) });
    const change = runner.setNumHands(1);
    const m = w.sent.find((x) => x.type === 'numHands') as Extract<ToWorker, { type: 'numHands' }>;
    w.reply({ type: 'numHands-done', id: m.id });
    await change;
    w.onerror!(new Event('error'));
    expect(w.terminated).toBe(true);
    expect(runner.offer(video, stamp(100))).toBe(false); // nothing runs while the main thread loads
    await flush();
    expect(loadMain.mock.calls[0]![0].numHands).toBe(1);
    expect(runner.where).toBe('main');
    expect(runner.offer(video, stamp(133))).toBe(true);
    expect(lm.detectForVideo).toHaveBeenCalledWith(video, 133);
    expect(results.map((r) => r.stamp.tMs)).toEqual([133]);
    warn.mockRestore();
  });
});
