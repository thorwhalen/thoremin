/**
 * The chord selector's CONTRACT (#600 S4; the `<node>.schema.ts` pattern of S6): its input pool,
 * importable without the node. The composer allocates declared chord producers into it, and the
 * contribution registry sizes it.
 */

/** The chord pool's input names, in priority order: `a`, `b`, `c` (today's three producers keep
 *  their ports), then `d`.. `z`, then `chord27`... */
export function chordPool(size: number): readonly string[] {
  return Array.from({ length: Math.max(size, DEFAULT_CHORD_POOL_SIZE) }, (_, i) => (i < 26 ? String.fromCharCode(97 + i) : `chord${i + 1}`));
}

/** The pool size every build has at least (the face chord, the pose chord, the sign chord). */
export const DEFAULT_CHORD_POOL_SIZE = 3;
