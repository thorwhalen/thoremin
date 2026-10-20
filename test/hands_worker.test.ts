/**
 * The hand model's worker side (`hands.worker.ts`, #326). `hand_runner.test.ts` drives the
 * page side against a fake worker; this file loads the worker script itself over a stubbed
 * `self` with tasks-vision mocked, and pins its half of the protocol: init loads the model on
 * the asked delegate (refusing the GPU without a WebGL2 OffscreenCanvas, so the page keeps the
 * GPU on the main thread), a frame is answered with the landmarks as plain data at its own
 * time and its bitmap always closed, a frame before the model or one that throws is a
 * frame-error, the hand count is changed live and its failure reported, and close lets the
 * model go.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromWorker, LandmarkerOptions, ToWorker } from '@/nodes/sources/hand_runner';

const tv = vi.hoisted(() => ({
  forVisionTasks: vi.fn(async (base: string) => ({ base })),
  createFromOptions: vi.fn(),
}));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: tv.forVisionTasks },
  HandLandmarker: { createFromOptions: tv.createFromOptions },
}));

const OPTIONS: LandmarkerOptions = { wasmBase: '/wasm', modelUrl: '/hand.task', delegate: 'CPU', numHands: 2 };

function landmarker() {
  return {
    detectForVideo: vi.fn((_img: unknown, _t: number) => ({
      landmarks: [[{ x: 0.1, y: 0.2, z: 0.3, visibility: 0.9 }]],
      worldLandmarks: [[{ x: 1, y: 2, z: 3, extra: true }]],
      handedness: [[{ categoryName: 'Left', score: 0.98, index: 0 }, { categoryName: 'Right', score: 0.02, index: 1 }]],
    })),
    setOptions: vi.fn(async (_o: { numHands?: number }) => undefined),
    close: vi.fn(),
  };
}

let posted: FromWorker[];
let send: (m: ToWorker) => void;

beforeEach(async () => {
  vi.resetModules();
  posted = [];
  const self = { postMessage: (m: FromWorker) => posted.push(m), onmessage: null as null | ((ev: { data: ToWorker }) => void) };
  vi.stubGlobal('self', self);
  await import('@/nodes/sources/hands.worker');
  send = (m) => self.onmessage!({ data: m });
});
afterEach(() => {
  vi.unstubAllGlobals();
  tv.createFromOptions.mockReset();
  tv.forVisionTasks.mockClear();
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };

const ready = async (lm = landmarker(), options: LandmarkerOptions = OPTIONS) => {
  tv.createFromOptions.mockResolvedValue(lm);
  send({ type: 'init', options });
  await flush();
  return lm;
};

describe('the hand model worker', () => {
  it('loads the model on the delegate asked for, in video mode, and says ready', async () => {
    await ready();
    expect(tv.forVisionTasks).toHaveBeenCalledWith('/wasm');
    expect(tv.createFromOptions).toHaveBeenCalledWith({ base: '/wasm' }, { baseOptions: { modelAssetPath: '/hand.task', delegate: 'CPU' }, numHands: 2, runningMode: 'VIDEO' });
    expect(posted).toEqual([{ type: 'ready', delegate: 'CPU' }]);
  });

  it('refuses the GPU delegate without OffscreenCanvas, or without WebGL2 in it', async () => {
    send({ type: 'init', options: { ...OPTIONS, delegate: 'GPU' } });
    await flush();
    expect(posted.at(-1)).toEqual({ type: 'init-error', message: 'no WebGL2 OffscreenCanvas in the worker' });
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null;
        }
      },
    );
    send({ type: 'init', options: { ...OPTIONS, delegate: 'GPU' } });
    await flush();
    expect(posted.at(-1)).toMatchObject({ type: 'init-error' });
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext(): never {
          throw new Error('context lost');
        }
      },
    );
    send({ type: 'init', options: { ...OPTIONS, delegate: 'GPU' } });
    await flush();
    expect(posted.at(-1)).toMatchObject({ type: 'init-error' });
    expect(tv.createFromOptions).not.toHaveBeenCalled();
  });

  it('loads on the GPU when WebGL2 is there, giving the probe context back', async () => {
    const loseContext = vi.fn();
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext(kind: string) {
          return kind === 'webgl2' ? { getExtension: () => ({ loseContext }) } : null;
        }
      },
    );
    await ready(landmarker(), { ...OPTIONS, delegate: 'GPU' });
    expect(loseContext).toHaveBeenCalledOnce();
    expect(posted).toEqual([{ type: 'ready', delegate: 'GPU' }]);
  });

  it('reports a model that cannot load, with its message', async () => {
    tv.createFromOptions.mockRejectedValueOnce(new Error('404 model'));
    send({ type: 'init', options: OPTIONS });
    await flush();
    expect(posted).toEqual([{ type: 'init-error', message: '404 model' }]);
    tv.createFromOptions.mockRejectedValueOnce('plain refusal');
    send({ type: 'init', options: OPTIONS });
    await flush();
    expect(posted.at(-1)).toEqual({ type: 'init-error', message: 'plain refusal' });
  });

  it('answers a frame with the landmarks as plain data at its own time, and closes the bitmap', async () => {
    const lm = await ready();
    const b = bitmap();
    send({ type: 'frame', id: 7, bitmap: b, tMs: 1234 });
    expect(lm.detectForVideo).toHaveBeenCalledWith(b, 1234);
    expect(posted.at(-1)).toEqual({
      type: 'result',
      id: 7,
      result: {
        landmarks: [[{ x: 0.1, y: 0.2, z: 0.3 }]],
        worldLandmarks: [[{ x: 1, y: 2, z: 3 }]],
        handedness: [[{ categoryName: 'Left' }]],
      },
    });
    expect(b.close).toHaveBeenCalledOnce();
  });

  it('a result without world landmarks keeps them absent', async () => {
    const lm = landmarker();
    lm.detectForVideo.mockReturnValueOnce({ landmarks: [], handedness: [] } as never);
    await ready(lm);
    send({ type: 'frame', id: 1, bitmap: bitmap(), tMs: 0 });
    expect(posted.at(-1)).toEqual({ type: 'result', id: 1, result: { landmarks: [], worldLandmarks: undefined, handedness: [] } });
  });

  it('a frame before the model, or one the model throws on, is a frame-error; the bitmap is closed either way', async () => {
    const early = bitmap();
    send({ type: 'frame', id: 1, bitmap: early, tMs: 0 });
    expect(posted).toEqual([{ type: 'frame-error', id: 1 }]);
    expect(early.close).toHaveBeenCalledOnce();
    const lm = await ready();
    lm.detectForVideo.mockImplementationOnce(() => {
      throw new Error('graph error');
    });
    const b = bitmap();
    send({ type: 'frame', id: 2, bitmap: b, tMs: 0 });
    expect(posted.at(-1)).toEqual({ type: 'frame-error', id: 2 });
    expect(b.close).toHaveBeenCalledOnce();
  });

  it('changes the hand count on the live model, reporting a failure; before the model it says so', async () => {
    send({ type: 'numHands', id: 1, n: 1 });
    expect(posted).toEqual([{ type: 'numHands-done', id: 1, error: 'not loaded' }]);
    const lm = await ready();
    send({ type: 'numHands', id: 2, n: 1 });
    await flush();
    expect(lm.setOptions).toHaveBeenCalledWith({ numHands: 1 });
    expect(posted.at(-1)).toEqual({ type: 'numHands-done', id: 2 });
    lm.setOptions.mockRejectedValueOnce(new Error('graph rebuild failed'));
    send({ type: 'numHands', id: 3, n: 2 });
    await flush();
    expect(posted.at(-1)).toEqual({ type: 'numHands-done', id: 3, error: 'graph rebuild failed' });
    lm.setOptions.mockRejectedValueOnce('odd');
    send({ type: 'numHands', id: 4, n: 2 });
    await flush();
    expect(posted.at(-1)).toEqual({ type: 'numHands-done', id: 4, error: 'odd' });
  });

  it('close lets the model go; a frame after it is a frame-error', async () => {
    const lm = await ready();
    send({ type: 'close' });
    expect(lm.close).toHaveBeenCalledOnce();
    send({ type: 'close' });
    send({ type: 'frame', id: 9, bitmap: bitmap(), tMs: 0 });
    expect(posted.at(-1)).toEqual({ type: 'frame-error', id: 9 });
  });
});
