/**
 * The synth merge's CONTRACT (#600 S4; the `<node>.schema.ts` pattern of S6): its input pools,
 * importable without the node. The composer allocates declared voices into these pools, and the
 * contribution registry sizes them, so neither has to import the merge's implementation.
 */

/** How many inputs each voice role's pool has. */
export type PoolSizes = Readonly<Record<'instrument' | 'score', number>>;

/** The pool sizes every build has at least: eight instrument voices and two score voices. */
export const DEFAULT_MERGE_POOL_SIZES: PoolSizes = { instrument: 8, score: 2 };

/** The merge's input pools by voice role, in allocation order (`voice1..N`, `score1..M`). The
 *  composer allocates into these; the registry sizes them from the contributions. */
export function synthMergePools(sizes: PoolSizes = DEFAULT_MERGE_POOL_SIZES): { instrument: readonly string[]; score: readonly string[] } {
  return {
    instrument: Array.from({ length: sizes.instrument }, (_, i) => `voice${i + 1}`),
    score: Array.from({ length: sizes.score }, (_, i) => `score${i + 1}`),
  };
}

/** The default pools (eight instrument, two score). */
export const SYNTH_MERGE_POOLS = synthMergePools();
