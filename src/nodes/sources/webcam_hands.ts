/**
 * `webcam-hands` node (browser-only) — runs MediaPipe Hands (via
 * @tensorflow-models/hand-pose-detection) on a host-provided `<video>` element
 * and outputs the latest {@link HandsFrame}.
 *
 * Key design point: ML inference is async and slower than the render loop, so
 * detection runs in its own loop and caches the latest result. `process` simply
 * returns that cache — decoupling detection rate from the engine tick rate. The
 * `<video>` element is injected via `ctx.resources.video`.
 */
import { z } from 'zod';
// Type-only import is erased at runtime, so this module stays Node-safe; the
// heavy TF.js/MediaPipe runtime is dynamically imported inside init() (browser
// only). This lets the full app registry be built & topology-tested headlessly.
import type * as HPD from '@tensorflow-models/hand-pose-detection';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { Hand, Handedness, HandsFrame, Keypoint } from '../domain';

const Params = z.object({
  modelType: z.enum(['lite', 'full']).default('full'),
  maxHands: z.number().int().min(1).max(4).default(2),
});
type Params = z.infer<typeof Params>;

const EMPTY: HandsFrame = { width: 640, height: 480, hands: [] };

export const webcamHandsNode = defineNode<Params>({
  type: 'webcam-hands',
  title: 'Webcam Hands',
  description: 'MediaPipe hand landmark detection from a webcam video element.',
  inputs: [],
  outputs: [{ name: 'hands', kind: 'hands-frame' }],
  params: Params,
  make(p) {
    let detector: HPD.HandDetector | null = null;
    let latest: HandsFrame = EMPTY;
    let raf: number | null = null;
    let disposed = false;
    let video: HTMLVideoElement | undefined;

    const toFrame = (hands: HPD.Hand[], w: number, h: number): HandsFrame => ({
      width: w,
      height: h,
      hands: hands.map(
        (hand): Hand => ({
          handedness: (hand.handedness as Handedness) ?? 'Right',
          score: hand.score,
          keypoints: hand.keypoints.map((k): Keypoint => ({ x: k.x, y: k.y, name: k.name })),
        }),
      ),
    });

    const loop = async () => {
      if (disposed) return;
      try {
        if (detector && video && video.readyState >= 2 && video.videoWidth > 0) {
          const hands = await detector.estimateHands(video, { flipHorizontal: false });
          latest = toFrame(hands, video.videoWidth, video.videoHeight);
        }
      } catch {
        /* transient inference error; keep last frame */
      }
      raf = requestAnimationFrame(loop);
    };

    return {
      async init(ctx: NodeContext) {
        video = ctx.resources.video as HTMLVideoElement | undefined;
        const handPoseDetection = await import('@tensorflow-models/hand-pose-detection');
        await import('@tensorflow/tfjs-backend-webgl');
        const model = handPoseDetection.SupportedModels.MediaPipeHands;
        detector = await handPoseDetection.createDetector(model, {
          runtime: 'mediapipe',
          solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
          modelType: p.modelType,
          maxHands: p.maxHands,
        } as HPD.MediaPipeHandsMediaPipeModelConfig);
        raf = requestAnimationFrame(loop);
      },
      process() {
        return { hands: latest };
      },
      dispose() {
        disposed = true;
        if (raf !== null) cancelAnimationFrame(raf);
        detector?.dispose();
        detector = null;
      },
    };
  },
});
