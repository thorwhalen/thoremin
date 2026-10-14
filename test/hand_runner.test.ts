/**
 * The hand-model runner seam (#326): the worker runner's frame handling (paired stamps, one
 * frame at a time and never a queued one, dropped frames counted as skipped, results routed
 * to their own frame), its hand-count changes, and the automatic fallback to the main thread
 * when the worker cannot start, dies, hangs on a frame or fails frame after frame. The worker is a fake that answers like `hands.worker.ts`.
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
  it('starts when the worker loads', async () => {
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

  it('drops the frames offered while busy, takes the next fresh one, and counts the drops as skipped', async () => {
    const w = new FakeWorker();
    const d = deps(w);
    const results: HandResult[] = [];
    const runner = await workerHandRunner(OPTIONS, (r) => results.push(r), d);
    runner.offer(video, stamp(100));
    await flush();
    expect(runner.offer(video, stamp(133))).toBe(true); // consumed: dropped, not refused
    expect(runner.offer(video, stamp(166, 1))).toBe(true); // the pump itself skipped one before this
    await flush();
    expect(w.frames()).toHaveLength(1); // one at a time
    expect(d.bitmaps).toHaveLength(1); // no bitmap for a frame the worker never sees
    w.reply({ type: 'result', id: w.frames()[0]!.id, result: HAND });
    runner.offer(video, stamp(200));
    await flush();
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
    w.reply({ type: 'frame-error', id: w.frames()[0]!.id });
    runner.offer(video, stamp(133));
    await flush();
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

  it('terminates on close, closes a bitmap that resolves after, and takes no more frames', async () => {
    const w = new FakeWorker();
    const d = deps(w);
    const runner = await workerHandRunner(OPTIONS, () => {}, d);
    runner.offer(video, stamp(100));
    runner.close(); // before the bitmap resolves
    await flush();
    expect(d.bitmaps[0]!.close).toHaveBeenCalled();
    expect(w.frames()).toHaveLength(0);
    expect(w.terminated).toBe(true);
    expect(runner.offer(video, stamp(133))).toBe(false);
  });

  it('frees the worker when a snapshot fails', async () => {
    const w = new FakeWorker();
    const d = deps(w);
    let fail = true;
    const runner = await workerHandRunner(OPTIONS, () => {}, {
      ...d,
      createImageBitmap: async (v) => {
        if (fail) throw new Error('no frame');
        return d.createImageBitmap(v);
      },
    });
    runner.offer(video, stamp(100));
    await flush();
    fail = false;
    runner.offer(video, stamp(133));
    await flush();
    expect(w.frames().map((f) => f.tMs)).toEqual([133]);
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

describe('the worker runner gives up on a broken worker', () => {
  it('treats a frame unanswered past the timeout as a hung worker', async () => {
    const timers: (() => void)[] = [];
    const w = new FakeWorker();
    const onDead = vi.fn();
    const runner = await workerHandRunner(OPTIONS, () => {}, { ...deps(w), setTimeout: (cb) => timers.push(cb), clearTimeout: () => {} }, onDead);
    runner.offer(video, stamp(100));
    await flush();
    timers[0]!(); // the watchdog fires with the frame still in the worker
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(w.terminated).toBe(true);
  });

  it('does not fire for a frame that was answered', async () => {
    const timers: (() => void)[] = [];
    const w = new FakeWorker();
    const onDead = vi.fn();
    const runner = await workerHandRunner(OPTIONS, () => {}, { ...deps(w), setTimeout: (cb) => timers.push(cb), clearTimeout: () => {} }, onDead);
    runner.offer(video, stamp(100));
    await flush();
    w.reply({ type: 'result', id: w.frames()[0]!.id, result: HAND });
    timers[0]!();
    expect(onDead).not.toHaveBeenCalled();
  });

  it('treats frame after frame failing as a broken worker; a good frame resets the count', async () => {
    const w = new FakeWorker();
    const onDead = vi.fn();
    const runner = await workerHandRunner(OPTIONS, () => {}, { ...deps(w), maxFrameErrors: 3 }, onDead);
    const failNext = async (t: number, ok = false): Promise<void> => {
      runner.offer(video, stamp(t));
      await flush();
      const id = w.frames().pop()!.id;
      w.reply(ok ? { type: 'result', id, result: HAND } : { type: 'frame-error', id });
    };
    await failNext(100);
    await failNext(133);
    await failNext(166, true);
    await failNext(200);
    await failNext(233);
    expect(onDead).not.toHaveBeenCalled();
    await failNext(266);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('keeps a worker error from reaching the page as an uncaught one', async () => {
    const w = new FakeWorker();
    await workerHandRunner(OPTIONS, () => {}, deps(w), () => {});
    const ev = { preventDefault: vi.fn() } as unknown as Event;
    w.onerror!(ev);
    expect((ev.preventDefault as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

describe('the hand count across a worker death (#325 x #326)', () => {
  const lmWith = () => ({ detectForVideo: vi.fn(() => HAND), setOptions: vi.fn(async () => {}), close: vi.fn() });

  it('takes a change made while the main thread loads, and applies it to the replacement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lm = lmWith();
    let finishLoad: (v: HandLandmarkerLike) => void = () => {};
    const loadMain = vi.fn((_o: LandmarkerOptions) => new Promise<HandLandmarkerLike>((r) => (finishLoad = r)));
    const w = new FakeWorker();
    const runner = await createHandRunner('auto', OPTIONS, () => {}, { loadMain, worker: deps(w) });
    w.onerror!(new Event('error'));
    await expect(runner.setNumHands(1)).resolves.toBeUndefined(); // no throw while loading
    finishLoad(lm);
    await flush();
    expect(loadMain.mock.calls[0]![0].numHands).toBe(2); // loading began at the old count...
    expect(lm.setOptions).toHaveBeenCalledWith({ numHands: 1 }); // ...and the change follows it
    warn.mockRestore();
  });

  it('resolves a change the worker death cut short, and the replacement is made with it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lm = lmWith();
    const loadMain = vi.fn(async (_o: LandmarkerOptions) => lm as HandLandmarkerLike);
    const w = new FakeWorker();
    const runner = await createHandRunner('auto', OPTIONS, () => {}, { loadMain, worker: deps(w) });
    const change = runner.setNumHands(1); // in flight in the worker...
    w.onerror!(new Event('error')); // ...when it dies
    await expect(change).resolves.toBeUndefined();
    await flush();
    expect(runner.where).toBe('main');
    // The replacement ends at the count asked for: loaded with it, or moved to it after.
    const last = (lm.setOptions.mock.calls.at(-1) as [{ numHands: number }] | undefined)?.[0].numHands ?? loadMain.mock.calls[0]![0].numHands;
    expect(last).toBe(1);
    warn.mockRestore();
  });
});
