/**
 * The bound sets saved before #371 (`thoremin-categories`), migrated once per device into the one
 * collection of categorizers: the MIGRATE step of #387 C5's expand / migrate / contract (E8 was the
 * expand step; #385 E10 is the contract step, which deletes the old key and this module).
 *
 * A bound set was a trained model, its bindings and, for a carved categorizer bound from its tool
 * (#385 E8), how it read the live vector (`read`) under the categorizer's name. Each one becomes:
 *
 * - **its categorizer's bindings**, when it was a copy of a carved categorizer that is still in
 *   the collection (same modality, same name, same hand) and EVERY one of its bindings carries
 *   onto that categorizer's categories (same id and name, else the same unique name). The bound
 *   copy is then redundant: the categorizer itself is played, so later edits reach the bindings.
 *   A binding the categorizer already has is kept.
 * - **a trained model kept as it is** (`trained:<slug>`), otherwise: the Trainer's sets, and a
 *   copy whose categorizer was deleted or edited past what its bindings name. It plays exactly as
 *   the bound set did (the same model, read the same way) and fires the same commands.
 *
 * The old records are left where they are (a build from before still reads them on a rollback,
 * and a re-run finds every record already in place). A flag says the migration ran, so a record
 * the player deletes later is not migrated back. Returns old id -> new id, so the active set (a
 * per-device pref that names an old id) can follow.
 */
import { z } from 'zod';
import { BoundCategoriesSchema, rekeyBindings, type CategoryBinding } from '@thoremin/sdk/enroll/bind';
import { categorizerId, isTrainedRecord, recordBindings, trainedId } from '@thoremin/sdk/enroll/record';
import { modalityById } from '@thoremin/sdk/features/modalities';
import { localStorageFlag, type CategorizerIndex, type MigrationFlag } from '@thoremin/sdk-ui/enroll/categorizers';
import { localStorageCollectionProvider, type DataProvider } from '@thoremin/sdk-ui/namedCollection';

/** The bound sets' localStorage key before #371: read once, migrated, then left until E10. */
export const SAVED_CATEGORIES_STORAGE_KEY = 'thoremin-categories';
/** Set once the old bound sets have been migrated on this device. */
export const BOUND_SETS_MIGRATED_KEY = 'thoremin.categorizers.boundSetsMigrated';

/** A bound set as it was saved before #371. */
export const LegacyBoundSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  categories: BoundCategoriesSchema,
});
export type LegacyBoundSet = z.infer<typeof LegacyBoundSetSchema>;

/** Where the migration finds the old sets, and its flag (localStorage by default). */
export interface BoundSetsMigrationOptions {
  /** The old collection (null: nothing to migrate). */
  legacy?: DataProvider<LegacyBoundSet> | null;
  flag?: MigrationFlag;
}

/** The carved categorizer a bound copy names, if it is still there and takes every binding:
 *  its id and the merged bindings. */
async function takeOver(index: CategorizerIndex, set: LegacyBoundSet): Promise<{ id: string; bindings: Record<string, CategoryBinding> } | null> {
  const read = set.categories.read;
  const modality = read ? modalityById(read.modality) : undefined;
  if (!read || !modality) return null;
  const id = categorizerId(modality, set.name);
  const target = await index.load(id);
  if (!target || isTrainedRecord(target)) return null;
  const c = target.model.categorizer;
  if ((c.modality ?? 'face') !== read.modality || (c.hand ?? 'either') !== (read.hand ?? 'either') || (c.mirror === true) !== (read.mirror === true)) return null;
  const old = set.categories.bindings;
  const carried = rekeyBindings({ categories: set.categories.model.categories }, old, c);
  if (Object.keys(carried).length !== Object.keys(old).length) return null;
  return { id, bindings: { ...carried, ...recordBindings(target) } };
}

/** Migrate the old bound sets into `index` once (see the module comment). Returns old id -> new id. */
export async function migrateBoundSets(index: CategorizerIndex, legacy: DataProvider<LegacyBoundSet>, flag: MigrationFlag): Promise<Map<string, string>> {
  const remap = new Map<string, string>();
  if (flag.done()) return remap;
  for (const raw of (await legacy.getList({})).data) {
    const parsed = LegacyBoundSetSchema.safeParse(raw);
    if (!parsed.success) continue;
    const set = parsed.data;
    const target = await takeOver(index, set);
    if (target) {
      await index.setBindings(target.id, target.bindings);
      remap.set(set.id, target.id);
      continue;
    }
    const id = trainedId(set.name);
    // Already here (a re-run, or the player saved one under that name since): never overwritten.
    if (!(await index.load(id))) {
      const { model, bindings, read } = set.categories;
      await index.saveTrained(set.name, { trained: model, bindings, ...(read ? { read } : {}) }, set.createdAt);
    }
    remap.set(set.id, id);
  }
  flag.mark();
  return remap;
}

let once: Promise<Map<string, string>> | null = null;

/** The migration into `index`, run once per page however many callers ask (the engine and the
 *  panel both load on a cold start). Failing, it warns and migrates nothing this time. */
export function migrateBoundSetsOnce(index: CategorizerIndex, options: BoundSetsMigrationOptions = {}): Promise<Map<string, string>> {
  const legacy = options.legacy !== undefined ? options.legacy : localStorageCollectionProvider<LegacyBoundSet>(SAVED_CATEGORIES_STORAGE_KEY);
  if (!legacy) return Promise.resolve(new Map());
  once ??= migrateBoundSets(index, legacy, options.flag ?? localStorageFlag(BOUND_SETS_MIGRATED_KEY)).catch((e: unknown) => {
    console.warn('category bindings: the saved categories were not migrated:', e);
    once = null;
    return new Map<string, string>();
  });
  return once;
}

/** Forget the run (a retargeted index, tests). */
export function resetBoundSetsMigration(): void {
  once = null;
}
