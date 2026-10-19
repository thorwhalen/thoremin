/**
 * The `score` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


/** The built-in demo piece and its loop (in the SDK since #600 S18b, where the orchestra reaches them). */
export { DEMO_SCALE_NOTES, DEMO_LOOP_BEATS } from '@thoremin/sdk/score/demo';
