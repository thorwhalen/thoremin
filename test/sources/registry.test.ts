/**
 * The registry: links routed to the adapter that recognises them (the web address last), search
 * fanned out with partial failures kept, unknown sources refused, and the rights checked on the one
 * path every item takes.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createSourceRegistry,
  defaultAdapters,
  allows,
  within,
  assertAllows,
  fetchOwnedBytes,
  licenceFromUrl,
  RIGHTS,
  RIGHTS_PROFILES,
  type MediaItem,
  type PlaybackSession,
  type SourceAdapter,
  type SourceHost,
} from '@thoremin/sources';
import { fakeFetch, json, recorded } from './helpers';

const IA_LINK = 'https://archive.org/details/The_Open_Goldberg_Variations-11823';
const routes = fakeFetch(
  (u) => (u.hostname === 'archive.org' && u.pathname === '/advancedsearch.php' ? json(recorded('ia_search_bach.json')) : undefined),
  (u) => (u.hostname === 'archive.org' && u.pathname.startsWith('/metadata/') ? json(recorded('ia_metadata_open_goldberg.json')) : undefined),
  (u) => (u.hostname === 'api.audius.co' && u.pathname === '/v1/tracks/search' ? json(recorded('audius_search_bach.json')) : undefined),
);

const fakeSession = (item: MediaItem): PlaybackSession => ({
  item,
  capabilities: { seek: false, rate: null, volume: false, pauseLead: null, seekGranularity: null, positionLag: null },
  play() {},
  pause() {},
  position: () => 0,
  playing: () => false,
  on: () => () => {},
  close() {},
});

describe('links', () => {
  const sources = createSourceRegistry(defaultAdapters({ fetch: routes }));
  it('routes each link to its adapter, the web address last, and a file to the file adapter', () => {
    expect(sources.match(IA_LINK)?.id).toBe('internet-archive');
    expect(sources.match('https://audius.co/someone/a-track')?.id).toBe('audius');
    expect(sources.match('https://example.com/song.mp3')?.id).toBe('url');
    expect(sources.match(new Blob([]))?.id).toBe('file');
    expect(sources.match('bach')).toBeNull();
  });

  it('resolves a pasted link, and says so when nothing recognises it', async () => {
    expect((await sources.resolveInput(IA_LINK)).source).toBe('internet-archive');
    await expect(sources.resolveInput('just words')).rejects.toMatchObject({ reason: 'unsupported', message: 'No source recognises this link' });
  });

  it('names a web address after its file, and a file after its name', async () => {
    expect((await sources.resolveInput('https://example.com/a/My%20Song.mp3?x=1')).title).toBe('My Song');
    const file = Object.assign(new Blob([new Uint8Array(4)]), { name: 'take.wav' });
    const item = await sources.resolveInput(file);
    expect(item).toMatchObject({ source: 'file', title: 'take.wav', rights: 'pcm_local', media: { kind: 'blob', blob: file } });
  });
});

describe('search', () => {
  it('asks every searchable source and returns their hits in order', async () => {
    const sources = createSourceRegistry(defaultAdapters({ fetch: routes }));
    expect(sources.searchable().map((a) => a.id)).toEqual(['internet-archive', 'audius']);
    const { hits, failures } = await sources.search('bach');
    expect(failures).toEqual([]);
    expect(hits.filter((h) => h.source === 'internet-archive')).toHaveLength(12);
    expect(hits.filter((h) => h.source === 'audius').length).toBeGreaterThan(0);
    expect(hits[0].source).toBe('internet-archive');
  });

  it('keeps one source\'s hits when another fails', async () => {
    const half = fakeFetch((u) => (u.hostname === 'archive.org' ? json(recorded('ia_search_bach.json')) : new Response('down', { status: 503 })));
    const { hits, failures } = await createSourceRegistry(defaultAdapters({ fetch: half })).search('bach');
    expect(hits).toHaveLength(12);
    expect(failures.map((f) => f.source)).toEqual(['audius']);
    expect(failures[0].error.message).toBe('Audius answered HTTP 503');
  });

  it('does not search for nothing, and refuses an unknown source', async () => {
    const sources = createSourceRegistry(defaultAdapters({ fetch: routes }));
    expect(await sources.search('   ')).toEqual({ hits: [], failures: [] });
    expect(routes.calls.filter((c) => c.includes('search?') && c.includes('query=+'))).toEqual([]);
    expect(() => sources.get('spotfy')).toThrow(/no source 'spotfy'/);
    await expect(sources.search('bach', { sources: ['spotfy'] })).rejects.toThrow(/no source 'spotfy'/);
  });
});

describe('adapters are checked when registered', () => {
  const base = defaultAdapters()[3];
  it('refuses a duplicate id and capabilities that disagree with the functions', () => {
    expect(() => createSourceRegistry([base, base])).toThrow(/share the id/);
    expect(() => createSourceRegistry([{ ...base, capabilities: { ...base.capabilities, search: true } }])).toThrow(/declares search=true/);
    expect(() => createSourceRegistry([{ ...base, matches: undefined }])).toThrow(/declares links=true/);
  });
});

describe('rights', () => {
  it('state which uses each profile allows', () => {
    expect(RIGHTS.filter((r) => allows(r, 'decode'))).toEqual(['pcm_local', 'pcm_redistributable']);
    expect(RIGHTS.filter((r) => allows(r, 'analyse'))).toEqual(['pcm_local', 'pcm_redistributable', 'symbolic']);
    expect(RIGHTS.filter((r) => allows(r, 'cache'))).toEqual(['pcm_redistributable', 'symbolic']);
    expect(RIGHTS_PROFILES.embed_only).toEqual({ decode: false, analyse: false, cache: false });
    expect(allows(undefined, 'analyse')).toBe(false);
    expect(allows('nonsense' as never, 'analyse')).toBe(false);
  });

  it('let an item narrow its source\'s rights, never widen them', () => {
    expect(within('embed_only', 'pcm_local')).toBe(true);
    expect(within('pcm_local', 'pcm_redistributable')).toBe(true);
    expect(within('pcm_redistributable', 'pcm_local')).toBe(false);
    expect(within('pcm_local', 'embed_only')).toBe(false);
  });

  it('are checked on open: an item claiming more than its source is refused before the adapter runs', async () => {
    const open = vi.fn(async (item: MediaItem) => fakeSession(item));
    const adapter: SourceAdapter = { ...defaultAdapters()[3], open };
    const sources = createSourceRegistry([adapter]);
    const item: MediaItem = { source: 'url', id: 'x', title: 'X', rights: 'pcm_redistributable', media: { kind: 'url', url: 'https://example.com/x.mp3' } };
    await expect(sources.open(item, {} as SourceHost)).rejects.toMatchObject({ reason: 'rights' });
    expect(open).not.toHaveBeenCalled();
    await expect(sources.open({ ...item, source: 'audius' }, {} as SourceHost)).rejects.toMatchObject({ reason: 'unknown-source' });
  });

  it('are checked before any byte is fetched: embed-only media is never decoded', async () => {
    const f = fakeFetch(() => new Response(new Uint8Array(4)));
    const item: MediaItem = { source: 'url', id: 'x', title: 'X', rights: 'embed_only', media: { kind: 'url', url: 'https://example.com/x.mp3' } };
    await expect(fetchOwnedBytes(item, { fetch: f })).rejects.toMatchObject({ reason: 'rights', message: 'X may not be decoded (its source allows embed_only only)' });
    expect(f.calls).toEqual([]);
    expect(() => assertAllows(item, 'analyse')).toThrow(/may not be analysed/);
  });

  it('refuse a session for another item', async () => {
    const other: MediaItem = { source: 'url', id: 'y', title: 'Y', rights: 'pcm_local', media: { kind: 'url', url: 'https://example.com/y.mp3' } };
    const sources = createSourceRegistry([{ ...defaultAdapters()[3], open: async () => fakeSession(other) }]);
    await expect(sources.open({ ...other, id: 'x' }, {} as SourceHost)).rejects.toMatchObject({ reason: 'bad-response' });
  });
});

describe('owned audio', () => {
  it('hands the fetched bytes to the host, and says why a fetch failed', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const f = fakeFetch((u) => (u.pathname === '/ok.mp3' ? new Response(bytes) : undefined), (u) => (u.pathname === '/blocked.mp3' ? (() => { throw new TypeError('Failed to fetch'); })() : undefined));
    const sources = createSourceRegistry(defaultAdapters({ fetch: f }));
    const openOwned = vi.fn(async (item: MediaItem, _bytes: Blob) => fakeSession(item));
    const item = await sources.resolveInput('https://example.com/ok.mp3');
    const session = await sources.open(item, { openOwned });
    expect(session.item).toBe(item);
    const blob = openOwned.mock.calls[0][1] as Blob;
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    await expect(sources.open(await sources.resolveInput('https://example.com/missing.mp3'), { openOwned })).rejects.toMatchObject({ reason: 'not-found' });
    await expect(sources.open(await sources.resolveInput('https://example.com/blocked.mp3'), { openOwned })).rejects.toMatchObject({ reason: 'cors' });
  });
});

describe('licences in words', () => {
  it('names Creative Commons and public-domain marks, and never guesses', () => {
    expect(licenceFromUrl('http://creativecommons.org/licenses/by-nc-nd/2.5/').name).toBe('CC BY-NC-ND 2.5');
    expect(licenceFromUrl('https://creativecommons.org/publicdomain/mark/1.0/').name).toBe('Public Domain Mark 1.0');
    expect(licenceFromUrl('http://creativecommons.org/publicdomain/zero/1.0/').name).toBe('CC0 1.0');
    expect(licenceFromUrl('http://creativecommons.org/licenses/publicdomain/').name).toBe('Public domain');
    expect(licenceFromUrl(undefined)).toEqual({ name: 'not stated' });
    expect(licenceFromUrl('https://example.com/terms')).toEqual({ name: 'https://example.com/terms', url: 'https://example.com/terms' });
  });
});
