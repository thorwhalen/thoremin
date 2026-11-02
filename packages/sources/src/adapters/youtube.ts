/**
 * YouTube: the official IFrame player, shown as YouTube shows it (`embed_only`: never decoded or
 * analysed). Links in every shape YouTube uses; search through the Data API with the player's own
 * key (`getKey`), which stays on the device. The player's script loads on open.
 */
import { z } from 'zod';
import { openEmbedded } from '../embed';
import { YOUTUBE_TRANSPORT } from '../provider_transports';
import { SourceError, type MediaItem, type SearchHit, type SourceAdapter, type SourceInput } from '../types';
import { getJson } from './http';

export const YOUTUBE_ID = 'youtube';

export { YOUTUBE_RATES, YOUTUBE_TRANSPORT } from '../provider_transports';

/** The key YouTube search needs: the player's own, kept on the device. */
export const YOUTUBE_KEY_SETTING = {
  provider: 'youtube',
  label: 'YouTube search key',
  help: 'Your own YouTube Data API v3 key: it lets the search box look through YouTube (about a hundred searches a day). It stays in this browser and goes only to YouTube.',
  url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
} as const;

export interface YouTubeOptions {
  fetch?: typeof fetch;
  /** The player's Data API key, or null when none is set (search then says so). */
  getKey?: () => string | null;
  /** Hits per search when the caller names no limit. */
  limit?: number;
}

const ID = /^[A-Za-z0-9_-]{11}$/;

/** The video id in a YouTube link (watch, youtu.be, shorts, embed, live, music), or a bare id. */
export function youtubeVideoId(input: string): string | null {
  const s = input.trim();
  if (ID.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return ID.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const v = u.searchParams.get('v');
  if (v && ID.test(v)) return v;
  const m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
  return m ? m[1] : null;
}

/** The Data API's titles come HTML-escaped. */
export function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[e] ?? _);
}

const SearchSchema = z.object({
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string().optional() }).passthrough(),
      snippet: z.object({ title: z.string(), channelTitle: z.string().optional(), thumbnails: z.record(z.string(), z.object({ url: z.string() }).passthrough()).optional() }).passthrough(),
    }).passthrough(),
  ),
});

export function createYouTubeAdapter(opts: YouTubeOptions = {}): SourceAdapter {
  const label = 'YouTube';
  const itemOf = (id: string, hit?: SearchHit): MediaItem => ({
    source: YOUTUBE_ID,
    id,
    title: hit?.title ?? `YouTube video ${id}`,
    artist: hit?.artist,
    artworkUrl: hit?.artworkUrl ?? `https://i.ytimg.com/vi/${id}/default.jpg`,
    pageUrl: `https://www.youtube.com/watch?v=${id}`,
    rights: 'embed_only',
    media: { kind: 'embed', embedUrl: `https://www.youtube.com/embed/${id}` },
    embedTransport: YOUTUBE_TRANSPORT,
  });
  return {
    id: YOUTUBE_ID,
    label,
    rights: 'embed_only',
    capabilities: { search: true, links: true, transport: YOUTUBE_TRANSPORT },
    keySetting: YOUTUBE_KEY_SETTING,
    matches: (input: SourceInput) => typeof input === 'string' && /^https?:/i.test(input.trim()) && youtubeVideoId(input) !== null,
    async search(query, so = {}) {
      const key = opts.getKey?.() ?? null;
      if (!key) throw new SourceError('needs-key', `Searching YouTube needs your own key (${YOUTUBE_KEY_SETTING.label})`, YOUTUBE_ID);
      const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(so.limit ?? opts.limit ?? 12), q: query, key });
      const body = await getJson({ id: YOUTUBE_ID, label }, `https://www.googleapis.com/youtube/v3/search?${params}`, SearchSchema, { fetch: opts.fetch, signal: so.signal });
      return body.items
        .filter((i) => i.id.videoId)
        .map((i) => ({
          source: YOUTUBE_ID,
          id: i.id.videoId!,
          title: unescapeHtml(i.snippet.title),
          artist: i.snippet.channelTitle ? unescapeHtml(i.snippet.channelTitle) : undefined,
          artworkUrl: i.snippet.thumbnails?.default?.url,
          pageUrl: `https://www.youtube.com/watch?v=${i.id.videoId}`,
        }));
    },
    async resolve(input, ro = {}) {
      const id = typeof input === 'string' ? youtubeVideoId(input) : null;
      if (!id) throw new SourceError('unsupported', `not a ${label} link`, YOUTUBE_ID);
      return itemOf(id, ro.hit);
    },
    open: (item, host) => openEmbedded(item, host, async () => (await import('../embeds/youtube_player')).createYouTubePlayer),
  };
}
