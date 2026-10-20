/**
 * Adversarial audit of the hand-runner seam (2026-10-20 review lane): the paths the
 * #326 tests leave open. A hand-count change the worker never answers must be treated
 * like an unanswered frame (a hung worker), not held for ever; a worker that dies after
 * the GPU cascade must be replaced with the delegate that actually ran; the drops folded
 * into a frame that then fails must not vanish from `skipped`.
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

/** A fake worker that answers its init and nothing else unless the test replies. */
class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((ev: ErrorEvent | Event) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  constructor(private readonly answer: (delegate: string) => 'ready' | 'error' = () => 'ready') {}
  postMessage(m: ToWorker): void {
    this.sent.push(m);
    if (m.type === 'init') {
      const d = m.options.delegate;
      queueMicrotask(() => this.reply(this.answer(d) === 'ready' ? { type: 'ready', delegate: d } : { type: 'init-error', message: `${d} failed` }));
    }
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

/** Deps with hand-run timers: `timers` holds every armed callback, in order. */
function deps(worker: FakeWorker, timers: (() => void)[] = []): WorkerRunnerDeps {
  return {
    createWorker: () => worker,
    createImageBitmap: async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
    setTimeout: (cb) => {
      timers.push(cb);
      return timers.length;
    },
    clearTimeout: (h) => {
      timers[(h as number) - 1] = () => {};
    },
  };
}

const mainLandmarker = (): HandLandmarkerLike => ({ detectForVideo: vi.fn(() => HAND), setOptions: vi.fn(async () => {}), close: vi.fn() });

describe('a hand-count change the worker never answers', () => {
  it('is treated as a hung worker past the frame timeout: the change rejects, the worker is dead and terminated', async () => {
    const timers: (() => void)[] = [];
    const w = new FakeWorker();
    const onDead = vi.fn();
    const runner = await workerHandRunner(OPTIONS, () => {}, deps(w, timers), onDead);
    const armedBefore = timers.length;
    const change = runner.setNumHands(1);
    // Nothing answers. A watchdog must have been armed for the change, as it is for a frame.
    expect(timers.length).toBeGreaterThan(armedBefore);
    for (const t of timers.slice(armedBefore)) t();
    await expect(change).rejects.toThrow(/hand count|stopped/);
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(w.terminated).toBe(true);
  });

  it('does not fire once the change was answered', async () => {
    const timers: (() => void)[] = [];
    const w = new FakeWorker();
    const onDead = vi.fn();
    const runner = await workerHandRunner(OPTIONS, () => {}, deps(w, timers), onDead);
    const armedBefore = timers.length;
    const change = runner.setNumHands(1);
    const m = w.sent.find((x) => x.type === 'numHands') as Extract<ToWorker, { type: 'numHands' }>;
    w.reply({ type: 'numHands-done', id: m.id });
    await change;
    for (const t of timers.slice(armedBefore)) t();
    expect(onDead).not.toHaveBeenCalled();
    expect(w.terminated).toBe(false);
  });
});

describe('a worker that dies after the GPU cascade', () => {
  it('is replaced on the main thread with the delegate that ran in it (the CPU), not the GPU that already failed there', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const made: FakeWorker[] = [];
    const workerDeps: WorkerRunnerDeps = {
      ...deps(new FakeWorker()),
      createWorker: () => {
        // The GPU fails in the worker, the CPU starts.
        const w = new FakeWorker((d) => (d === 'GPU' ? 'error' : 'ready'));
        made.push(w);
        return w;
      },
    };
    const loadMain = vi.fn(async (o: LandmarkerOptions, extra?: { cpuFallback?: boolean }) => {
      if (o.delegate === 'GPU' && extra?.cpuFallback === false) throw new Error('no GPU on the main thread');
      return mainLandmarker();
    });
    const runner = await createHandRunner('auto', { ...OPTIONS, delegate: 'GPU' }, () => {}, { loadMain, worker: workerDeps });
    expect(runner.where).toBe('worker');
    expect(made).toHaveLength(2);
    const cpuWorker = made[1]!;
    expect(cpuWorker.sent[0]).toMatchObject({ type: 'init', options: { delegate: 'CPU' } });
    loadMain.mockClear();
    cpuWorker.onerror!(new Event('error'));
    await flush();
    expect(loadMain).toHaveBeenCalledTimes(1);
    expect(loadMain.mock.calls[0]![0].delegate).toBe('CPU');
    warn.mockRestore();
    info.mockRestore();
  });
});

describe('the frames dropped while the worker was busy', () => {
  it('stay counted when the frame that carried them fails', async () => {
    const w = new FakeWorker();
    const results: HandResult[] = [];
    const runner = await workerHandRunner(OPTIONS, (r) => results.push(r), deps(w));
    runner.offer(video, stamp(100));
    await flush();
    runner.offer(video, stamp(133)); // dropped: the worker is busy
    runner.offer(video, stamp(166)); // dropped
    w.reply({ type: 'result', id: w.frames()[0]!.id, result: HAND });
    runner.offer(video, stamp(200)); // carries skipped = 2
    await flush();
    expect(w.frames()[1]!.tMs).toBe(200);
    w.reply({ type: 'frame-error', id: w.frames()[1]!.id }); // and fails
    runner.offer(video, stamp(233));
    await flush();
    w.reply({ type: 'result', id: w.frames()[2]!.id, result: HAND });
    expect(results.map((r) => r.stamp.tMs)).toEqual([100, 233]);
    // 133 and 166 were never seen, nor was 200: three frames missing between the two results.
    expect(results[1]!.stamp.skipped).toBe(3);
  });

  it('stay counted when the snapshot of the frame that carried them fails', async () => {
    const w = new FakeWorker();
    const results: HandResult[] = [];
    let failNext = false;
    const d: WorkerRunnerDeps = {
      ...deps(w),
      createImageBitmap: async () => {
        if (failNext) {
          failNext = false;
          throw new Error('no frame');
        }
        return { close: vi.fn() } as unknown as ImageBitmap;
      },
    };
    const runner = await workerHandRunner(OPTIONS, (r) => results.push(r), d);
    runner.offer(video, stamp(100));
    await flush();
    runner.offer(video, stamp(133));
    w.reply({ type: 'result', id: w.frames()[0]!.id, result: HAND });
    failNext = true;
    runner.offer(video, stamp(166)); // carries skipped = 1; its snapshot fails
    await flush();
    runner.offer(video, stamp(200));
    await flush();
    w.reply({ type: 'result', id: w.frames()[1]!.id, result: HAND });
    expect(results.map((r) => r.stamp.tMs)).toEqual([100, 200]);
    expect(results[1]!.stamp.skipped).toBe(2);
  });
});
