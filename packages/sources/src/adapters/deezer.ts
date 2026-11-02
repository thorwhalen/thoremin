/**
 * Deezer: its widget, by link or from its keyless catalogue search (`embed_only`). The catalogue
 * answers JSONP only. The widget has no remote control: it plays from its own buttons.
 */
import { z } from 'zod';
import { NO_CONTROL, openEmbedded } from '../embed';
import { browserJsonp, type Jsonp } from '../jsonp';
import { SourceError, type MediaItem, type SearchHit, type SourceAdapter, type SourceInput } from '../types';

export const DEEZER_ID = 'deezer';

const LINK = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i;

const SearchSchema = z.object({
  data: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      duration: z.number().optional(),
      link: z.string().optional(),
      readable: z.boolean().optional(),
      artist: z.object({ name: z.string() }).passthrough().optional(),
      album: z.object({ cover_small: z.string().optional() }).passthrough().optional(),
    }).passthrough(),
  ),
});

export function createDeezerAdapter(opts: { jsonp?: Jsonp; limit?: number } = {}): SourceAdapter {
  const label = 'Deezer';
  const itemOf = (id: string, hit?: SearchHit): MediaItem => ({
    source: DEEZER_ID,
    id,
    title: hit?.title ?? `Deezer track ${id}`,
    artist: hit?.artist,
    durationS: hit?.durationS,
    artworkUrl: hit?.artworkUrl,
    pageUrl: `https://www.deezer.com/track/${id}`,
    rights: 'embed_only',
    media: { kind: 'embed', embedUrl: `https://widget.deezer.com/widget/auto/track/${id}` },
    embedTransport: NO_CONTROL,
  });
  return {
    id: DEEZER_ID,
    label,
    rights: 'embed_only',
    capabilities: { search: true, links: true, transport: NO_CONTROL },
    matches: (input: SourceInput) => typeof input === 'string' && LINK.test(input.trim()),
    async search(query, so = {}) {
      let body: unknown;
      try {
        body = await (opts.jsonp ?? browserJsonp)(`https://api.deezer.com/search?${new URLSearchParams({ q: query, limit: String(so.limit ?? opts.limit ?? 12), output: 'jsonp' })}`, { signal: so.signal });
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        throw new SourceError('network', `${label} could not be reached`, DEEZER_ID);
      }
      const parsed = SearchSchema.safeParse(body);
      if (!parsed.success) throw new SourceError('bad-response', `${label} answered in a shape this version does not read`, DEEZER_ID);
      return parsed.data.data
        .filter((t) => t.readable !== false)
        .map((t) => ({
          source: DEEZER_ID,
          id: String(t.id),
          title: t.title,
          artist: t.artist?.name,
          durationS: t.duration,
          artworkUrl: t.album?.cover_small,
          pageUrl: t.link ?? `https://www.deezer.com/track/${t.id}`,
        }));
    },
    async resolve(input, ro = {}) {
      const s = typeof input === 'string' ? input.trim() : '';
      const id = /^\d+$/.test(s) ? s : LINK.exec(s)?.[1];
      if (!id) throw new SourceError('unsupported', `not a ${label} track link`, DEEZER_ID);
      return itemOf(id, ro.hit);
    },
    open: (item, host) => openEmbedded(item, host, async () => (await import('../embeds/iframe_player')).createIframePlayer),
  };
}
