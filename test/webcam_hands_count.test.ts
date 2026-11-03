/**
 * `webcam-hands` follows the host's hand count on the LIVE landmarker (#325): created with
 * the count the host wants, changed with `setOptions` (never a second landmarker, never a
 * model reload), no inference while a change is in flight, and `maxHands` as the cap and
 * the fallback for a host that says nothing. And how the model loads (#922): asked for by the
 * first tick, never holding the graph, tried again after a failed load, closed when it lands
 * after `dispose()`. MediaPipe is mocked; frames are driven through the pump's animation-frame path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '@thoremin/dag';

/** A few turns of the event loop: enough for the model's load (a dynamic import, the fileset,
 *  the landmarker) to settle, on a loaded machine too. */
const FLUSH_TURNS = 5;
const flush = async (): Promise<void> => {
  for (let i = 0; i < FLUSH_TURNS; i++) await new Promise((r) => setTimeout(r, 0));
};
/** The most flushes to wait for a state (a loaded machine is slow; a state that never comes fails
 *  the expectation after). */
const MAX_FLUSHES = 100;
const until = async (reached: () => boolean): Promise<void> => {
  for (let i = 0; i < MAX_FLUSHES && !reached(); i++) await flush();
};

const { createFromOptions, landmarker, setOptions } = vi.hoisted(() => {
  const setOptions = vi.fn(async (_o: { numHands?: number }) => {});
  const landmarker = { detectForVideo: vi.fn(() => ({ landmarks: [], handedness: [] })), setOptions, close: vi.fn() };
  return { createFromOptions: vi.fn(async (_f: unknown, _o: { numHands?: number }) => landmarker), landmarker, setOptions };
});
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  HandLandmarker: { createFromOptions },
}));

import { HAND_COUNT_RESOURCE_KEY, HAND_RUNNER_RESOURCE_KEY, HANDS_STATUS, runnerChoice, wantedHands, webcamHandsNode } from '@/nodes/sources/webcam_hands';
import { MAIN_REPLACEMENT_RETRIES, MAIN_REPLACEMENT_RETRY_MS } from '@/nodes/sources/hand_runner';

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

const tickCtx = { tick: 0, time: 0, dt: 1 / 30, resources: {} } as unknown as NodeContext;

/** Init, then tick: the first tick requests the model (#922: `init` does not load it), it lands,
 *  and the next tick starts the frame pump. */
async function boot(node: ReturnType<typeof webcamHandsNode.make>, resources: Record<string, unknown>) {
  await node.init!({ tick: 0, time: 0, dt: 0, resources } as unknown as NodeContext);
  // Each tick asks (once) and, once the model is held, starts the pump.
  await until(() => (node.process({}, tickCtx) as { status: unknown }).status !== HANDS_STATUS.loading);
  return node;
}

async function start(hands: { n: unknown } | null, maxHands = 2) {
  const node = webcamHandsNode.make(webcamHandsNode.params.parse({ maxHands, delegate: 'CPU' }));
  const resources: Record<string, unknown> = { video };
  if (hands) resources[HAND_COUNT_RESOURCE_KEY] = () => hands.n;
  return boot(node, resources);
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
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setOptions.mockImplementation(async () => {
      throw new Error('graph rebuild failed');
    });
    const hands = { n: 2 };
    const node = await start(hands);
    hands.n = 1;
    step();
    await flush();
    await flush();
    for (let i = 0; i < 5; i++) step();
    // The change, then one attempt to put the old count back; never asked again after.
    expect(setOptions.mock.calls.map((c) => c[0])).toEqual([{ numHands: 1 }, { numHands: 2 }]);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1); // the restore failed too (the mock always throws)
    warn.mockRestore();
    error.mockRestore();
    node.dispose!();
  });

  it('leaves a landmarker disposed before a change runs alone', async () => {
    const hands = { n: 2 };
    const node = await start(hands);
    hands.n = 1;
    step();
    node.dispose!();
    await flush();
    expect(setOptions).not.toHaveBeenCalled();
  });
});

describe('where the hand model runs (#326)', () => {
  it('defaults to the main thread, and the host override wins when it is valid', () => {
    expect(webcamHandsNode.params.parse({}).runner).toBe('main');
    expect(runnerChoice({}, 'main')).toBe('main');
    expect(runnerChoice({ [HAND_RUNNER_RESOURCE_KEY]: 'worker' }, 'main')).toBe('worker');
    expect(runnerChoice({ [HAND_RUNNER_RESOURCE_KEY]: 'auto' }, 'main')).toBe('auto');
    expect(runnerChoice({ [HAND_RUNNER_RESOURCE_KEY]: 'gpu' }, 'worker')).toBe('worker');
    expect(runnerChoice({ [HAND_RUNNER_RESOURCE_KEY]: undefined }, 'main')).toBe('main');
  });

  it('runs on the main thread when asked for a worker the platform cannot host', async () => {
    const node = await boot(webcamHandsNode.make(webcamHandsNode.params.parse({ delegate: 'CPU', runner: 'worker' })), { video });
    expect(createFromOptions).toHaveBeenCalledTimes(1); // the main thread's landmarker
    step();
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
    node.dispose!();
  });
});

describe('webcam-hands on the worker path, end to end (#326)', () => {
  it('infers in the worker and keeps the result with its own frame\'s capture time', async () => {
    const sent: { type: string; id?: number; tMs?: number }[] = [];
    const fake = {
      onmessage: null as ((ev: { data: unknown }) => void) | null,
      onerror: null,
      postMessage(m: { type: string; id?: number; tMs?: number }) {
        sent.push(m);
        if (m.type === 'init') queueMicrotask(() => fake.onmessage?.({ data: { type: 'ready', delegate: 'CPU' } }));
      },
      terminate: vi.fn(),
    };
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const saved = { Worker: g.Worker, createImageBitmap: g.createImageBitmap, OffscreenCanvas: g.OffscreenCanvas };
    g.Worker = function Worker() {
      return fake;
    };
    g.createImageBitmap = async () => ({ close: vi.fn() });
    g.OffscreenCanvas = function OffscreenCanvas() {};
    try {
      const node = await boot(webcamHandsNode.make(webcamHandsNode.params.parse({ delegate: 'CPU', runner: 'worker' })), { video });
      expect(createFromOptions).not.toHaveBeenCalled(); // nothing loads on the main thread
      step();
      await flush();
      const frame = sent.find((m) => m.type === 'frame')!;
      const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
      fake.onmessage!({ data: { type: 'result', id: frame.id, result: { landmarks: [hand], handedness: [[{ categoryName: 'Left' }]] } } });
      const out = node.process!({}, { tick: 1, time: 0, dt: 0, resources: {} } as unknown as NodeContext) as { hands: { hands: unknown[]; t?: number; width: number } };
      expect(out.hands.hands).toHaveLength(1);
      expect(out.hands.width).toBe(1280);
      expect(out.hands.t! * 1000).toBeCloseTo(frame.tMs!, 6); // the frame's own stamp, not the arrival time
      node.dispose!();
      expect(fake.terminate).toHaveBeenCalled();
    } finally {
      Object.assign(g, saved);
      info.mockRestore();
    }
  });
});

/** The next landmarker is one the test lands when it says: `land` waits for the load to ask for it
 *  (a resolver called before that would land nothing), lands it, and lets it settle. */
const pending = () => {
  let resolve: ((lm: typeof landmarker) => void) | null = null;
  createFromOptions.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  return async (lm: typeof landmarker): Promise<void> => {
    await until(() => resolve !== null);
    expect(resolve, 'the load never asked for its landmarker').not.toBeNull();
    resolve!(lm);
    await flush();
  };
};

describe('the hand model loads without holding the graph (#922)', () => {
  const ctx = tickCtx;

  it('init loads nothing; the first tick asks for the model, which says loading with no hand, then ready', async () => {
    const land = pending();
    const node = webcamHandsNode.make(webcamHandsNode.params.parse({ delegate: 'CPU' }));
    await node.init!({ tick: 0, time: 0, dt: 0, resources: { video } } as unknown as NodeContext);
    await flush();
    expect(createFromOptions).not.toHaveBeenCalled();
    expect(node.process({}, ctx)).toEqual({ status: HANDS_STATUS.loading, hands: { width: 640, height: 480, hands: [] } });
    await until(() => createFromOptions.mock.calls.length > 0); // the fileset resolves, then the landmarker is asked for
    expect(createFromOptions).toHaveBeenCalledTimes(1);
    expect(node.process({}, ctx)).toMatchObject({ status: HANDS_STATUS.loading, hands: { hands: [] } });
    expect(frames).toHaveLength(0); // no frame pump before the model is held
    await land(landmarker);
    expect(node.process({}, ctx)).toMatchObject({ status: HANDS_STATUS.ready });
    expect(createFromOptions).toHaveBeenCalledTimes(1); // asked once over every tick
    step();
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
    node.dispose?.();
  });

  it('a host count that changes while the model loads is followed once it lands', async () => {
    const land = pending();
    const hands = { n: 2 };
    const node = webcamHandsNode.make(webcamHandsNode.params.parse({ delegate: 'CPU' }));
    await node.init!({ tick: 0, time: 0, dt: 0, resources: { video, [HAND_COUNT_RESOURCE_KEY]: () => hands.n } } as unknown as NodeContext);
    node.process({}, ctx);
    await flush();
    hands.n = 1;
    node.process({}, ctx);
    await land(landmarker);
    node.process({}, ctx);
    step(); // the change starts
    await flush();
    expect(setOptions).toHaveBeenCalledWith({ numHands: 1 });
    node.dispose?.();
  });

  it('disposed while loading, the landed model is closed, never used', async () => {
    const land = pending();
    landmarker.close.mockClear();
    const node = webcamHandsNode.make(webcamHandsNode.params.parse({ delegate: 'CPU' }));
    await node.init!({ tick: 0, time: 0, dt: 0, resources: { video } } as unknown as NodeContext);
    node.process({}, ctx);
    await flush();
    node.dispose?.();
    await land(landmarker);
    expect(landmarker.close).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });
});

describe('the instrument boots before the hand model lands (#922)', () => {
  const spec = { nodes: [{ id: 'cam', type: 'webcam-hands', params: { delegate: 'CPU' } }], edges: [] };
  const boot = async () => {
    const { Engine, createRegistry } = await import('@thoremin/dag');
    const engine = new Engine(spec, createRegistry([webcamHandsNode] as never), { resources: { video } });
    await engine.init();
    return engine;
  };
  /** The tick's time, rising, so every tick is a new one. */
  let t = 0;
  const tick = (engine: Awaited<ReturnType<typeof boot>>) => {
    t += 1 / 30;
    engine.tick(t);
    return { status: engine.getOutput('cam', 'status'), hands: engine.getOutput('cam', 'hands') as { hands: unknown[] } };
  };
  /** Move the clock the load's retry pause reads past that pause. */
  const pastRetryPause = () => vi.setSystemTime(Date.now() + MAIN_REPLACEMENT_RETRY_MS + 1);

  beforeEach(() => {
    t = 0;
    // Only the wall clock (the pause between tries reads it): `flush` needs a real `setTimeout`.
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    createFromOptions.mockImplementation(async () => landmarker);
  });

  it('an engine with the webcam hands inits and ticks at once, the status loading until the model is there', async () => {
    const land = pending();
    const engine = await boot();
    expect(tick(engine).status).toBe(HANDS_STATUS.loading);
    await land(landmarker);
    expect(tick(engine).status).toBe(HANDS_STATUS.ready);
    engine.dispose();
  });

  it('a model that cannot load says it is trying again, then that it is unavailable, while the engine keeps ticking', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createFromOptions.mockImplementation(async () => {
      throw new Error('offline');
    });
    try {
      const engine = await boot();
      expect(tick(engine).status).toBe(HANDS_STATUS.loading);
      for (let attempt = 0; attempt <= MAIN_REPLACEMENT_RETRIES; attempt++) {
        await until(() => tick(engine).status !== HANDS_STATUS.loading);
        const last = attempt === MAIN_REPLACEMENT_RETRIES;
        const out = tick(engine);
        expect(out.status).toBe(last ? HANDS_STATUS.unavailable : HANDS_STATUS.retrying);
        expect(out.hands.hands).toEqual([]);
        // Within the pause no tick asks again: one failed load is not re-hammered per frame.
        for (let i = 0; i < 5; i++) tick(engine);
        await flush();
        expect(createFromOptions).toHaveBeenCalledTimes(attempt + 1);
        pastRetryPause();
        if (!last) expect(tick(engine).status).toBe(HANDS_STATUS.loading);
      }
      // Out of tries: latched, the engine still ticks and says so.
      for (let i = 0; i < 5; i++) expect(tick(engine).status).toBe(HANDS_STATUS.unavailable);
      await flush();
      expect(createFromOptions).toHaveBeenCalledTimes(MAIN_REPLACEMENT_RETRIES + 1);
      expect(error).toHaveBeenCalledTimes(MAIN_REPLACEMENT_RETRIES + 1);
      engine.dispose();
    } finally {
      error.mockRestore();
    }
  });

  it('a failed load is tried again after the pause, and the hands play when it lands', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createFromOptions.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    try {
      const engine = await boot();
      await until(() => tick(engine).status !== HANDS_STATUS.loading);
      expect(tick(engine).status).toBe(HANDS_STATUS.retrying);
      pastRetryPause();
      expect(tick(engine).status).toBe(HANDS_STATUS.loading);
      await until(() => tick(engine).status !== HANDS_STATUS.loading);
      expect(tick(engine).status).toBe(HANDS_STATUS.ready);
      expect(createFromOptions).toHaveBeenCalledTimes(2);
      step();
      expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
      engine.dispose();
    } finally {
      error.mockRestore();
    }
  });
});
