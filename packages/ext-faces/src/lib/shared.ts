/**
 * Shared categorizers (#330 P5): categorizers shipped with the app for every player, read beside
 * the player's own: face ones for the face chords, and hand-shape and pose ones for the
 * categorizer chords (an entry's `modality`; face when absent). Pure: the ids, the index's schema, and a shipped file read as a
 * categorizer; the fetching is the app's (`../app/sharedModels.ts`).
 *
 * - **Ids.** A shared categorizer's id is `shared:<name>`. A saved categorizer's id is a slug of
 *   its name (`slugId`: lowercase letters, digits and dashes), so it can never contain the
 *   colon and the two kinds never collide. The `faceCategorizer` dial keeps either kind.
 * - **Files.** `categorizers/index.json` under the app's base lists them
 *   ({@link SharedIndexSchema}); each is `categorizers/<name>.json`, P1's versioned file
 *   (`thoremin.categorizer`, which already carries a name). Fetched the first time something
 *   asks, so no shared model is in any bundle chunk.
 * - **Category ids.** The dial's per-category chords are keyed by slot (`cat-1`..). A shipped
 *   file's categories are given the slot ids in order ({@link withSlotIds}), whatever ids the
 *   file carries, so every category of a shared categorizer can have its own chord.
 * - **No tuning.** A shared file is the same for everyone, and the P3 tuning describes one
 *   player's room and camera, so a shared categorizer plays untuned. To tune it, or retrain it
 *   on one's own face, a player copies it to their own categorizers (the panel's "Copy to my
 *   categorizers"), where the P3 tool works on it like any other.
 */
import { z } from 'zod';
import { importCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { foreignModality } from '@thoremin/sdk/enroll/modality';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import { categorySlot, MAX_CATEGORY_SLOTS } from '../schema';
import { isSharedId, SHARED_PREFIX } from './shared_ids';

export { isSharedId, SHARED_PREFIX, sharedId } from './shared_ids';


/** The folder, under the app's base URL, the shared files are served from. */
export const SHARED_DIR = 'categorizers/';

/** The index file in {@link SHARED_DIR}. */
export const SHARED_INDEX_FILE = 'index.json';



/** The shared name of `id` (null when `id` is not a shared one). */
export const sharedName = (id: string): string | null => (isSharedId(id) ? id.slice(SHARED_PREFIX.length) : null);

/** A shared name is a file name: what may follow the prefix. */
const SharedNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a shared name is lowercase letters, digits and dashes');

export const SharedEntrySchema = z.object({
  /** The file's name in {@link SHARED_DIR}, without `.json`; the id is `shared:<name>`. */
  name: SharedNameSchema,
  /** What the player sees in the list. */
  label: z.string().min(1),
  /** One line on what it is and who it was made from. */
  description: z.string().optional(),
  /** A demonstration of the mechanism, not a model meant to fit anyone: the panel says so. */
  demo: z.boolean().optional(),
  /** What it reads: a face (the default), a hand's shape, or the body's pose. */
  modality: z.enum(['face', 'hand', 'body']).optional(),
});
export type SharedEntry = z.infer<typeof SharedEntrySchema>;

export const SHARED_INDEX_FORMAT = 'thoremin.categorizer-index';

export const SharedIndexSchema = z.object({
  format: z.literal(SHARED_INDEX_FORMAT),
  version: z.literal(1),
  categorizers: z.array(SharedEntrySchema),
});
export type SharedIndex = z.infer<typeof SharedIndexSchema>;

/** The index's entries, or an empty list (with the reason) for a file that is not one. */
export function parseSharedIndex(input: unknown): { entries: SharedEntry[]; error: string | null } {
  const r = SharedIndexSchema.safeParse(input);
  if (!r.success) return { entries: [], error: r.error.issues[0]?.message ?? 'not a categorizer index' };
  const seen = new Set<string>();
  return { entries: r.data.categorizers.filter((e) => !seen.has(e.name) && (seen.add(e.name), true)), error: null };
}

/** The carve modality each shared entry's `modality` names. */
export const SHARED_MODALITIES: Readonly<Record<NonNullable<SharedEntry['modality']>, CarveModality>> = { face: faceModality, hand: handModality, body: bodyModality };

/** What an entry reads (face when it does not say). */
export const entryModality = (e: Pick<SharedEntry, 'modality'>): NonNullable<SharedEntry['modality']> => e.modality ?? 'face';

/** `categorizer` with its categories' ids set to the dial's slots, in order. */
export function withSlotIds(categorizer: PersonalCategorizer): PersonalCategorizer {
  return { ...categorizer, categories: categorizer.categories.map((c, i) => ({ ...c, id: categorySlot(i) })) };
}

/**
 * A shipped file read as a categorizer: validated (an older version migrated, a newer one
 * refused), one of `modality` (a face by default), at most {@link MAX_CATEGORY_SLOTS} categories, its category ids the
 * dial's slots. The error says why it is not one.
 */
export function readSharedFile(input: string | unknown, modality: CarveModality = faceModality): { ok: true; categorizer: PersonalCategorizer } | { ok: false; error: string } {
  const r = importCategorizer(input);
  if (!r.ok) return { ok: false, error: r.error };
  const c = r.categorizer;
  const foreign = foreignModality(modality, c);
  if (foreign) return { ok: false, error: foreign };
  if (c.categories.length > MAX_CATEGORY_SLOTS) return { ok: false, error: `${c.categories.length} categories, more than the ${MAX_CATEGORY_SLOTS} an instrument can give chords to` };
  return { ok: true, categorizer: withSlotIds(c) };
}
