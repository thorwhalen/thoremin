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
 * - Stills of an unsaved take are in memory, never in the store, so a take in progress is safe;
 *   the one window is another tab filing stills just before saving its record, which is why the
 *   delete stays behind the flag.
 */
import { createCategorizerIndex, type CategorizerIndex } from '@thoremin/sdk-ui/enroll/categorizers';
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

export interface SweepOptions {
  thumbs: ThumbStore;
  index: Pick<CategorizerIndex, 'list' | 'load'>;
  /** Delete the orphans (default false: list them only). */
  remove?: boolean;
}

export interface SweepResult {
  orphans: string[];
  removed: boolean;
}

/** List (and with `remove`, delete) the stills no saved categorizer names. */
export async function sweepOrphanStills({ thumbs, index, remove = false }: SweepOptions): Promise<SweepResult> {
  const referenced = await referencedHoldIds(index);
  if (!referenced) return { orphans: [], removed: false };
  const orphans = orphanStillKeys(await thumbs.keys(), referenced);
  if (remove && orphans.length > 0) await thumbs.remove(orphans);
  return { orphans, removed: remove && orphans.length > 0 };
}

const deleteFlagged = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(STILL_SWEEP_FLAG_KEY) === STILL_SWEEP_DELETE;
  } catch {
    return false;
  }
};

let swept: Promise<SweepResult | null> | null = null;

/** The sweep once per page, in the browser, never throwing: it logs what it found (and removed). */
export function sweepOrphanStillsOnce(thumbs: ThumbStore, options: { index?: Pick<CategorizerIndex, 'list' | 'load'>; remove?: boolean } = {}): Promise<SweepResult | null> {
  return (swept ??= sweepOrphanStills({ thumbs, index: options.index ?? createCategorizerIndex(), remove: options.remove ?? deleteFlagged() }).then(
    (r) => {
      if (r.orphans.length > 0) {
        console.info(`stills: ${r.orphans.length} still(s) no saved categorizer names${r.removed ? ' were removed' : `; set localStorage['${STILL_SWEEP_FLAG_KEY}'] = '${STILL_SWEEP_DELETE}' to remove them`}`);
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
