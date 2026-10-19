/**
 * The `lyria` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


/** The provider whose key Lyria uses — the same store the assistant's Google
 *  provider reads, so one pasted key serves both. */
export const LYRIA_KEY_PROVIDER = 'google' as const;
