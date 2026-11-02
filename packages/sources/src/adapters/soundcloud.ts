/**
 * SoundCloud: its official widget, by link (`embed_only`). Its search needs an authorised server,
 * so this adapter has none. The widget's script loads on open.
 */
import { openEmbedded } from '../embed';
import { SOUNDCLOUD_TRANSPORT } from '../provider_transports';
import { SourceError, type SourceAdapter, type SourceInput } from '../types';

export const SOUNDCLOUD_ID = 'soundcloud';

export { SOUNDCLOUD_TRANSPORT } from '../provider_transports';

const LINK = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[^/?#]+\/[^/?#]+/i;

/** A track or set page without its query (the widget takes the page address). */
export function soundcloudPage(input: string): string | null {
  const m = LINK.exec(input.trim());
  return m ? m[0].replace(/^https?:\/\/(?:www\.|m\.)?/i, 'https://') : null;
}

export function createSoundCloudAdapter(): SourceAdapter {
  return {
    id: SOUNDCLOUD_ID,
    label: 'SoundCloud',
    rights: 'embed_only',
    capabilities: { search: false, links: true, transport: SOUNDCLOUD_TRANSPORT },
    matches: (input: SourceInput) => typeof input === 'string' && LINK.test(input.trim()),
    async resolve(input, ro = {}) {
      const page = typeof input === 'string' ? soundcloudPage(input) : null;
      if (!page) throw new SourceError('unsupported', 'not a SoundCloud track link', SOUNDCLOUD_ID);
      const [, user, track] = new URL(page).pathname.split('/');
      return {
        source: SOUNDCLOUD_ID,
        id: page,
        title: ro.hit?.title ?? decodeURIComponent(track).replace(/-/g, ' '),
        artist: ro.hit?.artist ?? decodeURIComponent(user),
        pageUrl: page,
        rights: 'embed_only',
        media: { kind: 'embed', embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(page)}&auto_play=false&visual=false` },
        embedTransport: SOUNDCLOUD_TRANSPORT,
      };
    },
    open: (item, host) => openEmbedded(item, host, async () => (await import('../embeds/soundcloud_player')).createSoundCloudPlayer),
  };
}
