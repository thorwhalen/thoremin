/**
 * The `webcam_hands` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


/** The host resource that says how many hands to look for (#325). */
export const HAND_COUNT_RESOURCE_KEY = 'handCount';

/** The host resource that may override where the model runs (`?hands.runner=`, #326). */
export const HAND_RUNNER_RESOURCE_KEY = 'handRunner';
/** `true` when the source video is a MIRROR image (the recorder's overlay video, `?source=video&mirrored=1`):
 *  the hand model then names each hand the opposite side, so the source swaps the labels back (#995).
 *  The live camera's frames are not mirrored (only its view is): absent, false. */
export const MIRRORED_SOURCE_RESOURCE_KEY = 'sourceMirrored';


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
