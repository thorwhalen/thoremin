/**
 * The source registry: the adapters as data, and the one path every search, link and open takes.
 *
 * `open` is where the rights are enforced for every adapter: an item may not claim rights wider
 * than its adapter's, and the session it returns must be for that item. Owned audio is decoded only
 * through `fetchOwnedBytes`, which checks the item's rights again.
 */
import { within } from './rights';
import { SourceError, type MediaItem, type PlaybackSession, type SearchHit, type SourceAdapter, type SourceHost, type SourceInput } from './types';

export interface RegistrySearchOptions {
  /** Only these adapters (by id); every searchable adapter by default. */
  sources?: readonly string[];
  /** At most this many hits per adapter. */
  limit?: number;
  signal?: AbortSignal;
}

export interface SearchResult {
  /** Hits in adapter order. */
  hits: SearchHit[];
  /** The adapters that failed, so one provider down never hides the others' hits. */
  failures: { source: string; error: Error }[];
}

export interface SourceRegistry {
  list(): readonly SourceAdapter[];
  /** The adapter with this id; throws on an unknown id (never a fallback). */
  get(id: string): SourceAdapter;
  /** The searchable adapters. */
  searchable(): readonly SourceAdapter[];
  search(query: string, opts?: RegistrySearchOptions): Promise<SearchResult>;
  /** The first adapter (in registration order) that recognises `input`, or null. */
  match(input: SourceInput): SourceAdapter | null;
  /** Resolve a pasted link or a chosen file with the adapter that recognises it. */
  resolveInput(input: SourceInput, opts?: { signal?: AbortSignal }): Promise<MediaItem>;
  /** Resolve a search hit with its own adapter. */
  resolveHit(hit: SearchHit, opts?: { signal?: AbortSignal }): Promise<MediaItem>;
  /** Open an item as a session: the one path, where its rights are checked. */
  open(item: MediaItem, host: SourceHost): Promise<PlaybackSession>;
}

/** A registry over `adapters`, tried in this order for links (put catch-alls last). */
export function createSourceRegistry(adapters: readonly SourceAdapter[]): SourceRegistry {
  const byId = new Map<string, SourceAdapter>();
  for (const a of adapters) {
    if (byId.has(a.id)) throw new Error(`two source adapters share the id '${a.id}'`);
    if (a.capabilities.search !== (typeof a.search === 'function')) throw new Error(`source adapter '${a.id}' declares search=${a.capabilities.search} but ${a.search ? 'has' : 'lacks'} search()`);
    if (a.capabilities.links !== (typeof a.matches === 'function')) throw new Error(`source adapter '${a.id}' declares links=${a.capabilities.links} but ${a.matches ? 'has' : 'lacks'} matches()`);
    byId.set(a.id, a);
  }
  const get = (id: string): SourceAdapter => {
    const a = byId.get(id);
    if (!a) throw new SourceError('unknown-source', `no source '${id}' (known: ${[...byId.keys()].join(', ')})`, id);
    return a;
  };
  const checkItem = (a: SourceAdapter, item: MediaItem): MediaItem => {
    if (item.source !== a.id) throw new SourceError('bad-response', `source '${a.id}' resolved an item of '${item.source}'`, a.id);
    if (!within(item.rights, a.rights)) throw new SourceError('rights', `${item.title} claims ${item.rights}, wider than its source allows (${a.rights})`, a.id);
    return item;
  };
  const match = (input: SourceInput): SourceAdapter | null => adapters.find((a) => a.matches?.(input) === true) ?? null;
  return {
    list: () => adapters,
    get,
    searchable: () => adapters.filter((a) => a.capabilities.search),
    async search(query, opts = {}) {
      const q = query.trim();
      if (!q) return { hits: [], failures: [] };
      const chosen = (opts.sources ?? adapters.filter((a) => a.capabilities.search).map((a) => a.id)).map(get);
      const settled = await Promise.allSettled(chosen.map((a) => {
        if (!a.search) throw new SourceError('unsupported', `source '${a.id}' cannot search`, a.id);
        return a.search(q, { limit: opts.limit, signal: opts.signal });
      }));
      const hits: SearchHit[] = [];
      const failures: SearchResult['failures'] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') hits.push(...r.value.filter((h) => h.source === chosen[i].id));
        else failures.push({ source: chosen[i].id, error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)) });
      });
      return { hits, failures };
    },
    match,
    async resolveInput(input, opts) {
      const a = match(input);
      if (!a) throw new SourceError('unsupported', typeof input === 'string' ? 'No source recognises this link' : 'No source opens this file');
      return checkItem(a, await a.resolve(input, opts));
    },
    async resolveHit(hit, opts) {
      const a = get(hit.source);
      return checkItem(a, await a.resolve(hit.id, opts));
    },
    async open(item, host) {
      const a = get(item.source);
      checkItem(a, item);
      const session = await a.open(item, host);
      if (session.item !== item) throw new SourceError('bad-response', `source '${a.id}' opened a session for another item`, a.id);
      return session;
    },
  };
}
