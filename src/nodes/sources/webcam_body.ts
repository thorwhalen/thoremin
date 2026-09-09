/**
 * `webcam-body` source node (browser-only, #186) — runs MediaPipe
 * **PoseLandmarker** on the shared host `<video>` and outputs the latest
 * {@link BodyFrame} (33 BlazePose landmarks in pixels + metric world landmarks +
 * per-point visibility). The live counterpart of `scripts/video_to_pose.py`,
 * emitting the same frame shape so a recorded stream replays through the same
 * downstream nodes.
 *
 * It follows `webcam-face`, not `webcam-hands`, on every design point, because
 * the body is the most expensive model the graph can host and must cost nothing
 * until wanted:
 *
 * 1. **Off by default, lazy.** Nothing is downloaded at `init()`; the runtime and
 *    the model load on first *enable* — the `body.enabled` dial, the Feature Lab
 *    measuring a body group, or a trainer cue claiming one ({@link bodyActive}).
 * 2. **Lazy offload.** Disabling releases the landmarker so the hands model never
 *    competes with an idle body model for the tick budget.
 * 3. **Detached inference.** Its own `requestAnimationFrame` loop caches the
 *    latest frame; `process()` returns the cache, so the engine tick never waits
 *    on inference and the frame-drop guard sees a constant-cost node.
 *
 * The runtime is the tasks-vision fileset the hands/face sources already load
 * (one Emscripten module, three tasks — see `tasks_vision.ts`); the only new
 * download is the pose model itself: `lite` 5.8 MB (default) or `full` 9.4 MB.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { DemandedGroups } from '@/features/demand';
import { demandWantsBody, labWantsBody, type FeatureLabConfig } from '@/features/labConfig';
import { ABSENT_BODY_STATUS, EMPTY_BODY_FRAME, type BodyFrame, type BodyStatus, type Keypoint } from '../domain';
import { BODY_SLOT_OUTPUT } from './body_contract';
import { MEDIAPIPE_MODELS_BASE, TASKS_VISION_WASM_BASE } from './tasks_vision';

/** The two live-capable PoseLandmarker variants (heavy is ~30 MB and ~5 fps in a browser). */
export const BODY_MODELS = ['lite', 'full'] as const;
export type BodyModel = (typeof BODY_MODELS)[number];

export function bodyModelUrl(model: BodyModel): string {
  return `${MEDIAPIPE_MODELS_BASE}/pose_landmarker/pose_landmarker_${model}/float16/latest/pose_landmarker_${model}.task`;
}

const Params = z.object({
  /** Which pose model to download: `lite` (fast, default) or `full` (steadier on fast motion). */
  model: z.enum(BODY_MODELS).default('lite'),
  /** Run inference on the GPU (WebGL) when available, else CPU. */
  delegate: z.enum(['GPU', 'CPU']).default('GPU'),
  /** Below this tracking confidence the detector re-runs person detection (costlier, steadier). */
  minTrackingConfidence: z.number().min(0).max(1).default(0.5),
});
type Params = z.infer<typeof Params>;

interface LandmarkLike {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}
/** The minimal slice of a `PoseLandmarkerResult` this node reads. */
export interface PoseLandmarkerResultLike {
  landmarks: LandmarkLike[][];
  worldLandmarks?: LandmarkLike[][];
}

/**
 * Pure converter: a PoseLandmarker result → a {@link BodyFrame} in pixel
 * coordinates of a `w`×`h` frame. Exported for headless tests; returns the empty
 * frame (sized) when no pose was detected. Only the first pose is read.
 */
export function resultToBodyFrame(res: PoseLandmarkerResultLike, w: number, h: number): BodyFrame {
  const pts = res.landmarks?.[0];
  if (!pts || pts.length === 0) return { ...EMPTY_BODY_FRAME, width: w, height: h };
  const landmarks: Keypoint[] = pts.map((p) => ({ x: p.x * w, y: p.y * h, z: p.z }));
  const visibility = pts.map((p) => p.visibility ?? 1);
  const wl = res.worldLandmarks?.[0];
  const frame: BodyFrame = { width: w, height: h, present: true, landmarks, visibility };
  if (wl && wl.length) frame.world = wl.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  return frame;
}

/** The minimal runtime surface of MediaPipe used here (browser-only, lazy). */
interface PoseLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResultLike;
  close(): void;
}
interface TasksVisionModule {
  FilesetResolver: { forVisionTasks(wasmBase: string): Promise<unknown> };
  PoseLandmarker: {
    createFromOptions(
      fileset: unknown,
      opts: {
        baseOptions: { modelAssetPath: string; delegate?: 'GPU' | 'CPU' };
        numPoses?: number;
        minTrackingConfidence?: number;
        outputSegmentationMasks?: boolean;
        runningMode?: 'IMAGE' | 'VIDEO';
      },
    ): Promise<PoseLandmarkerLike>;
  };
}

type BodyControlsGetter = () => {
  body?: { enabled?: boolean; model?: BodyModel };
  featureLab?: FeatureLabConfig;
};

/**
 * Should the body model be loaded and run? Any one of three consumers suffices —
 * the `body.enabled` dial, the Lab measuring a body group, a trainer cue claiming
 * one — exactly the rule `faceActive` states for the face, for the same reason:
 * a measuring instrument must be able to observe without turning the sound on.
 */
export function bodyActive(
  controls: ReturnType<BodyControlsGetter> | undefined,
  demanded: DemandedGroups = null,
): boolean {
  if (demandWantsBody(demanded)) return true;
  if (!controls) return false;
  if (labWantsBody(controls.featureLab)) return true;
  return controls.body?.enabled === true;
}

export const webcamBodyNode = defineNode<Params>({
  type: 'webcam-body',
  roles: ['source'],
  title: 'Webcam Body',
  description:
    'MediaPipe PoseLandmarker full-body pose (33 landmarks) from the shared webcam. Lazy-loaded, off by default.',
  inputs: [],
  outputs: [
    BODY_SLOT_OUTPUT,
    // Lifecycle + detection status, drawn by the overlay's body skeleton element
    // so a player sees "loading" before the first skeleton appears.
    { name: 'status', kind: 'body-status' },
  ],
  params: Params,
  make(p) {
    let landmarker: PoseLandmarkerLike | null = null;
    /** The model the loaded (or loading) landmarker was created with. */
    let loadedModel: BodyModel = p.model;
    let loading = false;
    let loadGen = 0;
    let failedGen = -1;
    let latest: BodyFrame = EMPTY_BODY_FRAME;
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

    const offload = () => {
      loadGen++;
      failedGen = -1;
      stopLoop();
      landmarker?.close();
      landmarker = null;
      latest = EMPTY_BODY_FRAME;
      lastVideoTime = -1;
    };

    const loop = () => {
      if (disposed) return;
      if (
        landmarker &&
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        try {
          latest = resultToBodyFrame(
            landmarker.detectForVideo(video, performance.now()),
            video.videoWidth,
            video.videoHeight,
          );
        } catch {
          /* transient inference error; keep the last frame */
        }
      }
      raf = requestAnimationFrame(loop);
    };

    const optionsFor = (model: BodyModel, delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: bodyModelUrl(model), delegate },
      numPoses: 1,
      minTrackingConfidence: p.minTrackingConfidence,
      outputSegmentationMasks: false,
      runningMode: 'VIDEO' as const,
    });

    const ensureLoaded = (model: BodyModel) => {
      if (landmarker || loading || disposed || failedGen === loadGen) return;
      loading = true;
      loadedModel = model;
      const gen = loadGen;
      void (async () => {
        try {
          const vision = (await import('@mediapipe/tasks-vision')) as unknown as TasksVisionModule;
          const fileset = await vision.FilesetResolver.forVisionTasks(TASKS_VISION_WASM_BASE);
          let lm: PoseLandmarkerLike;
          try {
            lm = await vision.PoseLandmarker.createFromOptions(fileset, optionsFor(model, p.delegate));
          } catch (gpuErr) {
            if (p.delegate !== 'GPU') throw gpuErr;
            console.warn('[thoremin] body model GPU delegate failed; falling back to CPU', gpuErr);
            lm = await vision.PoseLandmarker.createFromOptions(fileset, optionsFor(model, 'CPU'));
          }
          if (disposed || gen !== loadGen) {
            lm.close();
            return;
          }
          landmarker = lm;
          failedGen = -1;
          if (raf === null) raf = requestAnimationFrame(loop);
        } catch (err) {
          console.warn('[thoremin] body model failed to load', err);
          failedGen = gen;
        } finally {
          loading = false;
        }
      })();
    };

    const statusOf = (enabled: boolean): BodyStatus => {
      if (!enabled) return ABSENT_BODY_STATUS;
      if (failedGen === loadGen) return { phase: 'error', bodyDetected: false };
      if (landmarker) return { phase: 'ready', bodyDetected: latest.present };
      return { phase: 'loading', bodyDetected: false };
    };

    return {
      init(ctx: NodeContext) {
        video = ctx.resources.video as HTMLVideoElement | undefined;
      },
      process(_inputs, ctx: NodeContext) {
        video = (ctx.resources.video as HTMLVideoElement | undefined) ?? video;
        const getControls = ctx.resources.controls as BodyControlsGetter | undefined;
        const getDemand = ctx.resources.featureDemand as (() => DemandedGroups) | undefined;
        const controls = getControls?.();
        const enabled = bodyActive(controls, getDemand?.() ?? null);
        if (!enabled) {
          if (landmarker || loading || failedGen === loadGen) offload();
          return { body: EMPTY_BODY_FRAME, status: statusOf(false) };
        }
        // The dial picks the model live; a change while loaded releases the old model
        // and the next tick loads the new one (no graph rebuild).
        const model: BodyModel = controls?.body?.model ?? p.model;
        if ((landmarker || loading) && model !== loadedModel) offload();
        if (video) ensureLoaded(model);
        return { body: latest, status: statusOf(true) };
      },
      dispose() {
        disposed = true;
        offload();
      },
    };
  },
});
