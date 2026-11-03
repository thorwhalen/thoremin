/**
 * The camera's video as a host resource: the one key under which the host puts the shared
 * `<video>` element into `ctx.resources`, and which a node that runs a model on the camera's
 * frames declares in its `reads` (`NodeDef.reads`, `@thoremin/dag`).
 *
 * Why a declaration on the node. Whether the host opens the camera is derived from what the
 * composed graph holds (#869, #960): a node that reads the video is a camera model, whichever
 * branch or slot placed it. Declared once, where the node reads it, a new camera source cannot
 * forget to say so, and a slot candidate that reads no video (a synthetic or replayed body)
 * opens no camera.
 */

/** The `ctx.resources` key of the camera's `<video>` element. */
export const VIDEO_RESOURCE_KEY = 'video';

/** What a camera model declares: `defineNode({ ..., reads: READS_VIDEO })`. */
export const READS_VIDEO: readonly string[] = Object.freeze([VIDEO_RESOURCE_KEY]);
