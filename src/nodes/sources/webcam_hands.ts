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
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { SOURCE_SLOT_OUTPUT } from './source_contract';
import { createFramePump, stampToTiming } from './frame_pump';
import type { NodeContext } from '@thoremin/dag';
import { MEDIAPIPE_MODELS_BASE, TASKS_VISION_WASM_BASE } from './tasks_vision';
import type { Hand, Handedness, HandsFrame, Keypoint } from '@thoremin/sdk/nodes/domain';
import { DelegateChoiceSchema, resolveDelegate } from './delegate';

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
});
type Params = z.infer<typeof Params>;

const EMPTY: HandsFrame = { width: 640, height: 480, hands: [] };

interface NormalizedLandmarkLike {
  x: number;
  y: number;
  z?: number;
}
interface CategoryLike {
  categoryName: string;
}
/** The minimal slice of a `HandLandmarkerResult` this node reads. */
export interface HandLandmarkerResultLike {
  landmarks: NormalizedLandmarkLike[][];
  /** Metric 3D landmarks (metres), roughly camera-pose-invariant — used for the
   *  rotation/scale-invariant finger features. Optional (older results omit it). */
  worldLandmarks?: NormalizedLandmarkLike[][];
  handedness: CategoryLike[][];
}

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

/** The host resource that says how many hands to look for (#325). */
export const HAND_COUNT_RESOURCE_KEY = 'handCount';

/**
 * How many hands to look for: the host's `handCount` resource, capped by `maxHands` and at
 * least one; `maxHands` when the host provides none or it returns no positive integer.
 */
export function wantedHands(resources: Record<string, unknown>, maxHands: number): number {
  const read = resources[HAND_COUNT_RESOURCE_KEY];
  const n = typeof read === 'function' ? (read as () => unknown)() : undefined;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? Math.min(n, maxHands) : maxHands;
}

/** The minimal runtime surface of tasks-vision used here (browser-only, lazy). */
export interface HandLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResultLike;
  /** Reconfigures the live landmarker; a `numHands` change rebuilds its graph, not the model. */
  setOptions(options: { numHands?: number }): Promise<void>;
  close(): void;
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

export const webcamHandsNode = defineNode<Params>({
  type: 'webcam-hands',
  roles: ['source'],
  title: 'Webcam Hands',
  description: 'MediaPipe hand landmark detection from a webcam video element.',
  inputs: [],
  outputs: [SOURCE_SLOT_OUTPUT],
  params: Params,
  make(p) {
    let landmarker: HandLandmarkerLike | null = null;
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
    const followHandCount = (lm: HandLandmarkerLike): boolean => {
      if (reconfiguring) return true;
      if (countFixed) return false;
      const want = wantedHands(resources, p.maxHands);
      if (want === numHands) return false;
      reconfiguring = true;
      // Through a resolved promise, so a synchronous throw lands in the same catch.
      Promise.resolve()
        .then(() => lm.setOptions({ numHands: want }))
        .then(() => {
          numHands = want;
        })
        .catch((err: unknown) => {
          // The old count stands for good: asking again on every frame would spin on the error.
          console.warn('[thoremin] hand model could not change its hand count', err);
          countFixed = true;
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
    const pump = createFramePump(
      () => video,
      (stamp, v) => {
        if (!landmarker || followHandCount(landmarker)) return false;
        try {
          const res = landmarker.detectForVideo(v, stamp.tMs);
          latest = { ...resultToHandsFrame(res, v.videoWidth, v.videoHeight), ...stampToTiming(stamp) };
        } catch {
          /* transient inference error; keep last frame */
        }
      },
    );

    const optionsFor = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      numHands,
      runningMode: 'VIDEO' as const,
    });

    return {
      async init(ctx: NodeContext) {
        video = ctx.resources.video as HTMLVideoElement | undefined;
        resources = ctx.resources;
        // Created looking for what the host wants now, so the first frames reconfigure nothing.
        numHands = wantedHands(resources, p.maxHands);
        const vision = (await import('@mediapipe/tasks-vision')) as unknown as TasksVisionModule;
        const fileset = await vision.FilesetResolver.forVisionTasks(TASKS_VISION_WASM_BASE);
        const delegate = resolveDelegate(p.delegate);
        try {
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, optionsFor(delegate));
        } catch (gpuErr) {
          // GPU/WebGL unavailable on this client → fall back to the CPU delegate. If CPU
          // was already chosen, the failure stands.
          if (delegate !== 'GPU') throw gpuErr;
          console.warn('[thoremin] hand model GPU delegate failed; falling back to CPU', gpuErr);
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, optionsFor('CPU'));
        }
        if (disposed) {
          // Unmounted while loading — don't resurrect.
          landmarker.close();
          landmarker = null;
          return;
        }
        pump.start();
      },
      process() {
        return { hands: latest };
      },
      dispose() {
        disposed = true;
        pump.stop();
        landmarker?.close();
        landmarker = null;
      },
    };
  },
});
