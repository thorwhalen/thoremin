/**
 * Owned audio: items whose media the device may decode (a file, a URL that allows it, Audius, the
 * Internet Archive). Every such adapter opens through {@link openOwnedAudio}, which fetches the
 * bytes only after the item's rights allow decoding, and hands them to the host's song player.
 */
import { assertAllows } from './rights';
import { SourceError, type MediaItem, type PlaybackSession, type SourceHost, type TransportCapabilities } from './types';

/** The song player's transport (the app's `song-player` node), as owned-audio adapters declare
 *  it. The app's session states its own (the same figures; a test keeps them equal). */
export const OWNED_TRANSPORT: TransportCapabilities = {
  seek: true,
  rate: { min: 0.5, max: 2 },
  volume: true,
  // The transport is hot-store state the song player reads on its next tick.
  pauseLead: { s: 1 / 30, source: 'stated' },
  seekGranularity: { s: 0, source: 'stated' },
  // `position()` is the player's last tick (the same reading `songTime` is made from): at most a
  // frame old, and it moves to a seek's target on the tick after the seek.
  positionLag: { s: 1 / 30, source: 'stated' },
};

export interface FetchOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** The item's bytes, once its rights allow decoding. A URL that the browser refuses to read
 *  (no CORS) or that answers with an error raises a {@link SourceError} that says which. */
export async function fetchOwnedBytes(item: MediaItem, opts: FetchOptions = {}): Promise<Blob> {
  assertAllows(item, 'decode');
  const media = item.media;
  if (media.kind === 'blob') return media.blob;
  if (media.kind !== 'url') throw new SourceError('unsupported', `${item.title} has no audio this device can play`, item.source);
  const doFetch = opts.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(media.url, { signal: opts.signal, mode: 'cors' });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    // A browser reports a CORS refusal and a dead network the same way: say both.
    throw new SourceError('cors', `${item.title} could not be fetched: the site is unreachable or does not let other pages read its audio`, item.source);
  }
  if (!res.ok) throw new SourceError(res.status === 404 ? 'not-found' : 'network', `${item.title} could not be fetched (HTTP ${res.status})`, item.source);
  return res.blob();
}

/** Open an owned-audio item: fetch its bytes under its rights, then the host's song player. */
export async function openOwnedAudio(item: MediaItem, host: SourceHost, opts: FetchOptions = {}): Promise<PlaybackSession> {
  const bytes = await fetchOwnedBytes(item, opts);
  return host.openOwned(item, bytes);
}
