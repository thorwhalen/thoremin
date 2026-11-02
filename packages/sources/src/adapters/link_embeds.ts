/**
 * Providers whose players are embedded by link only, with no remote control and no search
 * (`embed_only`): Suno (its share link names the song) and Bandcamp (its Share, Embed address names
 * the track; a page address does not, so it is refused with what to paste instead).
 */
import { NO_CONTROL, openEmbedded } from '../embed';
import { SourceError, type SourceAdapter, type SourceInput } from '../types';

export const SUNO_ID = 'suno';
export const BANDCAMP_ID = 'bandcamp';

const SUNO = /^https?:\/\/(?:www\.|app\.)?suno\.com\/(?:song|embed)\/([0-9a-f-]{36})/i;
const BANDCAMP_EMBED = /https?:\/\/bandcamp\.com\/EmbeddedPlayer\/[^"'\s>]+/i;
const BANDCAMP_PAGE = /^https?:\/\/[a-z0-9-]+\.bandcamp\.com\//i;

const iframe = async () => (await import('../embeds/iframe_player')).createIframePlayer;

export function createSunoAdapter(): SourceAdapter {
  return {
    id: SUNO_ID,
    label: 'Suno',
    rights: 'embed_only',
    capabilities: { search: false, links: true, transport: NO_CONTROL },
    matches: (input: SourceInput) => typeof input === 'string' && SUNO.test(input.trim()),
    async resolve(input, ro = {}) {
      const id = typeof input === 'string' ? SUNO.exec(input.trim())?.[1] : undefined;
      if (!id) throw new SourceError('unsupported', 'not a Suno song link (open the song and copy its address)', SUNO_ID);
      return {
        source: SUNO_ID,
        id,
        title: ro.hit?.title ?? 'Suno song',
        pageUrl: `https://suno.com/song/${id}`,
        rights: 'embed_only',
        media: { kind: 'embed', embedUrl: `https://suno.com/embed/${id}` },
        embedTransport: NO_CONTROL,
      };
    },
    open: (item, host) => openEmbedded(item, host, iframe),
  };
}

export function createBandcampAdapter(): SourceAdapter {
  return {
    id: BANDCAMP_ID,
    label: 'Bandcamp',
    rights: 'embed_only',
    capabilities: { search: false, links: true, transport: NO_CONTROL },
    // A pasted embed address or the whole embed code, or a page (refused with what to paste instead).
    matches: (input: SourceInput) => typeof input === 'string' && (BANDCAMP_EMBED.test(input) || BANDCAMP_PAGE.test(input.trim())),
    async resolve(input, ro = {}) {
      const embed = typeof input === 'string' ? BANDCAMP_EMBED.exec(input)?.[0] : undefined;
      if (!embed) throw new SourceError('unsupported', "Bandcamp's page address does not name the track: on Bandcamp choose Share, then Embed, and paste that code", BANDCAMP_ID);
      const id = /track=(\d+)/.exec(embed)?.[1] ?? /album=(\d+)/.exec(embed)?.[1] ?? embed;
      return {
        source: BANDCAMP_ID,
        id,
        title: ro.hit?.title ?? 'Bandcamp track',
        pageUrl: embed,
        rights: 'embed_only',
        media: { kind: 'embed', embedUrl: embed },
        embedTransport: NO_CONTROL,
      };
    },
    open: (item, host) => openEmbedded(item, host, iframe),
  };
}
