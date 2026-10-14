/**
 * The hand model in a Web Worker (#326): the other side of `hand_runner.ts`'s worker runner.
 *
 * It loads MediaPipe's `HandLandmarker` on this thread (its own tasks-vision runtime: a
 * worker has its own globals, so it cannot collide with the face and body models' runtime on
 * the main thread), then infers on each `ImageBitmap` the page transfers, at the frame's own
 * capture time, and posts the landmarks back. The page sends one frame at a time, so this
 * side keeps no queue; it closes every bitmap it is given.
 *
 * A classic worker (Vite bundles it as an IIFE): tasks-vision loads its wasm loader with
 * `importScripts`, which a module worker does not have.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { FromWorker, HandLandmarkerLike, LandmarkerOptions, ToWorker } from './hand_runner';
import type { HandLandmarkerResultLike } from './webcam_hands';

const post = (m: FromWorker): void => (self as unknown as { postMessage(m: FromWorker): void }).postMessage(m);

let landmarker: HandLandmarkerLike | null = null;

/** Whether this worker can give the GPU delegate a WebGL2 context. */
function hasWebGl2(): boolean {
  try {
    return typeof OffscreenCanvas === 'function' && new OffscreenCanvas(1, 1).getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** The slice of a result the page reads, as plain data (the rest does not clone cheaply). */
function slim(r: HandLandmarkerResultLike): HandLandmarkerResultLike {
  return {
    landmarks: r.landmarks.map((h) => h.map(({ x, y, z }) => ({ x, y, z }))),
    worldLandmarks: r.worldLandmarks?.map((h) => h.map(({ x, y, z }) => ({ x, y, z }))),
    handedness: r.handedness.map((cs) => cs.slice(0, 1).map(({ categoryName }) => ({ categoryName }))),
  };
}

async function init(o: LandmarkerOptions): Promise<void> {
  // The GPU delegate needs WebGL2 in THIS worker. Without it the page keeps the GPU on the
  // main thread rather than moving the model onto a slower delegate here.
  if (o.delegate === 'GPU' && !hasWebGl2()) throw new Error('no WebGL2 OffscreenCanvas in the worker');
  const fileset = await FilesetResolver.forVisionTasks(o.wasmBase);
  landmarker = (await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: o.modelUrl, delegate: o.delegate },
    numHands: o.numHands,
    runningMode: 'VIDEO',
  })) as unknown as HandLandmarkerLike;
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'init') {
    init(m.options).then(
      () => post({ type: 'ready', delegate: m.options.delegate }),
      (err: unknown) => post({ type: 'init-error', message: String(err instanceof Error ? err.message : err) }),
    );
  } else if (m.type === 'frame') {
    try {
      if (!landmarker) throw new Error('not loaded');
      post({ type: 'result', id: m.id, result: slim(landmarker.detectForVideo(m.bitmap, m.tMs)) });
    } catch {
      post({ type: 'frame-error', id: m.id });
    } finally {
      m.bitmap.close();
    }
  } else if (m.type === 'numHands') {
    const done = (error?: string): void => post({ type: 'numHands-done', id: m.id, ...(error === undefined ? {} : { error }) });
    if (!landmarker) done('not loaded');
    else
      Promise.resolve()
        .then(() => landmarker!.setOptions({ numHands: m.n }))
        .then(
          () => done(),
          (err: unknown) => done(String(err instanceof Error ? err.message : err)),
        );
  } else if (m.type === 'close') {
    landmarker?.close();
    landmarker = null;
  }
};
