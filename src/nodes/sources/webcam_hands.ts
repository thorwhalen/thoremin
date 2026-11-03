/**
 * `webcam-hands` source node (browser-only) — runs MediaPipe `HandLandmarker`
 * (from `@mediapipe/tasks-vision`) on a host-provided `<video>` and outputs the
 * latest {@link HandsFrame}.
 *
 * It uses **tasks-vision** — the SAME runtime as `webcam-face` — rather than the
 * old `@mediapipe/hands` Emscripten "solution" (retired in #816). Two *different* MediaPipe Emscripten
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
 *
 * The runner is a `lazyResource` (`@thoremin/lazy`, #922, as `webcam-body` holds its landmarker):
 * requested from `process()`, so the graph starts (and a swap commits) without waiting for the
 * model; the pump starts once it is held; a load that lands after `dispose()` is closed on arrival;
 * a failed load is tried again on the same policy as a dead worker's replacement.
 */
import { READS_VIDEO, VIDEO_RESOURCE_KEY } from '@thoremin/sdk/sources/video';
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { lazyResource, type LoadResult, type LoadStatus } from '@thoremin/lazy';
import { SOURCE_SLOT_OUTPUT, SOURCE_SLOT_STATUS, type HandsStatus } from './source_contract';
import { acquireFramePump, stampToTiming } from './frame_pump';
import type { NodeContext } from '@thoremin/dag';
import { HAND_MODEL_URL, TASKS_VISION_WASM_BASE } from './tasks_vision';
import type { Hand, Handedness, HandsFrame, Keypoint } from '@thoremin/sdk/nodes/domain';
import { DelegateChoiceSchema, resolveDelegate } from './delegate';
import { copyFramesOnCpu } from './model_input';
import {
  canHostHandWorker,
  createHandRunner,
  HandRunnerChoiceSchema,
  MAIN_REPLACEMENT_RETRIES,
  MAIN_REPLACEMENT_RETRY_MS,
  type HandLandmarkerLike,
  type HandResult,
  type HandRunner,
  type HandRunnerChoice,
  type HandRunnerState,
  type LoadLandmarker,
  type WorkerLike,
  type WorkerRunnerDeps,
} from './hand_runner';
import { FRAME_HOLD_RESOURCE_KEY, type FrameHold } from '@thoremin/sdk/view/frame_hold';
import { HAND_COUNT_RESOURCE_KEY, HAND_RUNNER_RESOURCE_KEY } from './webcam_hands.schema';
import { type HandLandmarkerResultLike } from './webcam_hands.schema';
export type { HandLandmarkerResultLike } from './webcam_hands.schema';
export { HAND_COUNT_RESOURCE_KEY, HAND_RUNNER_RESOURCE_KEY } from './webcam_hands.schema';

// tasks-vision assets, loaded from a CDN on demand. The wasm fileset is pinned to
// the installed `@mediapipe/tasks-vision` version (shared with `webcam-face`), and
// the model is the float16 `hand_landmarker.task` (21 landmarks per hand).
const MODEL_URL = HAND_MODEL_URL;

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

/**
 * Keep the frame `video` shows now under capture time `t` (seconds) in `hold`, when the host
 * installed one (#842). The snapshot is async and best-effort: a frame that cannot be copied is
 * simply not held, and the overlay falls back to the live video for it.
 */
export function holdFrame(
  hold: FrameHold<ImageBitmap> | undefined,
  video: HTMLVideoElement,
  t: number,
  snapshot: (v: HTMLVideoElement) => Promise<ImageBitmap> = (v) => createImageBitmap(v),
): void {
  if (!hold) return;
  snapshot(video).then((bitmap) => hold.put(t, bitmap), () => {});
}

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

/**
 * The source's lifecycle as words (#737), one frozen object per state so a tick allocates none.
 *
 * Since #922 the model loads WITHOUT holding the graph, so the instrument starts at once (and a
 * swap commits at once): the port says `loading` until the runner exists, `retrying` while a failed
 * load waits to be tried again, and `unavailable` once it is out of tries (offline, no WebGL and no
 * CPU path). After that it says what the runner goes through: a dead worker's main-thread
 * replacement loading, waiting to try again, or out of tries.
 */
export const HANDS_STATUS = {
  loading: Object.freeze({ phase: 'loading', message: 'Loading the hand model' }),
  unavailable: Object.freeze({ phase: 'error', reason: 'error', message: 'The hand model could not load (offline?); reload the page' }),
  replacing: Object.freeze({ phase: 'loading', message: 'The hand model is moving to the main thread' }),
  retrying: Object.freeze({ phase: 'loading', message: 'The hand model could not load; trying again' }),
  failed: Object.freeze({ phase: 'error', reason: 'error', message: 'The hand model stopped and could not load again (offline?); reload the page' }),
  ready: Object.freeze({ phase: 'ready', message: 'Hand model ready' }),
  active: Object.freeze({ phase: 'active', message: 'Hands detected' }),
} as const satisfies Record<string, HandsStatus>;

/**
 * What the hand source says (#737): what its runner is going through while it is not inferring
 * (replacing, retrying, failed); else ready, or active while a hand is in the frame. A runner with
 * no `state` (one thread for good) is always running. Pure.
 */
export function handsStatus(state: HandRunnerState, handsInView: boolean): HandsStatus {
  if (state !== 'running') return HANDS_STATUS[state];
  return handsInView ? HANDS_STATUS.active : HANDS_STATUS.ready;
}

/** The reason a failed load gives while it will be tried again (`LoadResult.retry`). */
const RETRYING_REASON = 'retrying';

/**
 * What the hand source says before its runner is held (#922), from its `lazyResource`'s status:
 * waiting to try a failed load again, out of tries (or a load that broke), else loading. Pure.
 */
export function handsLoadStatus(load: LoadStatus): HandsStatus {
  if (load.phase === 'unavailable' && load.reason === RETRYING_REASON) return HANDS_STATUS.retrying;
  if (load.phase === 'unavailable' || load.phase === 'error') return HANDS_STATUS.unavailable;
  return HANDS_STATUS.loading;
}

/** Where to run: the host's override when it gives a valid one, else the param. */
export function runnerChoice(resources: Record<string, unknown>, param: HandRunnerChoice): HandRunnerChoice {
  const parsed = HandRunnerChoiceSchema.safeParse(resources[HAND_RUNNER_RESOURCE_KEY]);
  return parsed.success ? parsed.data : param;
}

export const webcamHandsNode = defineNode<Params>({
  type: 'webcam-hands',
  roles: ['source'],
  // A camera model: the host opens the camera while a composed node reads the video (#960).
  reads: READS_VIDEO,
  title: 'Webcam Hands',
  description: 'MediaPipe hand landmark detection from a webcam video element.',
  inputs: [],
  outputs: [SOURCE_SLOT_OUTPUT, SOURCE_SLOT_STATUS],
  params: Params,
  make(p) {
    let latest: HandsFrame = EMPTY;
    let disposed = false;
    let video: HTMLVideoElement | undefined;
    let resources: Record<string, unknown> = {};
    // The count the landmarker was configured with, and whether a change is in flight.
    let numHands = p.maxHands;
    let reconfiguring = false;
    let countFixed = false;
    /** Loads that failed so far: tried again `MAIN_REPLACEMENT_RETRIES` times, as a dead worker's
     *  replacement is, then the source says it is unavailable. */
    let failures = 0;

    /** A runner's result, now (main thread) or when the worker answers: the latest frame,
     *  with the timing of the frame it ran on. */
    const onResult = ({ result, width, height, stamp }: HandResult): void => {
      if (!disposed) latest = { ...resultToHandsFrame(result, width, height), ...stampToTiming(stamp) };
    };

    const runner = lazyResource<HandRunner>({
      load: async (): Promise<LoadResult<HandRunner>> => {
        // Created looking for what the host wants now, so the first frames reconfigure nothing.
        numHands = wantedHands(resources, p.maxHands);
        const options = { wasmBase: TASKS_VISION_WASM_BASE, modelUrl: MODEL_URL, delegate: resolveDelegate(p.delegate), numHands };
        try {
          const deps = { loadMain: loadOnMain, worker: browserWorkerDeps() };
          return { resource: await createHandRunner(runnerChoice(resources, p.runner), options, onResult, deps) };
        } catch (err) {
          failures += 1;
          const retry = failures <= MAIN_REPLACEMENT_RETRIES;
          console.error(`[thoremin] the hand model could not load${retry ? `; trying again in ${MAIN_REPLACEMENT_RETRY_MS} ms` : ''}`, err);
          return { resource: null, reason: retry ? RETRYING_REASON : 'error', retry };
        }
      },
      unload: (r) => r.close(),
      retryDelayMs: MAIN_REPLACEMENT_RETRY_MS,
      label: 'hand model',
      log: (m) => console.warn(`[thoremin] ${m}`),
    });

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
      const live = (): boolean => !disposed && runner.current() === lm;
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
        const lm = runner.current();
        if (!lm || followHandCount(lm)) return false;
        // The held-frame option (#842): keep each frame that is really inferred (not the ones a
        // busy worker drops), by its stamp, for the overlay to draw. Snapshotted in this callback,
        // like the model's own.
        const hold = resources[FRAME_HOLD_RESOURCE_KEY] as FrameHold<ImageBitmap> | undefined;
        return lm.offer(v, stamp, hold && ((video, s) => holdFrame(hold, video, s.tMs / 1000)));
      },
    );

    return {
      init(ctx: NodeContext) {
        // Cheap: the shared <video> and the host's resources. The model is requested by `process`.
        video = ctx.resources[VIDEO_RESOURCE_KEY] as HTMLVideoElement | undefined;
        resources = ctx.resources;
      },
      process() {
        runner.request();
        const lm = runner.current();
        if (!lm) return { hands: EMPTY, status: handsLoadStatus(runner.status()) };
        pump.start();
        const state = lm.state?.() ?? 'running';
        // Not inferring (a dead worker being replaced, or out of tries): the last frame is stale,
        // so it is dropped rather than held. A held frame would keep a voice droning and a
        // skeleton drawn beside the overlay's "Hands: ... stopped" (#737).
        if (state !== 'running') latest = EMPTY;
        return { hands: latest, status: handsStatus(state, latest.hands.length > 0) };
      },
      dispose() {
        disposed = true;
        pump.stop();
        // Closes a held runner, and one that lands later on arrival.
        runner.dispose();
      },
    };
  },
});
