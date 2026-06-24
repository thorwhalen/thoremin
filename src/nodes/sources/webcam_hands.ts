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
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { Hand, Handedness, HandsFrame, Keypoint } from '../domain';

// tasks-vision assets, loaded from a CDN on demand. The wasm fileset is pinned to
// the installed `@mediapipe/tasks-vision` version (shared with `webcam-face`), and
// the model is the float16 `hand_landmarker.task` (21 landmarks per hand).
const TASKS_VISION_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const Params = z.object({
  // Retained for graph/preset compatibility; tasks-vision ships a single
  // float16 hand model, so this does not select a model variant today.
  modelType: z.enum(['lite', 'full']).default('full'),
  maxHands: z.number().int().min(1).max(4).default(2),
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
  }));
  return { width: w, height: h, hands };
}

/** The minimal runtime surface of tasks-vision used here (browser-only, lazy). */
interface HandLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResultLike;
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
  outputs: [{ name: 'hands', kind: 'hands-frame' }],
  params: Params,
  make(p) {
    let landmarker: HandLandmarkerLike | null = null;
    let latest: HandsFrame = EMPTY;
    let raf: number | null = null;
    let disposed = false;
    let video: HTMLVideoElement | undefined;
    let lastVideoTime = -1;

    const loop = () => {
      if (disposed) return;
      // Only run inference on a fresh, ready video frame; performance.now() is
      // monotonic, satisfying detectForVideo's strictly-increasing-timestamp rule.
      if (
        landmarker &&
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        try {
          const res = landmarker.detectForVideo(video, performance.now());
          latest = resultToHandsFrame(res, video.videoWidth, video.videoHeight);
        } catch {
          /* transient inference error; keep last frame */
        }
      }
      raf = requestAnimationFrame(loop);
    };

    const optionsFor = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      numHands: p.maxHands,
      runningMode: 'VIDEO' as const,
    });

    return {
      async init(ctx: NodeContext) {
        video = ctx.resources.video as HTMLVideoElement | undefined;
        const vision = (await import('@mediapipe/tasks-vision')) as unknown as TasksVisionModule;
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
        try {
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, optionsFor('GPU'));
        } catch (gpuErr) {
          // GPU/WebGL unavailable on this client → fall back to the CPU delegate.
          console.warn('[thoremin] hand model GPU delegate failed; falling back to CPU', gpuErr);
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, optionsFor('CPU'));
        }
        if (disposed) {
          // Unmounted while loading — don't resurrect.
          landmarker.close();
          landmarker = null;
          return;
        }
        raf = requestAnimationFrame(loop);
      },
      process() {
        return { hands: latest };
      },
      dispose() {
        disposed = true;
        if (raf !== null) cancelAnimationFrame(raf);
        landmarker?.close();
        landmarker = null;
      },
    };
  },
});
