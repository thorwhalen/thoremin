/**
 * Spotify: its official embed, by link (`embed_only`), driven through its iFrame API (play, pause,
 * seek in whole seconds, position from its playback updates; no tempo, no volume). Not among the
 * default adapters: a build adds it (`contributeSourceAdapters`).
 */
import { openEmbedded } from '../embed';
import { SPOTIFY_TRANSPORT } from '../provider_transports';
import { SourceError, type SourceAdapter, type SourceInput } from '../types';

export const SPOTIFY_ID = 'spotify';

export { SPOTIFY_TRANSPORT } from '../provider_transports';

const LINK = /^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|album|playlist|episode)[/:]([A-Za-z0-9]{22})/i;

/** `spotify:track:<id>` from a link or a Spotify URI; null when it is neither. */
export function spotifyUri(input: string): string | null {
  const m = LINK.exec(input.trim());
  return m ? `spotify:${m[1].toLowerCase()}:${m[2]}` : null;
}

export function createSpotifyAdapter(): SourceAdapter {
  return {
    id: SPOTIFY_ID,
    label: 'Spotify',
    rights: 'embed_only',
    capabilities: { search: false, links: true, transport: SPOTIFY_TRANSPORT },
    matches: (input: SourceInput) => typeof input === 'string' && LINK.test(input.trim()),
    async resolve(input, ro = {}) {
      const uri = typeof input === 'string' ? spotifyUri(input) : null;
      if (!uri) throw new SourceError('unsupported', 'not a Spotify link', SPOTIFY_ID);
      const [, kind, id] = uri.split(':');
      return {
        source: SPOTIFY_ID,
        id: uri,
        title: ro.hit?.title ?? `Spotify ${kind}`,
        pageUrl: `https://open.spotify.com/${kind}/${id}`,
        rights: 'embed_only',
        media: { kind: 'embed', embedUrl: `https://open.spotify.com/embed/${kind}/${id}` },
        embedTransport: SPOTIFY_TRANSPORT,
      };
    },
    open: (item, host) => openEmbedded(item, host, async () => (await import('../embeds/spotify_player')).createSpotifyPlayer),
  };
}
