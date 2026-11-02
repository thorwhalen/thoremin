/**
 * Apple Music: its official embed, by link (`embed_only`), with no remote control (full tracks for a
 * signed-in subscriber, previews otherwise). Not among the default adapters: a build adds it.
 */
import { NO_CONTROL, openEmbedded } from '../embed';
import { SourceError, type SourceAdapter, type SourceInput } from '../types';

export const APPLE_MUSIC_ID = 'apple-music';

const LINK = /^https?:\/\/(?:embed\.)?music\.apple\.com\/([a-z]{2})\/(album|song|playlist|music-video)\/[^?#]+(\?[^#]*)?/i;

export function createAppleMusicAdapter(): SourceAdapter {
  return {
    id: APPLE_MUSIC_ID,
    label: 'Apple Music',
    rights: 'embed_only',
    capabilities: { search: false, links: true, transport: NO_CONTROL },
    matches: (input: SourceInput) => typeof input === 'string' && LINK.test(input.trim()),
    async resolve(input, ro = {}) {
      const m = typeof input === 'string' ? LINK.exec(input.trim()) : null;
      if (!m) throw new SourceError('unsupported', 'not an Apple Music link', APPLE_MUSIC_ID);
      const page = m[0].replace('://embed.music.', '://music.');
      const embed = m[0].replace(/:\/\/(?:embed\.)?music\./, '://embed.music.');
      return {
        source: APPLE_MUSIC_ID,
        id: page,
        title: ro.hit?.title ?? `Apple Music ${m[2]}`,
        pageUrl: page,
        rights: 'embed_only',
        media: { kind: 'embed', embedUrl: embed },
        embedTransport: NO_CONTROL,
      };
    },
    open: (item, host) => openEmbedded(item, host, async () => (await import('../embeds/iframe_player')).createIframePlayer),
  };
}
