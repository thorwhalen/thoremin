/**
 * The Audius adapter on its recorded search: hits, the stream address and the app name every
 * request carries, gated tracks left out, links resolved.
 */
import { describe, it, expect } from 'vitest';
import { createAudiusAdapter, AUDIUS_ID } from '@thoremin/sources/adapters/audius';
import { fakeFetch, json, recorded } from './helpers';

const search = recorded('audius_search_bach.json') as { data: Record<string, unknown>[] };

describe('Audius', () => {
  it('searches with the app name and maps each streamable track to a hit', async () => {
    const f = fakeFetch((u) => (u.pathname === '/v1/tracks/search' ? json(search) : undefined));
    const hits = await createAudiusAdapter({ fetch: f }).search!('bach', { limit: 5 });
    const asked = new URL(f.calls[0]);
    expect(asked.searchParams.get('query')).toBe('bach');
    expect(asked.searchParams.get('app_name')).toBe('thoremin');
    expect(asked.searchParams.get('limit')).toBe('5');
    expect(hits.length).toBe(search.data.length);
    expect(hits[0]).toMatchObject({ source: AUDIUS_ID, id: 'aWPkE', title: 'Emotional/Bach', artist: 'Jijikita', durationS: 222, pageUrl: 'https://audius.co/kitaurasyuji1/emotionalbach-276349', licence: { name: 'All rights reserved' } });
  });

  it('leaves out gated and unavailable tracks', async () => {
    const data = [{ ...search.data[0], is_stream_gated: true }, { ...search.data[1], is_available: false }, search.data[2]];
    const hits = await createAudiusAdapter({ fetch: fakeFetch(() => json({ data })) }).search!('bach');
    expect(hits.map((h) => h.id)).toEqual([search.data[2].id]);
  });

  it('resolves a track id or a page link to its stream, decodable on the device', async () => {
    const f = fakeFetch(
      (u) => (u.pathname === '/v1/tracks/aWPkE' ? json({ data: search.data[0] }) : undefined),
      (u) => (u.pathname === '/v1/resolve' && u.searchParams.get('url') === 'https://audius.co/kitaurasyuji1/emotionalbach-276349' ? json({ data: search.data[0] }) : undefined),
    );
    const a = createAudiusAdapter({ fetch: f });
    const byId = await a.resolve('aWPkE');
    expect(byId.rights).toBe('pcm_local');
    expect(byId.media).toEqual({ kind: 'url', url: 'https://api.audius.co/v1/tracks/aWPkE/stream?app_name=thoremin' });
    expect(a.matches!('https://audius.co/kitaurasyuji1/emotionalbach-276349')).toBe(true);
    expect(await a.resolve('https://audius.co/kitaurasyuji1/emotionalbach-276349')).toEqual(byId);
  });

  it('refuses to resolve a gated track', async () => {
    const a = createAudiusAdapter({ fetch: fakeFetch(() => json({ data: { ...search.data[0], is_stream_gated: true } })) });
    await expect(a.resolve('aWPkE')).rejects.toMatchObject({ reason: 'unsupported' });
  });
});
