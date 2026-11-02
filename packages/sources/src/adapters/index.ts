/**
 * The shipped adapters, in link order (the catch-all web address last).
 */
import type { SourceAdapter, TransportCapabilities } from '../types';
import { createLocalFileAdapter } from './local_file';
import { createInternetArchiveAdapter } from './internet_archive';
import { createAudiusAdapter } from './audius';
import { createCorsUrlAdapter } from './cors_url';
import { createYouTubeAdapter } from './youtube';
import { createSoundCloudAdapter } from './soundcloud';
import { createDeezerAdapter } from './deezer';
import { createBandcampAdapter, createSunoAdapter } from './link_embeds';
import type { Jsonp } from '../jsonp';

export { createLocalFileAdapter, LOCAL_FILE_ID } from './local_file';
export { createInternetArchiveAdapter, INTERNET_ARCHIVE_ID } from './internet_archive';
export { createAudiusAdapter, AUDIUS_ID } from './audius';
export { createCorsUrlAdapter, CORS_URL_ID } from './cors_url';
export { createYouTubeAdapter, YOUTUBE_ID, YOUTUBE_KEY_SETTING, youtubeVideoId } from './youtube';
export { createSoundCloudAdapter, SOUNDCLOUD_ID } from './soundcloud';
export { createDeezerAdapter, DEEZER_ID } from './deezer';
export { createSunoAdapter, createBandcampAdapter, SUNO_ID, BANDCAMP_ID } from './link_embeds';
export { createSpotifyAdapter, SPOTIFY_ID, spotifyUri } from './spotify';
export { createAppleMusicAdapter, APPLE_MUSIC_ID } from './apple_music';

export interface DefaultAdapterOptions {
  fetch?: typeof fetch;
  /** The owned-audio transport the app's song player offers. */
  transport?: TransportCapabilities;
  /** The player's YouTube Data API key, for YouTube search. */
  youtubeKey?: () => string | null;
  jsonp?: Jsonp;
  /** More adapters (a build's extras), tried for links before the catch-all web address. */
  extra?: readonly SourceAdapter[];
}

/** The shipped adapters: a file, the keyless catalogues, the embedded players, then any web address. */
export function defaultAdapters(opts: DefaultAdapterOptions = {}): SourceAdapter[] {
  return [
    createLocalFileAdapter({ transport: opts.transport }),
    createInternetArchiveAdapter({ fetch: opts.fetch, transport: opts.transport }),
    createAudiusAdapter({ fetch: opts.fetch, transport: opts.transport }),
    createYouTubeAdapter({ fetch: opts.fetch, getKey: opts.youtubeKey }),
    createSoundCloudAdapter(),
    createDeezerAdapter({ jsonp: opts.jsonp }),
    createSunoAdapter(),
    createBandcampAdapter(),
    ...(opts.extra ?? []),
    createCorsUrlAdapter({ fetch: opts.fetch, transport: opts.transport }),
  ];
}
