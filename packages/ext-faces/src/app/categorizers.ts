/**
 * Every personal categorizer in ONE collection, keyed by modality (#385 E8, #387 C5): the face
 * categorizers, the hand shapes and, next, the poses are records of one zodal named collection,
 * `thoremin.categorizers` (localStorage by default, any `DataProvider` later), each carrying its
 * versioned categorizer file with the file's `modality` (absent = `face`, the only one there was).
 * A tool, the instrument's section and the player read a VIEW of it: one modality's records,
 * under that modality's ids.
 *
 * Ids: a face categorizer keeps the slug of its name, exactly as before (an instrument's
 * `faceCategorizer` dial names it, so it must not move); another modality's are prefixed with
 * the modality (`hand:fist`), so a hand shape and a face may share a name. A slug never contains
 * `:`, so the two never collide, and neither collides with a shared one (`shared:<name>`).
 *
 * ## Expand, migrate, contract
 *
 * This is the EXPAND step (design D.4): the first time a view is used on a device, every record of
 * the old face collection (`thoremin.faceCategorizers`) is copied into this one, migrated as a
 * saved record always is, and a flag says it was done, so a categorizer the player deletes later
 * is not copied back. The old key is left as it was (a build from before reads it, and a rollback
 * loses nothing); the contract step (#385 E10) removes it. Stills are filed by hold id in the
 * existing IndexedDB store, which every modality shares, so nothing about them moves.
 */
import { slugId } from '@thoremin/sdk/util/ids';
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import { localStorageCollectionProvider, type DataProvider, type NamedCollectionStore, type NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { FaceModelRecordSchema, type FaceModelRecord, type SavedFaceModel } from './models';

/** One saved categorizer of any modality (the face's record shape, which every modality shares). */
export type CategorizerRecord = FaceModelRecord;
export type SavedCategorizer = SavedFaceModel;
export type CategorizerStore = NamedCollectionStore<CategorizerRecord, SavedCategorizer>;

/** The one collection's localStorage key. */
export const CATEGORIZERS_STORAGE_KEY = 'thoremin.categorizers';
/** The face collection before #385 E8: read once, copied, then left alone until E10. */
export const LEGACY_FACE_STORAGE_KEY = 'thoremin.faceCategorizers';
/** Set once the legacy face records have been copied on this device. */
export const CATEGORIZERS_MIGRATED_KEY = 'thoremin.categorizers.migrated';

/** The modality a record is of (`face` for a file that does not say). */
export const recordModality = (r: Pick<CategorizerRecord, 'model'>): string => r.model.categorizer.modality ?? 'face';

/** The id a categorizer named `name` gets in `modality`'s view. */
export function categorizerId(modality: Pick<CarveModality, 'id' | 'words'>, name: string): string {
  return modality.id === 'face' ? slugId(name, modality.words.slug) : `${modality.id}:${slugId(name, modality.words.slug)}`;
}

/** Whether the one-time copy has run on this device. */
export interface MigrationFlag {
  done(): boolean;
  mark(): void;
}

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
  const have = new Set((await target.getList({})).data.map((r) => r.id));
  for (const raw of (await legacy.getList({})).data) {
    const parsed = FaceModelRecordSchema.safeParse(raw);
    if (!parsed.success || have.has(parsed.data.id)) continue;
    const rec = parsed.data;
    const categorizer = rec.model.categorizer.modality ? rec.model.categorizer : { ...rec.model.categorizer, modality: 'face' };
    await target.create({ ...rec, model: { ...rec.model, categorizer } });
    have.add(rec.id);
    copied++;
  }
  flag.mark();
  return copied;
}

export interface CategorizerStoreOptions {
  /** Where the one collection lives (localStorage under {@link CATEGORIZERS_STORAGE_KEY} by default). */
  provider?: DataProvider<CategorizerRecord>;
  /** The legacy face collection to copy from once (localStorage under
   *  {@link LEGACY_FACE_STORAGE_KEY} when the provider is the default one; none otherwise). */
  legacy?: DataProvider<CategorizerRecord> | null;
  flag?: MigrationFlag;
}

/**
 * `modality`'s view of the one collection: lists, loads and removes only its records, saves under
 * its ids with the file's `modality` stamped. The legacy copy runs before the first operation.
 */
export function createCategorizerStore(modality: Pick<CarveModality, 'id' | 'words'>, options: CategorizerStoreOptions = {}): CategorizerStore {
  const defaulted = options.provider === undefined;
  const provider = options.provider ?? localStorageCollectionProvider<CategorizerRecord>(CATEGORIZERS_STORAGE_KEY);
  const legacy = options.legacy !== undefined ? options.legacy : defaulted ? localStorageCollectionProvider<CategorizerRecord>(LEGACY_FACE_STORAGE_KEY) : null;
  const flag = options.flag ?? localStorageFlag();
  let migrated: Promise<unknown> | null = null;
  const ready = (): Promise<unknown> => (migrated ??= legacy ? migrateLegacyFaces(provider, legacy, flag).catch((e: unknown) => console.warn('categorizers: the face categorizers were not copied:', e)) : Promise.resolve());
  const mine = (r: CategorizerRecord): boolean => recordModality(r) === modality.id;
  /** This view's records that validate (a record of another shape is skipped, never thrown). */
  const all = async (): Promise<CategorizerRecord[]> => {
    await ready();
    const out: CategorizerRecord[] = [];
    for (const raw of (await provider.getList({})).data) {
      const parsed = FaceModelRecordSchema.safeParse(raw);
      if (parsed.success && mine(parsed.data)) out.push(parsed.data);
    }
    return out;
  };
  return {
    async list(): Promise<NamedSummary[]> {
      return (await all()).map(({ id, name, createdAt }) => ({ id, name, createdAt })).sort((a, b) => b.createdAt - a.createdAt);
    },
    async save(name, payload, now) {
      await ready();
      const id = categorizerId(modality, name);
      const categorizer = payload.categorizer.modality === modality.id ? payload.categorizer : { ...payload.categorizer, modality: modality.id };
      const record = FaceModelRecordSchema.parse({ id, name: name.trim() || id, createdAt: now ?? Date.now(), model: { ...payload, categorizer } });
      const existing = (await provider.getList({})).data.find((r) => r.id === id);
      return existing ? provider.update(id, record) : provider.create(record);
    },
    async load(id) {
      return (await all()).find((r) => r.id === id) ?? null;
    },
    async remove(id) {
      await ready();
      const found = (await all()).some((r) => r.id === id);
      if (found) await provider.delete(id);
    },
  };
}
