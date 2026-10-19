/**
 * The browser's body model loader (#186; out of the node since #600 S17b): a dynamic import of
 * tasks-vision, the PoseLandmarker on the GPU delegate with the CPU as its fallback, the CPU delegate
 * handed a copy of each frame (#324). The slice's React half installs it as the `webcam-body` node's
 * default (`provideBodyLandmarkerFactory`), so the node's pure side never names MediaPipe.
 */
import { TASKS_VISION_WASM_BASE } from '@thoremin/sdk/sources/tasks_vision';
import { copyFramesOnCpu } from '@thoremin/sdk/sources/model_input';
import { bodyModelUrl, type BodyLandmarkerFactory, type PoseLandmarkerLike } from '../nodes/webcam_body';

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

export const loadBodyLandmarker: BodyLandmarkerFactory = async (opts, lctx) => {
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
  // The CPU delegate is handed a copy of each frame, never the element (#324, `model_input.ts`).
  try {
    landmarker = copyFramesOnCpu(await vision.PoseLandmarker.createFromOptions(fileset, options(opts.delegate)), opts.delegate);
  } catch (gpuErr) {
    // GPU/WebGL unavailable on this client → the CPU delegate (the float16 model runs
    // on CPU). If CPU was already chosen, the failure stands.
    if (opts.delegate !== 'GPU') throw gpuErr;
    if (lctx.signal.aborted) return { resource: null, reason: 'aborted' };
    console.warn('[thoremin] body model GPU delegate failed; falling back to CPU', gpuErr);
    landmarker = copyFramesOnCpu(await vision.PoseLandmarker.createFromOptions(fileset, options('CPU')), 'CPU');
  }
  return { resource: { landmarker, model: opts.model }, message: `Body model (${opts.model}) ready` };
};
