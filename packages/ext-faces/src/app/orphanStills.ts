/**
 * The orphan sweep of the stills store (#569, split from #412).
 *
 * Stills are filed in IndexedDB (`thoremin-faces`, `thumbs`) under HOLD IDS, which are the sample
 * ids of the saved categorizers. E3 dropped `removePrefix`, so the stills a v1 take filed under
 * its old prefix beyond a migrated record's sample count were never removed. This finds every
 * key that no saved categorizer's samples name and, behind a flag, deletes them.
 *
 * - The reference count is over the WHOLE collection (every modality, every record): the stills
 *   store is shared, and two records may name one hold's still.
 * - A record that cannot be read may name a still: then nothing is listed and nothing deleted.
 * - Expand-only: the default is to LIST the orphans (one console line); deleting needs
 *   `localStorage['thoremin.stills.sweep'] = 'delete'` until the contract step makes it routine.
 * - Stills of an unsaved take are in memory, never in the store, so a take in progress is safe.
 *   Another tab files stills a moment before it saves their record, so a still is deleted only
 *   when it was ALSO an orphan in an earlier sweep (the keys are read before the records, and
 *   the previous sweep's orphans are kept in `localStorage['thoremin.stills.orphansSeen']`).
 * - Three vetoes, each leaving everything in place: a record that cannot be read; no readable
 *   record at all while stills exist (the collection may have fallen back to an empty
 *   localStorage copy); a record in the legacy or localStorage collections that is not in the
 *   one collection (an unmigrated or rolled-back save may name stills).
 */
import {
  CATEGORIZERS_STORAGE_KEY,
  LEGACY_FACE_STORAGE_KEY,
  createCategorizerIndex,
  type CategorizerIndex,
} from '@thoremin/sdk-ui/enroll/categorizers';
import { localStorageCollectionProvider } from '@thoremin/sdk-ui/namedCollection';
import type { ThumbStore } from './thumbnails';

/** The localStorage flag whose value `delete` turns the listing into a deletion. */
export const STILL_SWEEP_FLAG_KEY = 'thoremin.stills.sweep';
export const STILL_SWEEP_DELETE = 'delete';

/** The keys no one references, sorted. */
export function orphanStillKeys(keys: readonly string[], referenced: ReadonlySet<string>): string[] {
  return keys.filter((k) => !referenced.has(k)).sort();
}

/** Every sample id of every saved record, or null when any record cannot be read. */
export async function referencedHoldIds(index: Pick<CategorizerIndex, 'list' | 'load'>): Promise<Set<string> | null> {
  const ids = new Set<string>();
  for (const { id } of await index.list()) {
    const record = await index.load(id).catch(() => null);
    if (!record) return null;
    // A trained model keeps no samples, so no stills.
    const samples = (record as { model?: { categorizer?: { samples?: readonly { id: string }[] } } }).model?.categorizer?.samples ?? [];
    for (const s of samples) ids.add(s.id);
  }
  return ids;
}

/** What the index must offer: the ids it lists, and a record by id. */
type Index = Pick<CategorizerIndex, 'list' | 'load'>;

export interface SweepOptions {
  thumbs: ThumbStore;
  index: Index;
  /** Delete the orphans (default false: list them only). */
  remove?: boolean;
  /** The keys the previous sweep found orphaned: only these may be deleted (default: none, so
   *  nothing is). */
  seen?: ReadonlySet<string>;
  /** Ids of records kept outside the collection (the legacy and localStorage copies): one not in
   *  the index vetoes the deletion. */
  outside?: () => Promise<readonly string[]>;
}

export interface SweepResult {
  /** Every still no saved categorizer names. */
  orphans: string[];
  /** The ones deleted. */
  removed: string[];
}

/** List (and with `remove`, delete the ones already orphaned last time) the stills no saved categorizer names. */
export async function sweepOrphanStills({ thumbs, index, remove = false, seen = new Set(), outside }: SweepOptions): Promise<SweepResult> {
  // Keys first, records second: a still filed meanwhile is simply not in `keys`.
  const keys = await thumbs.keys();
  const referenced = await referencedHoldIds(index);
  if (!referenced) return { orphans: [], removed: [] };
  const orphans = orphanStillKeys(keys, referenced);
  if (!remove || orphans.length === 0) return { orphans, removed: [] };
  // No readable record while stills exist: the collection may not be the one the stills belong to.
  if (referenced.size === 0) return { orphans, removed: [] };
  const listed = new Set((await index.list()).map((x) => x.id));
  if ((await outside?.() ?? []).some((id) => !listed.has(id))) return { orphans, removed: [] };
  const doomed = orphans.filter((k) => seen.has(k));
  if (doomed.length > 0) await thumbs.remove(doomed);
  return { orphans, removed: doomed };
}

const ls = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const deleteFlagged = (): boolean => ls()?.getItem(STILL_SWEEP_FLAG_KEY) === STILL_SWEEP_DELETE;

/** The orphans the previous sweep found. */
export const STILL_SWEEP_SEEN_KEY = 'thoremin.stills.orphansSeen';

function readSeen(): Set<string> {
  try {
    const raw = JSON.parse(ls()?.getItem(STILL_SWEEP_SEEN_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSeen(keys: readonly string[]): void {
  try {
    ls()?.setItem(STILL_SWEEP_SEEN_KEY, JSON.stringify(keys));
  } catch {
    // Storage refused: nothing is remembered, so nothing is deleted next time either.
  }
}

/** The ids of the records kept in localStorage outside the one collection's IndexedDB. */
async function outsideIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const key of [LEGACY_FACE_STORAGE_KEY, CATEGORIZERS_STORAGE_KEY]) {
    for (const r of (await localStorageCollectionProvider<{ id: string; name: string; createdAt: number }>(key).getList({})).data) ids.push(r.id);
  }
  return ids;
}

let swept: Promise<SweepResult | null> | null = null;

/** The sweep once per page, in the browser, never throwing: it logs what it found (and removed). */
export function sweepOrphanStillsOnce(thumbs: ThumbStore, options: { index?: Index; remove?: boolean; outside?: () => Promise<readonly string[]> } = {}): Promise<SweepResult | null> {
  return (swept ??= sweepOrphanStills({
    thumbs,
    index: options.index ?? createCategorizerIndex(),
    remove: options.remove ?? deleteFlagged(),
    seen: readSeen(),
    outside: options.outside ?? outsideIds,
  }).then(
    (r) => {
      writeSeen(r.orphans);
      if (r.orphans.length > 0) {
        const left = r.orphans.length - r.removed.length;
        console.info(`stills: ${r.orphans.length} still(s) no saved categorizer names; ${r.removed.length} removed${left > 0 ? `, ${left} kept (removed by the next sweep when localStorage['${STILL_SWEEP_FLAG_KEY}'] = '${STILL_SWEEP_DELETE}')` : ''}`);
      }
      return r;
    },
    (e: unknown) => {
      console.warn('stills: the orphan sweep did not run:', e);
      return null;
    },
  ));
}

/** Forget the once-per-page memo (a test). */
export function resetSweepForTests(): void {
  swept = null;
}
