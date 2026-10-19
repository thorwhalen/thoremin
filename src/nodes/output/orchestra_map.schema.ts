/**
 * The `orchestra_map` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


/** The orchestra's sections, in the order the panel lists them. */
export const SECTIONS = ['strings', 'woodwinds', 'brass', 'percussion', 'other'] as const;
export type Section = (typeof SECTIONS)[number];
