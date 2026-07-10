/**
 * The instrument-library persistence layer — the zodal storage targets behind the
 * library metadata model ({@link ./model}). Two persistence shapes, matching what each
 * datum actually is:
 *
 *  - **Custom tags** are a browsable collection of named things the tag manager
 *    lists / creates / renames / deletes — so they live behind a `@zodal/store`
 *    `DataProvider<Tag>` (the `@zodal/store-localstorage` adapter in the browser, an
 *    in-memory provider in the Node test runtime). This is the project's "zodal way"
 *    for a collection, exercised end-to-end here.
 *  - **Per-instrument metadata** (a favorite flag + applied custom-tag ids, keyed by
 *    instrument name) is an attribute map, not a browsable list, so it is a single
 *    Zod-validated JSON blob behind a tiny localStorage seam (mirroring how the existing
 *    `getDefaultName`/selected-name scalars persist in `@/app/dials/instruments`). The
 *    single **default** pointer stays where it already lives (that module).
 *
 * Everything here is framework-agnostic and unit-tested (the pure map helpers directly;
 * the async ops against the in-memory provider), so the React binding
 * ({@link ./useLibrary}) stays a thin adapter.
 */
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import {
  TagSchema,
  InstrumentMetaSchema,
  InstrumentMetaMapSchema,
  EMPTY_INSTRUMENT_META,
  tagIdForLabel,
  normalizeLabel,
  type Tag,
  type InstrumentMeta,
  type InstrumentMetaMap,
} from './model';
import { autoAssignEmoji } from './emoji';

const TAGS_KEY = 'thoremin.library.tags';
const META_KEY = 'thoremin.library.instrumentMeta';

/** Whether a real `localStorage` is available (false in the Node test runtime). */
function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/** The tags collection provider — localStorage in the browser, in-memory otherwise so
 *  importing this module never throws where storage is absent. */
function makeTagsProvider(): DataProvider<Tag> {
  if (hasLocalStorage()) {
    try {
      return createLocalStorageProvider<Tag>({ storageKey: TAGS_KEY, idField: 'id' });
    } catch {
      /* fall through to in-memory */
    }
  }
  return createInMemoryProvider<Tag>([]);
}

export const tagsProvider: DataProvider<Tag> = makeTagsProvider();

// --- Tags collection ops ----------------------------------------------------------

/** All custom tags (validated). */
export async function listTags(): Promise<Tag[]> {
  const { data } = await tagsProvider.getList({});
  return data.map((t) => TagSchema.parse(t));
}

/** A tag id not already taken, derived from `label` with a numeric suffix on collision. */
function uniqueTagId(label: string, existing: ReadonlySet<string>): string {
  const base = tagIdForLabel(label);
  if (!existing.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/**
 * Find the tag matching `label` (by id slug or normalized label) or create a new one.
 * A new tag gets an auto-assigned emoji ({@link autoAssignEmoji}) preferring a confident
 * name match, else a random unused pool glyph. Returns the resolved (existing or created)
 * tag, so the caller can associate it with an instrument by id. `rng` is injectable for
 * deterministic tests.
 */
export async function resolveOrCreateTag(
  label: string,
  opts: { rng?: () => number } = {},
): Promise<Tag> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('A tag label is required.');
  const tags = await listTags();
  const norm = normalizeLabel(trimmed);
  // Match ONLY on the current label — not the id slug. After a rename the id no longer
  // equals `tagIdForLabel(label)`, so an id-slug match would resolve a since-renamed tag
  // when the user retypes its ORIGINAL label (attaching the wrong tag). Label-only match
  // + uniqueTagId means retyping the old label creates a fresh, correctly-labeled tag.
  const existing = tags.find((t) => normalizeLabel(t.label) === norm);
  if (existing) return existing;

  const id = uniqueTagId(trimmed, new Set(tags.map((t) => t.id)));
  const emoji = autoAssignEmoji(trimmed, tags.map((t) => t.emoji), opts.rng);
  const created = TagSchema.parse({ id, label: trimmed, emoji });
  await tagsProvider.create(created);
  return created;
}

/** Rename a tag's display label (its id — and every association — is untouched). Rejects
 *  a label already used by another tag, so the one-tag-per-label invariant that
 *  {@link resolveOrCreateTag} and the autosuggest rely on cannot be broken by a rename. */
export async function renameTag(id: string, label: string): Promise<Tag> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('A tag label is required.');
  const norm = normalizeLabel(trimmed);
  const clash = (await listTags()).find((t) => t.id !== id && normalizeLabel(t.label) === norm);
  if (clash) throw new Error(`A tag labeled "${clash.label}" already exists.`);
  return TagSchema.parse(await tagsProvider.update(id, { label: trimmed }));
}

/** Change a tag's emoji (from the picker or a text search pick). */
export async function setTagEmoji(id: string, emoji: string): Promise<Tag> {
  if (!emoji) throw new Error('An emoji is required.');
  return TagSchema.parse(await tagsProvider.update(id, { emoji }));
}

/**
 * Delete a tag and strip its id from every instrument's associations, so an association
 * can never dangle. Returns the updated instrument-meta map (already persisted).
 */
export async function deleteTag(id: string): Promise<InstrumentMetaMap> {
  // Tolerate an absent id (a double-click / already-deleted tag): the provider throws
  // "Item not found" on a missing id, and the delete is idempotent, so swallow it.
  await tagsProvider.delete(id).catch(() => {});
  const map = stripTagIdEverywhere(await readInstrumentMeta(), id);
  await writeInstrumentMeta(map);
  return map;
}

// --- Instrument metadata (blob) ---------------------------------------------------

/** Read the per-instrument metadata map (empty + healed if absent/corrupt). */
export async function readInstrumentMeta(): Promise<InstrumentMetaMap> {
  if (!hasLocalStorage()) return { ...memoryMeta };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return {};
    return healInstrumentMetaMap(JSON.parse(raw));
  } catch {
    return {}; // unparseable JSON degrades to empty rather than throwing on every read
  }
}

/**
 * Validate a parsed metadata blob RECORD-BY-RECORD, keeping the valid instruments and
 * dropping only the malformed ones — so one bad (hand-edited or foreign-schema) record
 * can never discard every star + tag association (a whole-map `.parse` would throw and
 * lose them all). Pure, so it is unit-tested directly.
 */
export function healInstrumentMetaMap(raw: unknown): InstrumentMetaMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: InstrumentMetaMap = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = InstrumentMetaSchema.safeParse(value);
    if (parsed.success) out[name] = parsed.data;
  }
  return out;
}

/** Persist the per-instrument metadata map. */
export async function writeInstrumentMeta(map: InstrumentMetaMap): Promise<void> {
  const validated = InstrumentMetaMapSchema.parse(map);
  if (!hasLocalStorage()) {
    memoryMeta = { ...validated };
    return;
  }
  try {
    localStorage.setItem(META_KEY, JSON.stringify(validated));
  } catch {
    /* storage full / disabled — metadata is best-effort */
  }
}

/** In-memory fallback for the meta blob (Node runtime / disabled storage). */
let memoryMeta: InstrumentMetaMap = {};

// --- Pure map helpers (unit-tested directly) --------------------------------------

/** The metadata for one instrument, or the empty default (never undefined). */
export function metaFor(map: InstrumentMetaMap, name: string): InstrumentMeta {
  return map[name] ?? EMPTY_INSTRUMENT_META;
}

/** A copy of `map` with `name`'s starred flag set. Prunes a now-empty record so the
 *  blob stays sparse (a default-everything instrument keeps no entry). */
export function withStarred(map: InstrumentMetaMap, name: string, starred: boolean): InstrumentMetaMap {
  return pruneEmpty({ ...map, [name]: { ...metaFor(map, name), starred } });
}

/** A copy of `map` with `name`'s custom-tag id list replaced (de-duped, order kept). */
export function withTagIds(map: InstrumentMetaMap, name: string, tagIds: string[]): InstrumentMetaMap {
  const deduped = [...new Set(tagIds)];
  return pruneEmpty({ ...map, [name]: { ...metaFor(map, name), tagIds: deduped } });
}

/** A copy of `map` with `tagId` removed from every instrument's associations. */
export function stripTagIdEverywhere(map: InstrumentMetaMap, tagId: string): InstrumentMetaMap {
  const out: InstrumentMetaMap = {};
  for (const [name, meta] of Object.entries(map)) {
    out[name] = { ...meta, tagIds: meta.tagIds.filter((t) => t !== tagId) };
  }
  return pruneEmpty(out);
}

/** Instrument names currently associated with `tagId` (for the delete-in-use guard). */
export function instrumentsUsingTag(map: InstrumentMetaMap, tagId: string): string[] {
  return Object.entries(map)
    .filter(([, meta]) => meta.tagIds.includes(tagId))
    .map(([name]) => name);
}

/** Drop records that carry no information (not starred, no tags), keeping the blob small. */
function pruneEmpty(map: InstrumentMetaMap): InstrumentMetaMap {
  const out: InstrumentMetaMap = {};
  for (const [name, meta] of Object.entries(map)) {
    if (meta.starred || meta.tagIds.length > 0) out[name] = meta;
  }
  return out;
}

/** Test-only: reset the in-memory meta fallback between cases. */
export function __resetMemoryMeta(): void {
  memoryMeta = {};
}
