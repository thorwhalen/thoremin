/**
 * Spotify's embed behind the {@link EmbedPlayer} shape, through its iFrame API: play, pause, seek
 * (whole seconds) and the position from its playback updates. Imported only when a Spotify item
 * opens; Spotify's script loads then.
 */
import { createPositionClock, loadScriptOnce } from '../embed';
import { SPOTIFY_TRANSPORT } from '../provider_transports';
import type { EmbedEvent, EmbedPlayer, MediaItem, TransportCapabilities } from '../types';

interface SpotifyController {
  play(): void;
  pause(): void;
  resume(): void;
  seek(seconds: number): void;
  destroy(): void;
  addListener(event: string, cb: (e: { data?: { isPaused?: boolean; isBuffering?: boolean; position?: number; duration?: number } }) => void): void;
}
interface SpotifyIframeApi {
  createController(el: HTMLElement, opts: Record<string, unknown>, cb: (c: SpotifyController) => void): void;
}
type SpotifyWindow = Window & { onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void; __thoreminSpotifyApi?: Promise<SpotifyIframeApi> };

export const SPOTIFY_SCRIPT = 'https://open.spotify.com/embed/iframe-api/v1';

function loadSpotify(win: SpotifyWindow): Promise<SpotifyIframeApi> {
  win.__thoreminSpotifyApi ??= new Promise((resolve, reject) => {
    win.onSpotifyIframeApiReady = (api) => resolve(api);
    loadScriptOnce(SPOTIFY_SCRIPT, win.document).catch(reject);
  });
  return win.__thoreminSpotifyApi;
}

export function createSpotifyPlayer(container: HTMLElement, item: MediaItem, win: SpotifyWindow = window as SpotifyWindow): EmbedPlayer {
  const listeners: Record<EmbedEvent, Set<() => void>> = { state: new Set(), ended: new Set(), buffering: new Set(), error: new Set() };
  const emit = (e: EmbedEvent) => listeners[e].forEach((l) => l());
  const clock = createPositionClock();
  const host = container.ownerDocument.createElement('div');
  container.appendChild(host);
  let controller: SpotifyController | null = null;
  let started = false;
  let playing = false;
  let ended = false;
  let duration = item.durationS ?? 0;
  let disposed = false;
  const ready = loadSpotify(win).then(
    (api) =>
      new Promise<void>((resolve, reject) => {
        if (disposed) return reject(new Error('closed'));
        api.createController(host, { uri: item.id, width: '100%', height: '100%' }, (c) => {
          controller = c;
          c.addListener('ready', () => resolve());
          c.addListener('playback_update', (e) => {
            const d = e.data ?? {};
            if (typeof d.duration === 'number' && d.duration > 0) duration = d.duration / 1000;
            if (typeof d.position === 'number') clock.report(d.position / 1000);
            const now = d.isPaused === false;
            if (now !== playing) {
              playing = now;
              clock.setPlaying(now);
              emit('state');
            }
            if (d.isBuffering) emit('buffering');
            const atEnd = !now && duration > 0 && typeof d.position === 'number' && d.position / 1000 >= duration - 0.5;
            if (atEnd && !ended) {
              ended = true;
              emit('ended');
            } else if (now) ended = false;
          });
        });
      }),
  );
  return {
    get capabilities(): TransportCapabilities {
      const gap = clock.reportGapS();
      return { ...SPOTIFY_TRANSPORT, positionLag: gap === null ? null : { s: gap, source: 'measured' } };
    },
    ready,
    play: () => {
      if (!controller) return;
      // The first start is play(); afterwards resume() continues where it paused.
      if (started) controller.resume();
      else controller.play();
      started = true;
    },
    pause: () => controller?.pause(),
    seek: (s) => {
      const whole = Math.max(0, Math.round(s));
      controller?.seek(whole);
      clock.report(whole);
    },
    position: () => clock.read(),
    durationS: () => duration,
    playing: () => playing,
    ended: () => ended,
    on(event, listener) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    dispose() {
      disposed = true;
      controller?.destroy();
      controller = null;
      host.remove();
    },
  };
}
