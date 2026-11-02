/**
 * Caching a {@link MusicalContext} on the device, by the content it was made from: the contract
 * (`ContextCache`), the content key (a SHA-256 of the bytes or of a document's JSON), an
 * in-memory cache, and `produceCached`, which asks the cache before running a producer. The
 * persistent cache (IndexedDB) is the app's, behind this same contract.
 *
 * A cached entry made by another schema version is a miss, never an error.
 */
import { MUSICAL_CONTEXT_VERSION, MusicalContextSchema, type MusicalContext } from './schema';
import type { ContextProducer } from './producer';

export interface ContextCache {
  get(contentKey: string): Promise<MusicalContext | null>;
  set(contentKey: string, context: MusicalContext): Promise<void>;
}

/** The hex SHA-256 of some content (a file's bytes, or a document's JSON), prefixed by the
 *  algorithm. Uses the platform's Web Crypto (browsers, workers and Node 18+). */
export async function contentKey(content: Uint8Array | string): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A cache in memory: what a test or a host with no storage uses. */
export function memoryContextCache(): ContextCache {
  const entries = new Map<string, MusicalContext>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, ctx) => {
      entries.set(key, ctx);
    },
  };
}

/** A stored value read back as a context of this version, or null. */
export function readCachedContext(raw: unknown): MusicalContext | null {
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== MUSICAL_CONTEXT_VERSION) return null;
  const parsed = MusicalContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The cache entry of a producer's context of some content: the same content read by two
 *  producers (a score, an estimate) is two entries. */
export const cacheKeyOf = (producerId: string, key: string) => `${producerId}|${key}`;

/** The context for `input` (whose content key is `key`): the cache's when it holds one, else the
 *  producer's, stored. A cache that fails to read or write costs only the cache. */
export async function produceCached<I>(producer: ContextProducer<I>, input: I, key: string, cache: ContextCache): Promise<MusicalContext> {
  const entry = cacheKeyOf(producer.id, key);
  try {
    const hit = readCachedContext(await cache.get(entry));
    if (hit) return hit;
  } catch {
    // A failed read is a miss.
  }
  const ctx = await producer.produce(input, { contentKey: key });
  try {
    await cache.set(entry, ctx);
  } catch {
    // A failed write is the cache's loss only.
  }
  return ctx;
}
