/**
 * Where the face session's input comes from, as one seam (#330 P2): the feature vectors to carve
 * and the video to take exemplar frames from.
 *
 * - **live** (the default): the trainer's own live-vector tap (`@thoremin/sdk-ui/enroll/liveVector`,
 *   the vectors the instrument computes each tick) and the RAW camera stream (the host's camera
 *   seam: no overlay, no text, the stream the Record sheet's "pure video" takes).
 * - **synthetic** (`?faces.source=synthetic`): a scripted face (`../lib/synthetic.ts`) and a
 *   canvas video painting its expression, so the session runs with no camera and no face model.
 *   A verification affordance, like `?slot.source=synthetic-hands`, never an instrument.
 *
 * Times are engine-clock milliseconds (`performance.now()` at speed 1, the clock the live tap
 * converts to), the clock the video's start is stamped on.
 */
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { readLiveVector } from '@thoremin/sdk-ui/enroll/liveVector';
import { camera } from '@thoremin/sdk-ui/host';
import { syntheticExpressionAt, syntheticFaceVector } from '../lib/synthetic';

export interface FaceSource {
  readonly kind: 'live' | 'synthetic';
  /** The latest vector and its engine time (ms), or null when there is none. */
  read(): { vector: FeatureVector; t: number } | null;
  /** A stream to record the take's video from, or null (then the grid has no pictures). */
  video(): MediaStream | null;
  /** Release what the source opened (the synthetic canvas); never the camera. */
  dispose(): void;
}

/** The URL parameter that selects the synthetic source. */
export const SOURCE_PARAM = 'faces.source';

export function liveSource(): FaceSource {
  return { kind: 'live', read: readLiveVector, video: () => camera().stream(), dispose: () => {} };
}

/** The scripted face, timed from when it is created; its video is a 160x120 canvas at 15 fps. */
export function syntheticSource(now: () => number = () => performance.now()): FaceSource {
  const start = now();
  let frame = 0;
  let canvas: HTMLCanvasElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stream: MediaStream | null = null;
  const paint = () => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const e = syntheticExpressionAt(now() - start);
    ctx.fillStyle = e.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(e.name, canvas.width / 2, canvas.height / 2 + 8);
  };
  return {
    kind: 'synthetic',
    read: () => {
      const t = now();
      return { vector: syntheticFaceVector(t - start, frame++), t };
    },
    video() {
      if (stream) return stream;
      if (typeof document === 'undefined') return null;
      canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      if (typeof canvas.captureStream !== 'function') return null;
      paint();
      timer = setInterval(paint, 1000 / 15);
      stream = canvas.captureStream(15);
      return stream;
    },
    dispose() {
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      timer = null;
      stream = null;
      canvas = null;
    },
  };
}

/** The source the page asked for: synthetic when `?faces.source=synthetic`, else live. */
export function sourceFromUrl(search: string = typeof location === 'undefined' ? '' : location.search): FaceSource {
  return new URLSearchParams(search).get(SOURCE_PARAM) === 'synthetic' ? syntheticSource() : liveSource();
}
