/**
 * The `conductor_body` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


/** What the body conductor follows: the multi-joint impact detector (A2), or one point. */
export const CONDUCTOR_BODY_POINTS = ['impact', 'wrist', 'head', 'hips', 'com'] as const;
export type ConductorBodyPoint = (typeof CONDUCTOR_BODY_POINTS)[number];
