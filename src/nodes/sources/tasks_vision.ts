/**
 * The one place the MediaPipe **tasks-vision** runtime is pinned (#186).
 *
 * `webcam-hands`, `webcam-face` and `webcam-body` share a single Emscripten
 * runtime (two different MediaPipe wasm modules collide on the global `Module`,
 * see `webcam_hands.ts`), so the wasm fileset URL is one constant, pinned to the
 * installed `@mediapipe/tasks-vision` version so the runtime matches the imported
 * JS API. Each source keeps its own model URL: the model is what differs.
 *
 * Nothing here touches the browser — it is data, safe to import from tests.
 */
export const TASKS_VISION_VERSION = '0.10.35';

/** The wasm fileset every tasks-vision landmarker loads through `FilesetResolver`. */
export const TASKS_VISION_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

/** Google's model bucket — every `.task` file below lives under it. */
export const MEDIAPIPE_MODELS_BASE = 'https://storage.googleapis.com/mediapipe-models';
