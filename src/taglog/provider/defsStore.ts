/**
 * taglog — tag-set persistence via the zodal DataProvider contract (design §9.2a).
 *
 * A **tag set** is a named, ordered list of {@link TagDef}s plus its
 * {@link TaggingConfig} — the thing the user picks and reorders before recording,
 * and the thing pre-seeded "last-used" at mode setup. It is persisted the zodal way:
 * a Zod schema (SSOT) behind a `DataProvider<T>` whose default target is
 * localStorage (`@zodal/store-localstorage`). Swapping to files/cloud later is a
 * provider swap, never a call-site change.
 *
 * The provider is async (persistence, never the hot path); the live store hydrates
 * from it on mode open and debounces writes back. The helpers here (`loadLastUsed`,
 * `saveTagSet`) take a `DataProvider<TagSetDoc>` by injection, so they work over the
 * localStorage default or any other backend (and are unit-testable in isolation).
 */
import { z } from 'zod';
import type { DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { TagDefSchema, TaggingConfigSchema } from '../affordances/schema';

/** localStorage key the default tag-set collection lives under. */
export const TAGSETS_STORAGE_KEY = 'taglog.tagsets';

/** A persisted tag set: an ordered tag list + its config, named and timestamped so
 *  the most-recently-used one can be pre-seeded. */
export const TagSetDocSchema = z.object({
  /** Stable id (the collection key). */
  id: z.string().min(1),
  /** Human name ("hands drill", "session 3"…). */
  name: z.string().default('Tag set'),
  /** The ordered tag definitions. */
  tags: z.array(TagDefSchema).default([]),
  /** Session-level tagging config (exclusivity, codec, clock, offset). */
  config: TaggingConfigSchema.default(() => TaggingConfigSchema.parse({})),
  /** ms-epoch of the last save — the "last used" sort key (stamped by the host,
   *  never `Date.now()` inside pure code). */
  updatedAt: z.number().default(0),
});
export type TagSetDoc = z.infer<typeof TagSetDocSchema>;

/** Validate a raw persisted blob into a TagSetDoc, healing missing fields (never
 *  throws) — the same forward-compat discipline the recording schema uses. */
export function parseTagSet(raw: unknown): TagSetDoc {
  const parsed = TagSetDocSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : TagSetDocSchema.parse({ id: 'default' });
}

/** The default localStorage-backed tag-set provider (the zodal way). Swap this call
 *  for a different `createXProvider(...)` to retarget storage — nothing else changes. */
export function createTagSetProvider(storageKey: string = TAGSETS_STORAGE_KEY): DataProvider<TagSetDoc> {
  return createLocalStorageProvider<TagSetDoc>({ storageKey, idField: 'id', searchFields: ['name'] });
}

/** The most-recently-updated tag set (pre-seed at mode setup), or null if none saved. */
export async function loadLastUsed(provider: DataProvider<TagSetDoc>): Promise<TagSetDoc | null> {
  const { data } = await provider.getList({ sort: [{ id: 'updatedAt', desc: true }] });
  return data[0] ?? null;
}

/** Upsert a tag set (create if new by id, else update) and return the stored doc. */
export async function saveTagSet(provider: DataProvider<TagSetDoc>, doc: TagSetDoc): Promise<TagSetDoc> {
  if (provider.upsert) return provider.upsert(doc);
  try {
    await provider.getOne(doc.id);
    return await provider.update(doc.id, doc);
  } catch {
    return provider.create(doc);
  }
}
