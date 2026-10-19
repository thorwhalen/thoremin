/**
 * The body slice's dials (#186; a slice since #600 S17b).
 *
 * `body` is FLAT (`layout: 'flat'`): `body.enabled` and `body.model` are the keys it had in core, so
 * a saved instrument and a bound command keep theirs. Body tracking is the most expensive model the
 * graph can host, so it is a dial the player turns on, never a default; `body.model` swaps the
 * PoseLandmarker variant (the node's own list, `BODY_MODELS` in the SDK's domain).
 *
 * `bodyMap` is a whole-object dial like the hand map: four route slots over the body catalog,
 * reachable leaf by leaf through `dial.setIn` (`bodyMap.routes.a.target`).
 */
import { z } from 'zod';
import { BODY_MODELS } from '@thoremin/sdk/nodes/domain';

export { BODY_MODELS };

export const BodySettingsSchema = z.object({
  enabled: z.boolean().default(false).meta({ facets: ['Body'], title: 'Body tracking', description: 'Track the full body (33 pose landmarks) from the webcam — the source for body features and the dance pulse' }),
  model: z.enum(BODY_MODELS).default('lite').meta({ facets: ['Body', 'advanced'], title: 'Body model', description: 'lite (fast, 6 MB) or full (steadier on fast motion, 9 MB)' }),
});
export type BodySettings = z.infer<typeof BodySettingsSchema>;

/** The shipped body defaults: off (the model is the most expensive in the graph), lite. */
export const DEFAULT_BODY: BodySettings = { enabled: false, model: 'lite' };
