/**
 * The shared categorizers' source (#330 P5): the index and the files under the app's base
 * (`categorizers/`), fetched the first time something asks and kept for the page, read as saved
 * records so the instrument's loader (`categorizerPlay.ts`) and the editor section take a
 * shared id like a saved one. Plus "copy to my categorizers": the shared file saved into the
 * player's own collection, where the P3 tool tests it, tunes it and retrains it on their face.
 *
 * Every dependency is injected ({@link SharedSourceDeps}); {@link sharedSource} is the
 * browser's, one per page.
 */
import type { NamedCollectionStore, NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { slugId } from '@thoremin/sdk/util/ids';
import { parseSharedIndex, readSharedFile, SHARED_DIR, SHARED_INDEX_FILE, sharedId, sharedName, type SharedEntry } from '../lib/shared';
import type { FaceModelRecord, SavedFaceModel } from './models';

export interface SharedSourceDeps {
  /** Fetch a file under the app's base by its path (`categorizers/index.json`) and parse its JSON. */
  fetchJson(path: string): Promise<unknown>;
}

export interface SharedListing {
  entries: readonly SharedEntry[];
  /** Why the index could not be read (null when it was). */
  error: string | null;
}

export interface SharedSource {
  /** The shipped index (an empty listing when there is none or it cannot be read). */
  list(): Promise<SharedListing>;
  /** A shared categorizer as a saved record (no stills, no tuning), or null when `id` is not a
   *  shared one, is not listed, or its file cannot be read. */
  load(id: string): Promise<FaceModelRecord | null>;
}

export function createSharedSource(deps: SharedSourceDeps): SharedSource {
  let listing: Promise<SharedListing> | null = null;
  const files = new Map<string, Promise<FaceModelRecord | null>>();

  const list = (): Promise<SharedListing> => {
    if (listing) return listing;
    const pending = deps.fetchJson(`${SHARED_DIR}${SHARED_INDEX_FILE}`).then(
      (json) => parseSharedIndex(json),
      (err: unknown) => {
        // Not kept: a fetch that failed (offline, a deploy in flight) is tried again on the next ask.
        if (listing === pending) listing = null;
        return { entries: [], error: err instanceof Error ? err.message : String(err) };
      },
    );
    listing = pending;
    return pending;
  };

  const read = async (entry: SharedEntry): Promise<FaceModelRecord | null> => {
    const r = readSharedFile(await deps.fetchJson(`${SHARED_DIR}${entry.name}.json`));
    if (!r.ok) return null;
    return { id: sharedId(entry.name), name: entry.label, createdAt: 0, model: { categorizer: r.categorizer, takeId: null } };
  };

  return {
    list,
    async load(id) {
      const name = sharedName(id);
      if (name === null) return null;
      const entry = (await list()).entries.find((e) => e.name === name);
      if (!entry) return null;
      let file = files.get(name);
      if (!file) {
        file = read(entry).catch(() => null);
        files.set(name, file);
        // A failed read is not kept, so a later ask (another instrument, a retry) fetches again.
        void file.then((r) => r === null && files.delete(name));
      }
      return file;
    },
  };
}

/** Fetch JSON under the app's base URL (Vite's `BASE_URL`, e.g. `/thoremin/`). */
export function fetchUnderBase(path: string): Promise<unknown> {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return fetch(`${base}${path}`).then((res) => {
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  });
}

let browserSource: SharedSource | null = null;

/** The page's shared source (one fetch of each file per page). */
export function sharedSource(): SharedSource {
  browserSource ??= createSharedSource({ fetchJson: fetchUnderBase });
  return browserSource;
}

/** The fallback id of a name that slugs to nothing (the collection's `idFallback`). */
const ID_FALLBACK = 'faces';

/**
 * A name for the copy that replaces none of the player's: `label`, else `label (2)`, ... The
 * collection keys a record by the SLUG of its name and replaces a record with the same slug, so
 * a candidate is free only when neither its name nor its slug is taken ("Demo: a & b" and
 * "demo a b" are one record).
 */
export function copyName(label: string, taken: readonly Pick<NamedSummary, 'id' | 'name'>[]): string {
  const names = new Set(taken.map((t) => t.name.trim().toLowerCase()));
  const ids = new Set(taken.map((t) => t.id));
  const free = (n: string) => !names.has(n.trim().toLowerCase()) && !ids.has(slugId(n, ID_FALLBACK));
  if (free(label)) return label;
  for (let n = 2; ; n++) {
    const candidate = `${label} (${n})`;
    if (free(candidate)) return candidate;
  }
}

/**
 * Copy a shared categorizer into the player's own: saved under a name none of theirs has (saving
 * under a taken name would replace that one), with no stills and the default tuning: the same
 * file (samples, categories in slot order, mode), renamed. Returns the new record, or null when
 * `id` is not a shared categorizer this page can read.
 */
export async function copySharedToMine(
  id: string,
  source: SharedSource,
  mine: Pick<NamedCollectionStore<FaceModelRecord, SavedFaceModel>, 'list' | 'save'>,
): Promise<FaceModelRecord | null> {
  const shared = await source.load(id);
  if (!shared) return null;
  const name = copyName(shared.name, await mine.list());
  return mine.save(name, { categorizer: { ...shared.model.categorizer, name }, takeId: null });
}
