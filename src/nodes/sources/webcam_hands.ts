/**
 * `webcam-hands` source node (browser-only) — runs MediaPipe `HandLandmarker`
 * (from `@mediapipe/tasks-vision`) on a host-provided `<video>` and outputs the
 * latest {@link HandsFrame}.
 *
 * It uses **tasks-vision** — the SAME runtime as `webcam-face` — rather than the
 * `@mediapipe/hands` Emscripten "solution" (via @tensorflow-models/hand-pose-
 * detection's `runtime: 'mediapipe'`). Two *different* MediaPipe Emscripten
 * modules collide on the global `Module` object, which aborts the FaceLandmarker
 * load whenever both are present. Running hands and face on one tasks-vision
 * runtime lets them coexist (one Emscripten module hosting two tasks), and keeps
 * both at first-class MediaPipe quality.
 *
 * Key design point: ML inference is async and slower than the render loop, so
 * detection runs in its own loop and caches the latest result. `process` simply
 * returns that cache — decoupling detection rate from the engine tick rate. The
 * `<video>` element is injected via `ctx.resources.video`.
 *
 * How many hands it looks for is the host's to say (#325), through
 * `ctx.resources.handCount` (`src/instruments/hands.ts` derives it from what the composed
 * instrument and the open tools read), capped by `maxHands`. Looking for fewer hands is most
 * of the model's cost, and the count changes on the LIVE landmarker (`setOptions`, no model
 * reload), so switching instrument never reloads MediaPipe. Without the resource (a host
 * that does not say) it looks for `maxHands`, as it always did.
 *
 * Where the model runs is a seam (#326, `hand_runner.ts`): the main thread, as it always did
 * (the default, `runner: 'main'`), or a Web Worker that leaves the tick free, with the main
 * thread as its automatic fallback. The host may override the param through
 * `ctx.resources.handRunner` (`?hands.runner=`). Either way the frame pump on this thread
 * stamps every frame, so a result always carries its own frame's capture time.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { SOURCE_SLOT_OUTPUT } from './source_contract';
import { acquireFramePump, stampToTiming } from './frame_pump';
import type { NodeContext } from '@thoremin/dag';
import { MEDIAPIPE_MODELS_BASE, TASKS_VISION_WASM_BASE } from './tasks_vision';
import type { Hand, Handedness, HandsFrame, Keypoint } from '@thoremin/sdk/nodes/domain';
import { DelegateChoiceSchema, resolveDelegate } from './delegate';
import { copyFramesOnCpu } from './model_input';
import {
  canHostHandWorker,
  createHandRunner,
  HandRunnerChoiceSchema,
  type HandLandmarkerLike,
  type HandResult,
  type HandRunner,
  type HandRunnerChoice,
  type LoadLandmarker,
  type WorkerLike,
  type WorkerRunnerDeps,
} from './hand_runner';
import { HAND_COUNT_RESOURCE_KEY, HAND_RUNNER_RESOURCE_KEY } from './webcam_hands.schema';
import { type HandLandmarkerResultLike } from './webcam_hands.schema';
export type { HandLandmarkerResultLike } from './webcam_hands.schema';
export { HAND_COUNT_RESOURCE_KEY, HAND_RUNNER_RESOURCE_KEY } from './webcam_hands.schema';

// tasks-vision assets, loaded from a CDN on demand. The wasm fileset is pinned to
// the installed `@mediapipe/tasks-vision` version (shared with `webcam-face`), and
// the model is the float16 `hand_landmarker.task` (21 landmarks per hand).
const MODEL_URL =
  `${MEDIAPIPE_MODELS_BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;

const Params = z.object({
  // Retained for graph/preset compatibility; tasks-vision ships a single
  // float16 hand model, so this does not select a model variant today.
  modelType: z.enum(['lite', 'full']).default('full'),
  /** The most hands it ever looks for; the host's `handCount` may ask for fewer. */
  maxHands: z.number().int().min(1).max(4).default(2),
  /** Which delegate runs the model: `auto` (the default) picks the CPU on a software
   *  WebGL renderer and the GPU otherwise (`delegate.ts`, #240); `GPU` / `CPU` force one. */
  delegate: DelegateChoiceSchema.default('auto'),
  /** Where the model runs (#326): `main` (the default, as before), `worker` (a Web Worker,
   *  falling back to the main thread by itself where it cannot start), or `auto` (the worker
   *  where the browser can host one). The worker trades a little lead for a regular tick, so
   *  the default waits on the maintainer (#168 D14); `hand_runner.ts` has the numbers. */
  runner: HandRunnerChoiceSchema.default('main'),
});
type Params = z.infer<typeof Params>;

const EMPTY: HandsFrame = { width: 640, height: 480, hands: [] };

/**
 * Pure converter: a tasks-vision `HandLandmarkerResult` (normalized landmarks,
 * 0..1) → a {@link HandsFrame} with pixel keypoints in MediaPipe's 21-point order
 * and 'Left'/'Right' handedness. Exported so it can be unit-tested headlessly
 * (the live inference itself is browser-only). Landmark indices are unchanged, so
 * `kp()`/`LM` keep working downstream (the names are absent, but lookups fall back
 * to the index).
 */
export function resultToHandsFrame(res: HandLandmarkerResultLike, w: number, h: number): HandsFrame {
  const hands: Hand[] = (res.landmarks ?? []).map((lms, i) => ({
    handedness: (res.handedness?.[i]?.[0]?.categoryName as Handedness) ?? 'Right',
    keypoints: lms.map((l): Keypoint => ({ x: l.x * w, y: l.y * h, z: l.z })),
    // World landmarks stay in metres (not scaled to pixels) so 3D distances between
    // them are metric + view-invariant. Absent → downstream falls back to 2D.
    worldKeypoints: res.worldLandmarks?.[i]?.map((l): Keypoint => ({ x: l.x, y: l.y, z: l.z })),
  }));
  return { width: w, height: h, hands };
}

/**
 * How many hands to look for: the host's `handCount` resource, capped by `maxHands` and at
 * least one; `maxHands` when the host provides none or it returns no positive integer.
 */
export function wantedHands(resources: Record<string, unknown>, maxHands: number): number {
  const read = resources[HAND_COUNT_RESOURCE_KEY];
  const n = typeof read === 'function' ? (read as () => unknown)() : undefined;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? Math.min(n, maxHands) : maxHands;
}

export type { HandLandmarkerLike } from './hand_runner';

interface TasksVisionModule {
  FilesetResolver: { forVisionTasks(wasmBase: string): Promise<unknown> };
  HandLandmarker: {
    createFromOptions(
      fileset: unknown,
      opts: {
        baseOptions: { modelAssetPath: string; delegate?: 'GPU' | 'CPU' };
        numHands?: number;
        runningMode?: 'IMAGE' | 'VIDEO';
      },
    ): Promise<HandLandmarkerLike>;
  };
}

/** The main thread's loader: today's, with its GPU-to-CPU fallback (unless the runner asks
 *  for the GPU alone, to put the CPU delegate in its worker, #326). */
const loadOnMain: LoadLandmarker = async (o, { cpuFallback = true } = {}) => {
  const vision = (await import('@mediapipe/tasks-vision')) as unknown as TasksVisionModule;
  const fileset = await vision.FilesetResolver.forVisionTasks(o.wasmBase);
  const optionsFor = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: o.modelUrl, delegate },
    numHands: o.numHands,
    runningMode: 'VIDEO' as const,
  });
  try {
    // The CPU delegate is handed a copy of each frame, never the element (#324, `model_input.ts`).
    return copyFramesOnCpu(await vision.HandLandmarker.createFromOptions(fileset, optionsFor(o.delegate)), o.delegate);
  } catch (gpuErr) {
    // GPU/WebGL unavailable on this client → fall back to the CPU delegate. If CPU
    // was already chosen, the failure stands.
    if (o.delegate !== 'GPU' || !cpuFallback) throw gpuErr;
    console.warn('[thoremin] hand model GPU delegate failed; falling back to CPU', gpuErr);
    return copyFramesOnCpu(await vision.HandLandmarker.createFromOptions(fileset, optionsFor('CPU')), 'CPU');
  }
};

/** The worker runner's browser dependencies, where this browser can host it. */
function browserWorkerDeps(): WorkerRunnerDeps | undefined {
  if (!canHostHandWorker()) return undefined;
  return {
    // Written inline so Vite finds and bundles the worker (a classic one: see the worker).
    createWorker: () => new Worker(new URL('./hands.worker.ts', import.meta.url)) as unknown as WorkerLike,
    createImageBitmap: (video) => createImageBitmap(video),
  };
}

/** Where to run: the host's override when it gives a valid one, else the param. */
export function runnerChoice(resources: Record<string, unknown>, param: HandRunnerChoice): HandRunnerChoice {
  const parsed = HandRunnerChoiceSchema.safeParse(resources[HAND_RUNNER_RESOURCE_KEY]);
  return parsed.success ? parsed.data : param;
}

export const webcamHandsNode = defineNode<Params>({
  type: 'webcam-hands',
  roles: ['source'],
  title: 'Webcam Hands',
  description: 'MediaPipe hand landmark detection from a webcam video element.',
  inputs: [],
  outputs: [SOURCE_SLOT_OUTPUT],
  params: Params,
  make(p) {
    let runner: HandRunner | null = null;
    let latest: HandsFrame = EMPTY;
    let disposed = false;
    let video: HTMLVideoElement | undefined;
    let resources: Record<string, unknown> = {};
    // The count the landmarker was configured with, and whether a change is in flight.
    let numHands = p.maxHands;
    let reconfiguring = false;
    let countFixed = false;

    /** Follow the host's count on the live landmarker. True while a change is in flight
     *  (the frame is then offered again on the next animation frame). */
    const followHandCount = (lm: HandRunner): boolean => {
      if (reconfiguring) return true;
      if (countFixed) return false;
      const want = wantedHands(resources, p.maxHands);
      if (want === numHands) return false;
      reconfiguring = true;
      const before = numHands;
      // A landmarker closed (or replaced) before the change runs is left alone: `setOptions`
      // would rebuild a graph on it that nothing ever frees.
      const live = (): boolean => !disposed && runner === lm;
      // Through a resolved promise, so a synchronous throw lands in the same catch.
      Promise.resolve()
        .then(() => (live() ? lm.setNumHands(want) : undefined))
        .then(() => {
          numHands = want;
        })
        .catch(async (err: unknown) => {
          // A failed rebuild may leave the landmarker without a graph, so the old count is put
          // back once; either way it stands for good (asking on every frame would spin).
          countFixed = true;
          console.warn('[thoremin] hand model could not change its hand count; keeping', before, err);
          try {
            if (live()) await lm.setNumHands(before);
          } catch (restoreErr) {
            console.error('[thoremin] hand model could not restore its hand count; hands may stop', restoreErr);
          }
        })
        .finally(() => {
          reconfiguring = false;
        });
      return true;
    };

    // One inference per captured frame, stamped with the frame's CAPTURE time (#226):
    // the pump reads `requestVideoFrameCallback`'s `captureTime` where the browser
    // has it and polls `currentTime` under `requestAnimationFrame` where it does not.
    // The stamp is strictly increasing, which is what detectForVideo requires.
    const pump = acquireFramePump(
      () => video,
      (stamp, v) => {
        if (!runner || followHandCount(runner)) return false;
        return runner.offer(v, stamp);
      },
    );

    /** A runner's result, now (main thread) or when the worker answers: the latest frame,
     *  with the timing of the frame it ran on. */
    const onResult = ({ result, width, height, stamp }: HandResult): void => {
      if (!disposed) latest = { ...resultToHandsFrame(result, width, height), ...stampToTiming(stamp) };
    };

    return {
      async init(ctx: NodeContext) {
        video = ctx.resources.video as HTMLVideoElement | undefined;
        resources = ctx.resources;
        // Created looking for what the host wants now, so the first frames reconfigure nothing.
        numHands = wantedHands(resources, p.maxHands);
        const options = { wasmBase: TASKS_VISION_WASM_BASE, modelUrl: MODEL_URL, delegate: resolveDelegate(p.delegate), numHands };
        const loaded = await createHandRunner(runnerChoice(resources, p.runner), options, onResult, {
          loadMain: loadOnMain,
          worker: browserWorkerDeps(),
        });
        if (disposed) {
          // Unmounted while loading — don't resurrect.
          loaded.close();
          return;
        }
        runner = loaded;
        pump.start();
      },
      process() {
        return { hands: latest };
      },
      dispose() {
        disposed = true;
        pump.stop();
        runner?.close();
        runner = null;
      },
    };
  },
});
