/**
 * What a headless run of the production graph (`defaultGraph`) leaves out of `resources` on
 * purpose (#974): the camera's video. `defaultGraph` composes every branch, the face and body
 * camera models among them, and a test or script feeds the hands through a replay in the source
 * slot, so those models idle on a host with no camera. `runHeadless` checks every node's declared
 * reads at init; this exempts the video alone, so every other declared resource is still checked.
 */
import { READS_VIDEO } from '@thoremin/sdk/sources/video';

/** `runHeadless(defaultGraph(...), registry, { ..., checkReads: DEFAULT_GRAPH_READS })`. */
export const DEFAULT_GRAPH_READS = Object.freeze({ omit: READS_VIDEO });
