/**
 * The embedded providers' adapters: links in every shape each provider uses, Deezer's keyless
 * search (JSONP, on its recorded answer), YouTube's search with the player's own key (on a response
 * built in the API's shape), and the core's rules for embeds: an embed opens only in a host that
 * shows players, and only as an embed.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createSourceRegistry,
  defaultAdapters,
  createYouTubeAdapter,
  createDeezerAdapter,
  createSpotifyAdapter,
  createAppleMusicAdapter,
  createPositionClock,
  youtubeVideoId,
  spotifyUri,
  NO_CONTROL,
  type MediaItem,
  type SourceHost,
} from '@thoremin/sources';
import { fakeFetch, json, recorded } from './helpers';

const sources = createSourceRegistry(defaultAdapters({ fetch: fakeFetch(), extra: [createSpotifyAdapter(), createAppleMusicAdapter()] }));

describe('links route to their provider, and every provider here is embed-only', () => {
  const cases: [string, string][] = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube'],
    ['https://soundcloud.com/an-artist/a-track?si=1', 'soundcloud'],
    ['https://www.deezer.com/fr/track/3135556', 'deezer'],
    ['https://suno.com/song/0f2f6b0e-1a2b-4c3d-8e9f-0123456789ab', 'suno'],
    ['<iframe src="https://bandcamp.com/EmbeddedPlayer/track=123456/size=large/"></iframe>', 'bandcamp'],
    ['https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'spotify'],
    ['spotify:track:4uLU6hMCjMI75M1A2tKUQC', 'spotify'],
    ['https://music.apple.com/us/album/an-album/1440857781?i=1440857786', 'apple-music'],
    ['https://example.com/song.mp3', 'url'],
  ];
  for (const [link, source] of cases) {
    it(`${source}: ${link.slice(0, 60)}`, async () => {
      expect(sources.match(link)?.id).toBe(source);
      const item = await sources.resolveInput(link);
      expect(item.source).toBe(source);
      if (source !== 'url') {
        expect(item.rights).toBe('embed_only');
        expect(item.media.kind).toBe('embed');
      }
    });
  }

  it('reads video ids and Spotify URIs, and refuses what they are not', () => {
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?start=3')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/watch?list=PL1')).toBeNull();
    expect(youtubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(spotifyUri('https://open.spotify.com/intl-fr/album/1DFixLWuPkv3KT3TnV35m3')).toBe('spotify:album:1DFixLWuPkv3KT3TnV35m3');
  });

  it("refuses a Bandcamp page address, saying what to paste instead", async () => {
    await expect(sources.resolveInput('https://an-artist.bandcamp.com/track/a-song')).rejects.toThrow(/Share, then Embed/);
  });

  it('the plain embeds say they have no remote control', async () => {
    for (const link of ['https://www.deezer.com/track/3135556', 'https://suno.com/song/0f2f6b0e-1a2b-4c3d-8e9f-0123456789ab']) {
      expect((await sources.resolveInput(link)).embedTransport).toEqual(NO_CONTROL);
    }
  });
});

describe('search', () => {
  it('Deezer: keyless, by JSONP, on its recorded answer', async () => {
    const jsonp = vi.fn(async () => recorded('deezer_search_bach.json'));
    const hits = await createDeezerAdapter({ jsonp }).search!('bach', { limit: 5 });
    const url = new URL((jsonp.mock.calls[0] as unknown as [string])[0]);
    expect(url.hostname).toBe('api.deezer.com');
    expect(url.searchParams.get('output')).toBe('jsonp');
    expect(hits).toHaveLength(5);
    expect(hits[0]).toMatchObject({ source: 'deezer', id: '2223211057', title: 'Bach (Mandragora & Devochka Remix)', artist: '4i20', durationS: 339 });
    // The hit's metadata carries into the item (the widget has none of its own to give).
    const item = await createSourceRegistry([createDeezerAdapter({ jsonp })]).resolveHit(hits[0]);
    expect(item).toMatchObject({ title: hits[0].title, media: { kind: 'embed', embedUrl: 'https://widget.deezer.com/widget/auto/track/2223211057' } });
  });

  it('YouTube: with the player\'s own key, embeddable videos only, titles unescaped', async () => {
    const f = fakeFetch((u) => (u.hostname === 'www.googleapis.com' ? json(recorded('youtube_search_constructed.json')) : undefined));
    const hits = await createYouTubeAdapter({ fetch: f, getKey: () => 'my-key' }).search!('bach');
    const asked = new URL(f.calls[0]);
    expect(Object.fromEntries(asked.searchParams)).toMatchObject({ key: 'my-key', type: 'video', videoEmbeddable: 'true', q: 'bach' });
    expect(hits.map((h) => h.id)).toEqual(['AAAAAAAAAAA', 'BBBBBBBBBBB']);
    expect(hits[0]).toMatchObject({ title: 'Bach & friends: Air on the G String', artist: "A channel 's name" });
  });

  it('YouTube: with no key, says so instead of asking', async () => {
    const f = fakeFetch();
    await expect(createYouTubeAdapter({ fetch: f, getKey: () => null }).search!('bach')).rejects.toMatchObject({ reason: 'needs-key' });
    expect(f.calls).toEqual([]);
    expect(createYouTubeAdapter().keySetting?.provider).toBe('youtube');
  });
});

describe('the core opens embeds only as embeds, only where players are shown', () => {
  it('refuses an embed in a host without a player mount, and embed-only media that is not an embed', async () => {
    const item = await sources.resolveInput('https://youtu.be/dQw4w9WgXcQ');
    const ownedOnly: SourceHost = { openOwned: vi.fn() };
    await expect(sources.open(item, ownedOnly)).rejects.toThrow(/cannot show/);
    const smuggled: MediaItem = { ...item, media: { kind: 'url', url: 'https://example.com/x.mp3' } };
    await expect(sources.open(smuggled, ownedOnly)).rejects.toMatchObject({ reason: 'rights' });
    expect(ownedOnly.openOwned).not.toHaveBeenCalled();
  });

  it('loads the provider\'s player module only on open, and hands the host its factory', async () => {
    const item = await sources.resolveInput('https://youtu.be/dQw4w9WgXcQ');
    let factory: unknown = null;
    const openEmbed = async (i: MediaItem, f: unknown) => {
      factory = f;
      return { item: i } as never;
    };
    await sources.open(item, { openOwned: vi.fn(), openEmbed });
    expect((factory as { name: string }).name).toBe('createYouTubePlayer');
  });
});

describe('the position clock', () => {
  it('extrapolates between reports at the applied rate, ignores a repeated report, and measures the gap', () => {
    let t = 0;
    const c = createPositionClock(() => t);
    c.setPlaying(true);
    for (let k = 1; k <= 6; k++) {
      t = k * 0.25;
      c.report(k * 0.25);
      t += 0.1;
      expect(c.read()).toBeCloseTo(k * 0.25 + 0.1, 9);
      c.report(k * 0.25); // the same cached value read again: no news
      expect(c.read()).toBeCloseTo(k * 0.25 + 0.1, 9);
    }
    expect(c.reportGapS()).toBeCloseTo(0.25, 9);
    c.setRate(2);
    t += 0.1;
    expect(c.read()).toBeCloseTo(1.5 + 0.1 + 0.1 * 2, 9);
    c.setPlaying(false);
    const held = c.read();
    t += 1;
    expect(c.read()).toBe(held);
  });
});
