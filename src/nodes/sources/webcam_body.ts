/**
 * `webcam-body` source node (browser-only, #186) — runs MediaPipe
 * **PoseLandmarker** on the shared host `<video>` and outputs the latest
 * {@link BodyFrame} (33 BlazePose landmarks in pixels + metric world landmarks +
 * per-point visibility). Its offline counterpart, a `scripts/video_to_pose.py`
 * in the `video_to_landmarks.py` family, is planned with the body fixtures and
 * will emit the same frame shape.
 *
 * The body is the most expensive model the graph can host, so it must cost
 * nothing until wanted. Rather than hand-roll a fourth copy of the load / release
 * / late-arrival / failure-latch machine (`webcam-face` and `midi-out` each have
 * one), this node is the first adopter of the catalogued pattern in `src/lazy`
 * (#188, `docs/design/lazy-loading.md`):
 *
 * 1. **Off by default, lazy.** Nothing loads at `init()`. `process()` calls
 *    `want(enabled)` each tick; the loader (a dynamic `import()` of tasks-vision +
 *    `PoseLandmarker.createFromOptions`, GPU then CPU) runs at most once per
 *    request and never blocks the engine.
 * 2. **Gated.** `enabled` is {@link bodyActive}: the `body.enabled` dial, the Lab
 *    measuring a body group, or a trainer cue claiming one — the face rule. With
 *    no camera frames the gate reports `unavailable` / `no-camera` instead of
 *    downloading a model that could never detect anything, and retries by itself
 *    the moment frames arrive.
 * 3. **Keyed by model.** The dial picks `lite` / `full` live; a change releases the
 *    current load (a superseded load is a late arrival, discarded on settle) and
 *    the next tick starts the new one — including after a failed load, since a
 *    release clears the failure latch.
 * 4. **Detached inference.** Its own `requestAnimationFrame` loop caches the latest
 *    frame while a landmarker is held; `process()` returns the cache.
 *
 * The `status` port speaks the shared `LoadStatus` vocabulary, so the overlay's
 * skeleton element (and any panel readout) can say "loading" / "needs the camera"
 * / "failed" without knowing this node.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { DemandedGroups } from '@/features/demand';
import { demandWantsBody, labWantsBody, type FeatureLabConfig } from '@/features/labConfig';
import { lazyResource, withActive, type LoadContext, type LoadResult, type LoadStatus } from '@/lazy';
import {
  BODY_MODELS,
  EMPTY_BODY_FRAME,
  type BodyFrame,
  type BodyModel,
  type Keypoint,
} from '../domain';
import { BODY_SLOT_OUTPUT } from './body_contract';
import { MEDIAPIPE_MODELS_BASE, TASKS_VISION_WASM_BASE } from './tasks_vision';

export function bodyModelUrl(model: BodyModel): string {
  return `${MEDIAPIPE_MODELS_BASE}/pose_landmarker/pose_landmarker_${model}/float16/latest/pose_landmarker_${model}.task`;
}

const Params = z.object({
  /** Which pose model to download when the dial does not say: `lite` (fast, 5.8 MB)
   *  or `full` (steadier on fast motion, 9.4 MB). The `body.model` dial overrides live. */
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
export interface PoseLandmarkerLike {
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

/** What the loader hands back: the landmarker and the model it was built for. */
export interface BodyLandmarkerHandle {
  landmarker: PoseLandmarkerLike;
  model: BodyModel;
}

/** The loader seam: a host may inject one via `ctx.resources.createBodyLandmarker`
 *  (tests, headless hosts); the default dynamically imports tasks-vision. */
export type BodyLandmarkerFactory = (
  opts: { model: BodyModel; delegate: 'GPU' | 'CPU'; minTrackingConfidence: number },
  ctx: LoadContext,
) => Promise<LoadResult<BodyLandmarkerHandle>>;

const defaultFactory: BodyLandmarkerFactory = async (opts, lctx) => {
  const vision = (await import('@mediapipe/tasks-vision')) as unknown as TasksVisionModule;
  const fileset = await vision.FilesetResolver.forVisionTasks(TASKS_VISION_WASM_BASE);
  if (lctx.signal.aborted) return { resource: null, reason: 'aborted' };
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: bodyModelUrl(opts.model), delegate },
    numPoses: 1,
    minTrackingConfidence: opts.minTrackingConfidence,
    outputSegmentationMasks: false,
    runningMode: 'VIDEO' as const,
  });
  let landmarker: PoseLandmarkerLike;
  try {
    landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options(opts.delegate));
  } catch (gpuErr) {
    // GPU/WebGL unavailable on this client → the CPU delegate (the float16 model runs
    // on CPU). If CPU was already chosen, the failure stands.
    if (opts.delegate !== 'GPU') throw gpuErr;
    if (lctx.signal.aborted) return { resource: null, reason: 'aborted' };
    console.warn('[thoremin] body model GPU delegate failed; falling back to CPU', gpuErr);
    landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
  return { resource: { landmarker, model: opts.model }, message: `Body model (${opts.model}) ready` };
};

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

/** The status reason when the node is wanted but the host has no camera frames. */
export const NO_CAMERA_REASON = 'no-camera';

const hasFrames = (video: HTMLVideoElement | undefined): boolean =>
  !!video && video.readyState >= 2 && video.videoWidth > 0;

export const webcamBodyNode = defineNode<Params>({
  type: 'webcam-body',
  roles: ['source'],
  title: 'Webcam Body',
  description:
    'MediaPipe PoseLandmarker full-body pose (33 landmarks) from the shared webcam. Lazy-loaded, off by default.',
  inputs: [],
  outputs: [
    BODY_SLOT_OUTPUT,
    // Lifecycle + detection status in the shared LoadStatus vocabulary (#188), drawn
    // by the overlay's body skeleton element so a player sees "loading" / "needs the
    // camera" / "failed" before the first skeleton appears.
    { name: 'status', kind: 'body-status' },
  ],
  params: Params,
  make(p) {
    let latest: BodyFrame = EMPTY_BODY_FRAME;
    let raf: number | null = null;
    let disposed = false;
    let video: HTMLVideoElement | undefined;
    let lastVideoTime = -1;
    let factory: BodyLandmarkerFactory | undefined;
    /** The model the current (or in-flight) load targets — the keyed-request idiom. */
    let requestedModel: BodyModel = p.model;

    const resource = lazyResource<BodyLandmarkerHandle>({
      load: (lctx) =>
        (factory ?? defaultFactory)(
          { model: requestedModel, delegate: p.delegate, minTrackingConfidence: p.minTrackingConfidence },
          lctx,
        ),
      unload: (h) => h.landmarker.close(),
      gate: () =>
        hasFrames(video)
          ? null
          : { reason: NO_CAMERA_REASON, message: 'Body tracking needs the camera' },
      label: 'body model',
      log: (m) => console.warn(`[thoremin] ${m}`),
    });

    const stopLoop = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };

    const loop = () => {
      if (disposed) return;
      const held = resource.current();
      if (!held) {
        raf = null;
        return; // released: the loop ends itself; a re-request restarts it
      }
      if (video && hasFrames(video) && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        try {
          latest = resultToBodyFrame(
            held.landmarker.detectForVideo(video, performance.now()),
            video.videoWidth,
            video.videoHeight,
          );
        } catch {
          /* transient inference error; keep the last frame */
        }
      }
      raf = requestAnimationFrame(loop);
    };

    return {
      init(ctx: NodeContext) {
        // Cheap: capture the shared <video> and any injected loader. No download.
        video = ctx.resources.video as HTMLVideoElement | undefined;
        factory = ctx.resources.createBodyLandmarker as BodyLandmarkerFactory | undefined;
      },
      process(_inputs, ctx: NodeContext) {
        video = (ctx.resources.video as HTMLVideoElement | undefined) ?? video;
        const getControls = ctx.resources.controls as BodyControlsGetter | undefined;
        const getDemand = ctx.resources.featureDemand as (() => DemandedGroups) | undefined;
        const controls = getControls?.();
        const enabled = bodyActive(controls, getDemand?.() ?? null);

        if (enabled) {
          const model: BodyModel = controls?.body?.model ?? p.model;
          const st = resource.status();
          // Keyed request: a model change supersedes whatever is held or loading
          // (a late arrival is discarded on settle) and clears a failure latch.
          if (model !== requestedModel) {
            requestedModel = model;
            resource.release();
          } else if (st.phase === 'unavailable' && st.reason === NO_CAMERA_REASON && hasFrames(video)) {
            // The camera arrived after the gate said no: retry now, not on toggle.
            resource.release();
          }
        }
        resource.want(enabled);

        const held = resource.current();
        if (held) {
          if (raf === null) raf = requestAnimationFrame(loop);
        } else {
          stopLoop();
          latest = EMPTY_BODY_FRAME;
          lastVideoTime = -1;
        }
        const status: LoadStatus = withActive(resource.status(), latest.present, 'Body detected');
        return { body: held ? latest : EMPTY_BODY_FRAME, status };
      },
      dispose() {
        disposed = true;
        stopLoop();
        resource.dispose();
      },
    };
  },
});
