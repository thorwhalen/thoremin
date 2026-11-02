/**
 * The rights profiles as data, and the checks the core makes with them. One table says which uses
 * each profile allows; every check reads it, so a new profile or use is one row.
 */
import { RIGHTS, SourceError, type MediaItem, type MediaUse, type Rights } from './types';

/** Which uses each profile allows. A score is analysed but has no audio to decode or cache. */
export const RIGHTS_PROFILES: Readonly<Record<Rights, Readonly<Record<MediaUse, boolean>>>> = {
  embed_only: { decode: false, analyse: false, cache: false },
  pcm_local: { decode: true, analyse: true, cache: false },
  pcm_redistributable: { decode: true, analyse: true, cache: true },
  symbolic: { decode: false, analyse: true, cache: true },
};

/** Whether `rights` allows `use`. An unknown profile allows nothing. */
export function allows(rights: Rights | null | undefined, use: MediaUse): boolean {
  if (!rights) return false;
  return RIGHTS_PROFILES[rights]?.[use] === true;
}

/** Throws a `rights` {@link SourceError} unless `item`'s rights allow `use`. */
export function assertAllows(item: Pick<MediaItem, 'rights' | 'source' | 'title'>, use: MediaUse): void {
  if (!allows(item.rights, use)) {
    throw new SourceError('rights', `${item.title} may not be ${USE_WORDS[use]} (its source allows ${item.rights} only)`, item.source);
  }
}

const USE_WORDS: Record<MediaUse, string> = { decode: 'decoded', analyse: 'analysed', cache: 'cached' };

/** Whether `inner` allows nothing `outer` forbids: an item may narrow its adapter's rights,
 *  never widen them. */
export function within(inner: Rights, outer: Rights): boolean {
  if (!RIGHTS.includes(inner) || !RIGHTS.includes(outer)) return false;
  const uses = Object.keys(RIGHTS_PROFILES[inner]) as MediaUse[];
  return uses.every((u) => !RIGHTS_PROFILES[inner][u] || RIGHTS_PROFILES[outer][u]);
}
