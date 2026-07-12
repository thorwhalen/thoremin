/**
 * Instrument-library metadata model — the SSOT (a Zod schema, per the zodal project
 * rule) for the browsable-collection layer that sits *beside* the instruments: custom
 * {@link Tag}s, and the per-instrument {@link InstrumentMeta} (a favorite flag + the
 * ids of the tags applied to it). Instruments themselves stay in the dials profile
 * store (`@/app/dials/instruments`); this module owns only the metadata *about* them.
 *
 * Two identity rules make the model robust to editing:
 *  - A tag's `id` is a stable, hidden slug that never changes; only its `label` (and
 *    `emoji`) are editable. Instruments reference tags by `id`, so a rename can never
 *    orphan an association (issue #113).
 *  - System tags (issue #114) are read-only, derived-on-read, and namespaced `sys:*`;
 *    they are NOT persisted here — only *custom* tag ids ever land in `tagIds`. The
 *    {@link SYSTEM_TAG_PREFIX} guard keeps a derived id from being mistaken for a
 *    custom one (and is asserted when reading associations back).
 *
 * Storage targets live in {@link ./store}; this file is pure (schema + helpers) so it
 * is unit-testable and strict-typechecked transitively via the library tests.
 */
import { z } from 'zod';
import { slugId } from '@/util/ids';

/** Prefix marking a read-only, derived system-tag id (issue #114). Custom tags never
 *  use it, so association reads can filter defensively against a stale persisted id. */
export const SYSTEM_TAG_PREFIX = 'sys:';

/**
 * A custom tag: a stable hidden `id`, an editable display `label`, and a single-glyph
 * `emoji`. The id is the association key (renaming edits only the label), so it must
 * never collide with a system-tag id — hence the `.refine` guard.
 */
export const TagSchema = z.object({
  id: z
    .string()
    .min(1)
    .refine((s) => !s.startsWith(SYSTEM_TAG_PREFIX), {
      message: 'A custom tag id must not use the reserved system-tag prefix.',
    }),
  label: z.string().min(1),
  emoji: z.string().min(1),
});
export type Tag = z.infer<typeof TagSchema>;

/**
 * Per-instrument library metadata, keyed (in the store) by the instrument's name — the
 * same key the dials profile store uses. `starred` is a free multi-favorite flag (any
 * number of instruments may be starred; distinct from the single default pointer).
 * `tagIds` are the *custom* tag ids applied to the instrument (system tags are derived,
 * never stored). Both default empty so a never-touched instrument needs no record.
 */
export const InstrumentMetaSchema = z.object({
  starred: z.boolean().default(false),
  tagIds: z.array(z.string()).default([]),
});
export type InstrumentMeta = z.infer<typeof InstrumentMetaSchema>;

/** The empty metadata for an instrument with no library record yet. */
export const EMPTY_INSTRUMENT_META: InstrumentMeta = { starred: false, tagIds: [] };

/** The persisted instrument-metadata map (instrument name -> its metadata). A plain,
 *  serializable record so it round-trips cleanly; unknown/blank entries are healed by
 *  the per-field defaults on parse. */
export const InstrumentMetaMapSchema = z.record(z.string(), InstrumentMetaSchema).default({});
export type InstrumentMetaMap = z.infer<typeof InstrumentMetaMapSchema>;

/**
 * Derive a stable, hidden tag id from a display label: a lowercase slug plus a short
 * suffix, so two tags typed with the same casing collide (and are treated as one) while
 * a later rename of the label leaves the id — and every association — untouched. Pure
 * and deterministic (no time/random), so it is safe in tests and reproducible.
 */
export function tagIdForLabel(label: string): string {
  return slugId(label, 'tag');
}

/** Case/space-insensitive normal form of a label, for de-duping "Jazz" vs "jazz ". */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Split a comma-separated tag input into clean, de-duplicated (case-insensitive)
 *  labels, preserving the typed order — the parse for the comma-input tagging field. */
export function parseTagLabels(csv: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of csv.split(',')) {
    const label = raw.trim();
    const key = normalizeLabel(label);
    if (label && !seen.has(key)) {
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}
