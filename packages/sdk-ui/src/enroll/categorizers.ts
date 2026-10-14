/**
 * Every personal categorizer in ONE collection, keyed by kind (#385 E8, #387 C5, #371): the face
 * categorizers, the hand shapes, the poses and the Trainer's models are records of one zodal named
 * collection, `thoremin.categorizers` (localStorage by default, any `DataProvider` later). The
 * record shapes are the SDK's (`@thoremin/sdk/enroll/record`). A carve tool, the instrument's
 * section and the player read a VIEW of it: one kind's records, under that kind's ids; the host's
 * command bindings read the INDEX, every kind at once.
 *
 * Ids: a face categorizer keeps the slug of its name, exactly as before (an instrument's
 * `faceCategorizer` dial names it, so it must not move); every other kind's are prefixed with the
 * kind (`hand:fist`, `trained:my-categories`), so a hand shape and a face may share a name. A
 * slug never contains `:`, so no two collide, and none collides with a shared one (`shared:<name>`).
 *
 * In the SDK's app half since #371 (it was the faces extension's `app/categorizers.ts`): the host
 * reads and writes the same records for its bindings, and must do so in a build without the
 * extension.
 *
 * ## Bindings ride the record
 *
 * A category's command binding (#160) is kept on the record it names, on this device, never in
 * the exported file. A view's `save` (a correction, a re-cut, a re-save) does not know about
 * bindings, so the collection carries them itself: the stored record's bindings are re-keyed
 * onto the saved categories by id-and-name, then by name (`rekeyBindings`). The host writes them
 * with {@link CategorizerIndex.setBindings}, which touches nothing else on the record.
 *
 * ## Where the records live (#412)
 *
 * In IndexedDB (`thoremin-categorizers`, a record per key; `../idbCollection`), not localStorage:
 * a record may hold two thousand samples of ~2 KB each, past the ~5 MB budget the whole app
 * shares. EXPAND/MIGRATE: the first time the collection is used on a device every record under
 * the localStorage key is copied into IndexedDB as stored, never over one already there, and a
 * flag says so. The localStorage key is left exactly as it was (nothing is deleted; the contract
 * step is later); it is also the store used where IndexedDB cannot be opened. A build from before
 * #412 reads that key on a rollback, so it sees the records as of the copy. The stills were
 * already in IndexedDB (`thoremin-faces`, `ext-faces/app/thumbnails.ts`) and do not move.
 *
 * ## Expand, migrate, contract (the old face collection)
 *
 * This is the EXPAND step (design D.4): the first time a view is used on a device, every record of
 * the old face collection (`thoremin.faceCategorizers`) is copied into this one, migrated as a
 * saved record always is, and a flag says it was done, so a categorizer the player deletes later
 * is not copied back. The old key is left as it was (a build from before still reads it on a
 * rollback, though what that build saves after the copy is not copied again: the flag is set); the
 * contract step (#385 E10) removes it. The copy runs once per collection per page however many
 * views ask at once (the tool, the editor section and the instrument's resolver all do on a cold
 * start), and checks the target by id right before each write. Stills are filed by hold id in the
 * existing IndexedDB store, which every modality shares, so nothing about them moves. The host
 * migrates its own old bound sets (`thoremin-categories`) the same way, after this copy.
 */
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import { rekeyBindings } from '@thoremin/sdk/enroll/bind';
import {
  CategorizerRecordSchema,
  TrainedRecordSchema,
  TRAINED_KIND,
  categorizerId,
  parseRecord,
  recordBindings,
  recordCategories,
  recordKind,
  trainedId,
  type AnyCategorizerRecord,
  type CategorizerRecord,
  type RecordBindings,
  type SavedCategorizer,
  type TrainedPayload,
  type TrainedRecord,
} from '@thoremin/sdk/enroll/record';
import { localStorageCollectionProvider, type DataProvider, type NamedCollectionStore, type NamedSummary } from '../namedCollection';
import { createIdbProvider, createMigratingProvider, type MigrationFlag } from '../idbCollection';

export { categorizerId, type CategorizerRecord, type SavedCategorizer };
export type CategorizerStore = NamedCollectionStore<CategorizerRecord, SavedCategorizer>;

/** The one collection's localStorage key: where it lived until #412, and the fallback where
 *  IndexedDB is not usable. */
export const CATEGORIZERS_STORAGE_KEY = 'thoremin.categorizers';
/** The IndexedDB database the records live in since #412 (one object store, a record per key). */
export const CATEGORIZERS_IDB_NAME = 'thoremin-categorizers';
/** Set once the localStorage records have been copied into IndexedDB on this device (#412). */
export const CATEGORIZERS_IDB_MIGRATED_KEY = 'thoremin.categorizers.idbMigrated';
/** The face collection before #385 E8: read once, copied, then left alone until E10. */
export const LEGACY_FACE_STORAGE_KEY = 'thoremin.faceCategorizers';
/** Set once the legacy face records have been copied on this device. */
export const CATEGORIZERS_MIGRATED_KEY = 'thoremin.categorizers.migrated';

/** The modality a carved record is of (`face` for a file that does not say). */
export const recordModality = (r: Pick<CategorizerRecord, 'model'>): string => r.model.categorizer.modality ?? 'face';

// --- change notice ---------------------------------------------------------------------------

/**
 * Saved categorizers changed (a save, a replace, a delete): the listeners re-read what they hold.
 * How an instrument playing a categorizer, and the host's bindings, pick up a correction made in a
 * tool without polling. In-page only; another tab's edit reaches this one on its next load. A
 * binding edit is not a change of the categorizer and sends no notice.
 */
const changeListeners = new Set<() => void>();

export function onCategorizersChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function notifyChanged(): void {
  for (const l of [...changeListeners]) l();
}

/** `store` with a change notice after every save and remove. */
export function withChangeNotice<T extends NamedSummary, P>(store: NamedCollectionStore<T, P>): NamedCollectionStore<T, P> {
  return {
    ...store,
    save: async (name, payload, now) => {
      const out = await store.save(name, payload, now);
      notifyChanged();
      return out;
    },
    remove: async (id: string) => {
      await store.remove(id);
      notifyChanged();
    },
  };
}

// --- the one-time copy of the old face collection ------------------------------------------------

export type { MigrationFlag };

/** The flag in localStorage (always "done" where there is no localStorage: nothing to copy). */
export function localStorageFlag(key: string = CATEGORIZERS_MIGRATED_KEY): MigrationFlag {
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    done: () => ls()?.getItem(key) === '1' || ls() === null,
    mark: () => {
      try {
        ls()?.setItem(key, '1');
      } catch {
        // Storage refused (quota, private mode): the copy runs again next time, which is harmless
        // while the flag cannot be kept (a record already here is never overwritten by it).
      }
    },
  };
}

/**
 * Copy the legacy face records into `target` once (see the module comment): every record that
 * validates (migrated on the way, as a load migrates it) and is not already in `target` by id.
 * Returns how many were copied.
 */
export async function migrateLegacyFaces(target: DataProvider<CategorizerRecord>, legacy: DataProvider<CategorizerRecord>, flag: MigrationFlag): Promise<number> {
  if (flag.done()) return 0;
  let copied = 0;
  for (const raw of (await legacy.getList({})).data) {
    const parsed = CategorizerRecordSchema.safeParse(raw);
    if (!parsed.success) continue;
    // Read the target again before every write: never two records under one id.
    if ((await target.getList({})).data.some((r) => r.id === parsed.data.id)) continue;
    const rec = parsed.data;
    const categorizer = rec.model.categorizer.modality ? rec.model.categorizer : { ...rec.model.categorizer, modality: 'face' };
    await target.create({ ...rec, model: { ...rec.model, categorizer } });
    copied++;
  }
  flag.mark();
  return copied;
}

let defaultProvider: DataProvider<CategorizerRecord> | null = null;

/**
 * The browser's provider of the one collection (#412): IndexedDB, with the localStorage records
 * copied in once and left alone (`createMigratingProvider`), and localStorage itself where
 * IndexedDB is not usable. One per page, so every view settles the question once.
 */
export function defaultCategorizerProvider(): DataProvider<CategorizerRecord> {
  return (defaultProvider ??= createMigratingProvider<CategorizerRecord>({
    primary: createIdbProvider<CategorizerRecord>({ dbName: CATEGORIZERS_IDB_NAME }),
    legacy: localStorageCollectionProvider<CategorizerRecord>(CATEGORIZERS_STORAGE_KEY),
    flag: localStorageFlag(CATEGORIZERS_IDB_MIGRATED_KEY),
  }));
}

/** The copy under way, per collection (its storage key, or an injected provider): shared by every
 *  view of it that asks while it runs. */
const copies = new Map<unknown, Promise<unknown>>();

export interface CategorizerStoreOptions {
  /** Where the one collection lives (localStorage under {@link CATEGORIZERS_STORAGE_KEY} by default). */
  provider?: DataProvider<CategorizerRecord>;
  /** The legacy face collection to copy from once (localStorage under
   *  {@link LEGACY_FACE_STORAGE_KEY} when the provider is the default one; none otherwise). */
  legacy?: DataProvider<CategorizerRecord> | null;
  flag?: MigrationFlag;
}

/** The collection behind a view or the index: its provider, and the wait for the legacy copy. */
function openCollection(options: CategorizerStoreOptions): { provider: DataProvider<CategorizerRecord>; ready: () => Promise<unknown> } {
  const defaulted = options.provider === undefined;
  const provider = options.provider ?? defaultCategorizerProvider();
  const legacy = options.legacy !== undefined ? options.legacy : defaulted ? localStorageCollectionProvider<CategorizerRecord>(LEGACY_FACE_STORAGE_KEY) : null;
  const flag = options.flag ?? localStorageFlag();
  const copyKey: unknown = defaulted ? CATEGORIZERS_STORAGE_KEY : provider;
  const ready = (): Promise<unknown> => {
    if (!legacy) return Promise.resolve();
    let copy = copies.get(copyKey);
    if (!copy) {
      // Shared while it runs; once settled, the flag says whether it is done.
      copy = migrateLegacyFaces(provider, legacy, flag)
        .catch((e: unknown) => console.warn('categorizers: the face categorizers were not copied:', e))
        .finally(() => copies.delete(copyKey));
      copies.set(copyKey, copy);
    }
    return copy;
  };
  return { provider, ready };
}

/** Summaries of the stored records `keep` accepts, newest first: a record that no longer
 *  validates is listed too (it cannot be opened, but it can be deleted). */
function summaries(raws: readonly unknown[], keep: (raw: unknown) => boolean): (NamedSummary & { kind: string })[] {
  return raws
    .filter((r): r is { id: string; name?: unknown; createdAt?: unknown } => keep(r) && typeof (r as { id?: unknown })?.id === 'string')
    .map((r) => ({ id: r.id, name: typeof r.name === 'string' ? r.name : r.id, createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0, kind: recordKind(r) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** `payload` without its bindings (the collection decides what a save keeps). */
function withoutBindings<P extends { bindings?: unknown }>(payload: P): Omit<P, 'bindings'> {
  const { bindings: _bindings, ...rest } = payload;
  return rest;
}

/** Write `record` under its id (an update when one is there, else a create). */
async function put<T extends AnyCategorizerRecord>(provider: DataProvider<CategorizerRecord>, record: T): Promise<T> {
  const p = provider as unknown as DataProvider<T>;
  const exists = (await provider.getList({})).data.some((r) => r.id === record.id);
  return exists ? p.update(record.id, record) : p.create(record);
}

/** The stored record under `id`, validated (null when absent or invalid). */
async function stored(provider: DataProvider<CategorizerRecord>, id: string): Promise<AnyCategorizerRecord | null> {
  const raw = (await provider.getList({})).data.find((r) => r.id === id);
  return raw ? parseRecord(raw) : null;
}

/**
 * `modality`'s view of the one collection: lists, loads and removes only its records, saves under
 * its ids with the file's `modality` stamped and the stored record's bindings carried. The legacy
 * copy runs before the first operation.
 */
export function createCategorizerStore(modality: Pick<CarveModality, 'id' | 'words'>, options: CategorizerStoreOptions = {}): CategorizerStore {
  const { provider, ready } = openCollection(options);
  const mine = (raw: unknown): boolean => recordKind(raw) === modality.id;
  /** This view's records that validate. */
  const all = async (): Promise<CategorizerRecord[]> => {
    await ready();
    const out: CategorizerRecord[] = [];
    for (const raw of (await provider.getList({})).data) {
      if (!mine(raw)) continue;
      const parsed = CategorizerRecordSchema.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  };
  return {
    async list(): Promise<NamedSummary[]> {
      await ready();
      return summaries((await provider.getList({})).data, mine).map(({ id, name, createdAt }) => ({ id, name, createdAt }));
    },
    async save(name, payload, now) {
      await ready();
      const id = categorizerId(modality, name);
      const categorizer = payload.categorizer.modality === modality.id ? payload.categorizer : { ...payload.categorizer, modality: modality.id };
      const previous = await stored(provider, id);
      const kept = previous ? recordBindings(previous) : {};
      const bindings = payload.bindings ?? (previous && Object.keys(kept).length > 0 ? rekeyBindings({ categories: recordCategories(previous) }, kept, categorizer) : undefined);
      const record = CategorizerRecordSchema.parse({
        id,
        name: name.trim() || id,
        createdAt: now ?? Date.now(),
        model: { ...withoutBindings(payload), categorizer, ...(bindings && Object.keys(bindings).length > 0 ? { bindings } : {}) },
      });
      return put(provider, record);
    },
    async load(id) {
      return (await all()).find((r) => r.id === id) ?? null;
    },
    async remove(id) {
      await ready();
      if ((await provider.getList({})).data.some((r) => r.id === id && mine(r))) await provider.delete(id);
    },
  };
}

// --- the host's index: every kind ----------------------------------------------------------------

/** A record's summary with its kind (`face`, `hand`, `body`, {@link TRAINED_KIND}). */
export type CategorizerSummary = NamedSummary & { kind: string };

/** Every kind at once, for the host's command bindings (#371). */
export interface CategorizerIndex {
  /** Every record, newest first (one that no longer validates too: it can be deleted). */
  list(): Promise<CategorizerSummary[]>;
  /** A record of any kind, validated (null when absent or invalid). */
  load(id: string): Promise<AnyCategorizerRecord | null>;
  /** Keep a trained model under `name` (`trained:<slug>`; a record of that id is replaced). Sends
   *  no change notice (no instrument plays a trained model). */
  saveTrained(name: string, payload: TrainedPayload, now?: number): Promise<TrainedRecord>;
  /** Replace one record's bindings, and nothing else on it (null when there is no such record, or
   *  it does not validate: nothing is written then). No change notice. */
  setBindings(id: string, bindings: RecordBindings): Promise<AnyCategorizerRecord | null>;
  remove(id: string): Promise<void>;
}

export function createCategorizerIndex(options: CategorizerStoreOptions = {}): CategorizerIndex {
  const { provider, ready } = openCollection(options);
  return {
    async list() {
      await ready();
      return summaries((await provider.getList({})).data, () => true);
    },
    async load(id) {
      await ready();
      return stored(provider, id);
    },
    async saveTrained(name, payload, now) {
      await ready();
      const id = trainedId(name);
      const record = TrainedRecordSchema.parse({ id, name: name.trim() || id, createdAt: now ?? Date.now(), model: payload });
      // No change notice: a trained model is played by no instrument, and the host that saves it
      // updates itself (a notice re-resolves every playing categorizer).
      return put(provider, record);
    },
    async setBindings(id, bindings) {
      await ready();
      const raw = (await provider.getList({})).data.find((r) => r.id === id);
      if (!raw || !parseRecord(raw)) return null;
      // Only `model.bindings` changes: the stored record is patched as read, never rebuilt from a
      // parse (which would drop what a newer build added to it).
      const patched = { ...raw, model: { ...raw.model, bindings } } as CategorizerRecord;
      return parseRecord(await provider.update(id, patched));
    },
    async remove(id) {
      await ready();
      const raw = (await provider.getList({})).data.find((r) => r.id === id);
      if (!raw) return;
      await provider.delete(id);
      // A carved categorizer may be playing in an instrument; a trained model never is.
      if (recordKind(raw) !== TRAINED_KIND) notifyChanged();
    },
  };
}
