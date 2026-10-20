/**
 * The ids of shared categorizers (#330 P5), import-free so the extension's eager manifest can name
 * a shipped categorizer (its seeds) without pulling the shared files' reader into the initial
 * bundle. `./shared.ts` re-exports these.
 */

/** The id prefix of a shared categorizer. */
export const SHARED_PREFIX = 'shared:';

export const isSharedId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith(SHARED_PREFIX) && id.length > SHARED_PREFIX.length;

export const sharedId = (name: string): string => `${SHARED_PREFIX}${name}`;
