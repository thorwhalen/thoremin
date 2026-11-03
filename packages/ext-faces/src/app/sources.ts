/**
 * Where the face session's input comes from, as one seam (#330 P2): the feature vectors to carve
 * and the video a hold's still is taken from (#385 E3: at capture, never recorded).
 *
 * - **live** (the default): the trainer's own live-vector tap (`@thoremin/sdk-ui/enroll/liveVector`,
 *   the vectors the instrument computes each tick) and the RAW camera stream (the host's camera
 *   seam: no overlay, no text, the stream the Record sheet's "pure video" takes).
 * - **synthetic** (`?carve.source=synthetic`): a scripted face (`../lib/synthetic.ts`) and a
 *   canvas video painting its expression, so the session runs with no camera and no face model.
 *   A verification affordance, like `?slot.source=synthetic-hands`, never an instrument.
 *
 * Times are engine-clock milliseconds (`performance.now()` at speed 1, the clock the live tap
 * converts to).
 */
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { createFreshReader } from '@thoremin/sdk-ui/enroll/liveVector';
import { camera } from '@thoremin/sdk-ui/host';
import { syntheticExpressionAt, syntheticFaceVector } from '../lib/synthetic';
import { syntheticHandShapeAt, syntheticHandVector } from '../lib/synthetic_hand';
import { syntheticBodyAt, syntheticBodyVector } from '../lib/synthetic_body';
import { GESTURE_PATHS, syntheticGesturePhase, syntheticGestureVector } from '../lib/synthetic_gesture';

export interface FaceSource {
  readonly kind: 'live' | 'synthetic';
  /** The latest vector and its engine time (ms), or null when there is none. `fresh`, when the
   *  source can tell, holds only the features of the parts that moved since the last read (#916:
   *  the live tap's parts update on different ticks); absent = every feature is new. */
  read(): { vector: FeatureVector; t: number; fresh?: FeatureVector } | null;
  /** A stream the holds' stills are taken from, or null (then the grid has no pictures). */
  video(): MediaStream | null;
  /** Release what the source opened (the synthetic canvas); never the camera. */
  dispose(): void;
}

/** The URL parameter that selects the synthetic source, for every carve tool (#385 E8). */
export const SOURCE_PARAM = 'carve.source';

/** A scripted part: its vector at `ms` after the start (`frame` seeds the jitter), and the name
 *  and colour its video frame shows. */
export interface SyntheticScript {
  vectorAt(ms: number, frame: number): FeatureVector;
  labelAt(ms: number): { name: string; color: string };
}

/** The scripted face (`../lib/synthetic.ts`). */
export const FACE_SCRIPT: SyntheticScript = { vectorAt: syntheticFaceVector, labelAt: syntheticExpressionAt };
/** The scripted hand (`../lib/synthetic_hand.ts`). */
export const HAND_SCRIPT: SyntheticScript = { vectorAt: syntheticHandVector, labelAt: syntheticHandShapeAt };
/** The scripted hand waving (#754, `../lib/synthetic_gesture.ts`): what a gesture take reads. */
export const HAND_GESTURE_SCRIPT: SyntheticScript = {
  vectorAt: (ms, frame) => syntheticGestureVector(GESTURE_PATHS.wave, ms, frame),
  labelAt: (ms) => (syntheticGesturePhase(ms) === null ? { name: 'rest', color: '#334155' } : { name: 'wave', color: '#0f766e' }),
};
/** The scripted body (`../lib/synthetic_body.ts`): the rest, the three nuisances, four poses. */
export const BODY_SCRIPT: SyntheticScript = { vectorAt: syntheticBodyVector, labelAt: syntheticBodyAt };

export function liveSource(): FaceSource {
  // A reader of its own: the take and the test each create a source, and each sees every part once.
  return { kind: 'live', read: createFreshReader(), video: () => camera().stream(), dispose: () => {} };
}

/** A scripted part (the face by default), timed from when it is created; its video is a 160x120
 *  canvas at 15 fps naming what it shows. */
export function syntheticSource(now: () => number = () => performance.now(), script: SyntheticScript = FACE_SCRIPT): FaceSource {
  const start = now();
  let frame = 0;
  let canvas: HTMLCanvasElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stream: MediaStream | null = null;
  const paint = () => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const e = script.labelAt(now() - start);
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
      return { vector: script.vectorAt(t - start, frame++), t };
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

/** The source the page asked for: synthetic (`script`, the face by default) when
 *  `?carve.source=synthetic`, else live. */
export function sourceFromUrl(search: string = typeof location === 'undefined' ? '' : location.search, script: SyntheticScript = FACE_SCRIPT): FaceSource {
  const q = new URLSearchParams(search);
  const synthetic = q.get(SOURCE_PARAM) === 'synthetic';
  return synthetic ? syntheticSource(undefined, script) : liveSource();
}
