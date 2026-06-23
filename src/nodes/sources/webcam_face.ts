/**
 * `webcam-face` source node (browser-only) — runs MediaPipe FaceLandmarker on
 * the shared host `<video>` and outputs the latest {@link FaceFrame} (the 52
 * blendshape scores). It is the live counterpart of the offline
 * `scripts/video_to_face.py`, and emits the *same* `{ present, blendshapes }`
 * shape (identical blendshape keys) as the recorded face fixture, so it replays
 * validly against `face-features`. (The offline fixture additionally rounds
 * scores to 5 dp, so individual values are not bit-identical.)
 *
 * Three design points, all required by issue #50:
 *
 * 1. **Off by default, lazy.** The heavy `@mediapipe/tasks-vision` runtime and
 *    the model weights are loaded on first *enable* (read from the live controls
 *    store via `ctx.resources.controls().faceEnabled`), never at startup — so a
 *    player who never turns on face control pays nothing, and `engine.init()` is
 *    never blocked. `init()` only captures the shared `<video>` handle.
 * 2. **Lazy offload.** When face control is toggled back off, the landmarker is
 *    released (`FaceLandmarker.close()`) and its loop cancelled, so two
 *    always-on ML models (hands + face) don't compete for the tick budget.
 * 3. **Detached inference, like `webcam-hands`.** Inference runs in its own
 *    `requestAnimationFrame` loop and caches the latest frame; `process()` just
 *    returns that cache — decoupling detection rate from the engine tick rate
 *    and guaranteeing the first tick after enabling never blocks.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { FaceFrame } from '../domain';

// MediaPipe FaceLandmarker assets, loaded from a CDN on demand (mirrors how
// `webcam-hands` resolves its MediaPipe solution from jsDelivr). The wasm
// fileset is pinned to the installed `@mediapipe/tasks-vision` version so the
// runtime matches the imported JS API. The model is the float16
// `face_landmarker.task` — the same model family `scripts/video_to_face.py`
// uses, so live and recorded blendshapes are shape-compatible (same model,
// identical blendshape names).
const TASKS_VISION_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const Params = z.object({
  /** Run inference on the GPU (WebGL) when available, else CPU. */
  delegate: z.enum(['GPU', 'CPU']).default('GPU'),
});
type Params = z.infer<typeof Params>;

const ABSENT_FRAME: FaceFrame = { present: false, blendshapes: {} };

/** The minimal slice of a `FaceLandmarkerResult` this node reads. */
export interface FaceLandmarkerResultLike {
  faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
}

/**
 * Pure converter: a MediaPipe FaceLandmarker result → a {@link FaceFrame}.
 * Exported so it can be unit-tested headlessly (the live inference itself is
 * browser-only). Returns the absent frame when no face was detected.
 */
export function blendshapesToFaceFrame(result: FaceLandmarkerResultLike): FaceFrame {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!categories || categories.length === 0) return ABSENT_FRAME;
  const blendshapes: Record<string, number> = {};
  for (const c of categories) blendshapes[c.categoryName] = c.score;
  return { present: true, blendshapes };
}

/** The minimal runtime surface of MediaPipe used here (browser-only, lazy). */
interface FaceLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResultLike;
  close(): void;
}
interface TasksVisionModule {
  FilesetResolver: { forVisionTasks(wasmBase: string): Promise<unknown> };
  FaceLandmarker: {
    createFromOptions(
      fileset: unknown,
      opts: {
        baseOptions: { modelAssetPath: string; delegate?: 'GPU' | 'CPU' };
        outputFaceBlendshapes?: boolean;
        numFaces?: number;
        runningMode?: 'IMAGE' | 'VIDEO';
      },
    ): Promise<FaceLandmarkerLike>;
  };
}

/** Reads just the enable flag off the live controls snapshot. */
type FaceControlsGetter = () => { faceEnabled?: boolean };

export const webcamFaceNode = defineNode<Params>({
  type: 'webcam-face',
  title: 'Webcam Face',
  description:
    'MediaPipe FaceLandmarker blendshapes from the shared webcam (lazy-loaded, off by default).',
  inputs: [],
  outputs: [{ name: 'face', kind: 'face-frame' }],
  params: Params,
  make(p) {
    let landmarker: FaceLandmarkerLike | null = null;
    let loading = false;
    // Bumped on every offload/dispose; an in-flight load whose generation no
    // longer matches closes itself instead of resurrecting a released model.
    let loadGen = 0;
    // The generation whose load attempt hard-failed (after the CPU fallback).
    // While `failedGen === loadGen` we don't re-attempt — so a permanent failure
    // (no GPU + no CPU, offline, blocked CDN) can't spin a per-tick reload storm.
    // offload() bumps loadGen, so toggling face control off→on retries exactly once.
    let failedGen = -1;
    let latest: FaceFrame = ABSENT_FRAME;
    let raf: number | null = null;
    let disposed = false;
    let video: HTMLVideoElement | undefined;
    let lastVideoTime = -1;

    const stopLoop = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };

    /** Release the model + loop and reset to the absent frame. */
    const offload = () => {
      loadGen++; // invalidate any in-flight load; also clears the failure latch
      failedGen = -1;
      stopLoop();
      landmarker?.close();
      landmarker = null;
      latest = ABSENT_FRAME;
      lastVideoTime = -1;
    };

    const loop = () => {
      if (disposed) return;
      // Only run inference on a fresh, ready video frame; performance.now() is
      // monotonic, satisfying FaceLandmarker's strictly-increasing-timestamp rule.
      if (
        landmarker &&
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        try {
          latest = blendshapesToFaceFrame(landmarker.detectForVideo(video, performance.now()));
        } catch {
          /* transient inference error; keep the last frame */
        }
      }
      raf = requestAnimationFrame(loop);
    };

    const optionsFor = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      outputFaceBlendshapes: true,
      numFaces: 1,
      runningMode: 'VIDEO' as const,
    });

    /** Lazily load the model on first enable; fire-and-forget (never awaited). */
    const ensureLoaded = () => {
      if (landmarker || loading || disposed || failedGen === loadGen) return;
      loading = true;
      const gen = loadGen;
      void (async () => {
        try {
          const vision = (await import('@mediapipe/tasks-vision')) as unknown as TasksVisionModule;
          const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
          let lm: FaceLandmarkerLike;
          try {
            lm = await vision.FaceLandmarker.createFromOptions(fileset, optionsFor(p.delegate));
          } catch (gpuErr) {
            // GPU/WebGL unavailable on this client → fall back to the CPU delegate
            // (the float16 model runs on CPU). If CPU was already chosen, give up.
            if (p.delegate !== 'GPU') throw gpuErr;
            lm = await vision.FaceLandmarker.createFromOptions(fileset, optionsFor('CPU'));
          }
          if (disposed || gen !== loadGen) {
            // Toggled off / unmounted while loading — don't resurrect.
            lm.close();
            return;
          }
          landmarker = lm;
          failedGen = -1;
          if (raf === null) raf = requestAnimationFrame(loop);
        } catch {
          // Load failed (offline / unsupported / blocked). Latch this generation
          // so we don't re-attempt the heavy create every tick; toggling face
          // control off→on bumps loadGen via offload() and retries once.
          failedGen = gen;
        } finally {
          loading = false;
        }
      })();
    };

    return {
      init(ctx: NodeContext) {
        // Cheap: only capture the shared <video>. No model download here, so
        // engine.init() is never blocked and a disabled face source costs nothing.
        video = ctx.resources.video as HTMLVideoElement | undefined;
      },
      process(_inputs, ctx: NodeContext) {
        video = (ctx.resources.video as HTMLVideoElement | undefined) ?? video;
        const getControls = ctx.resources.controls as FaceControlsGetter | undefined;
        const enabled = getControls?.().faceEnabled === true;
        if (!enabled) {
          // Release the model if one is loaded/loading; also clear a prior
          // failure latch so a deliberate re-enable retries the load.
          if (landmarker || loading || failedGen === loadGen) offload();
          return { face: ABSENT_FRAME };
        }
        // Only spin up the model once we actually have a camera feed (so we
        // never download a face model with no <video> — e.g. headless).
        if (video) ensureLoaded();
        return { face: latest };
      },
      dispose() {
        disposed = true;
        offload();
      },
    };
  },
});
