/**
 * The YouTube IFrame player behind the {@link EmbedPlayer} shape. Imported only when a YouTube item
 * opens (the adapter's dynamic import), and it loads YouTube's own script then. The player is
 * YouTube's, unmodified, in the element the host shows; this module only calls its API.
 *
 * Measured, not assumed: the gap between position reports (position lag), the time from a pause
 * to the paused state (pause lead) and how far a seek lands from where it was asked (granularity).
 */
import { createPositionClock, loadScriptOnce } from '../embed';
import { YOUTUBE_RATES, YOUTUBE_TRANSPORT } from '../provider_transports';
import type { EmbedEvent, EmbedPlayer, MediaItem, TimingFigure, TransportCapabilities } from '../types';

interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  setPlaybackRate(r: number): void;
  getAvailablePlaybackRates(): number[];
  setVolume(v: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}
interface YtNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YtPlayer;
}
type YtWindow = Window & { YT?: YtNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };

export const YOUTUBE_SCRIPT = 'https://www.youtube.com/iframe_api';

/** YouTube's error codes in words. */
export const YOUTUBE_ERRORS: Record<number, string> = {
  2: 'the video id is not valid',
  5: 'the browser cannot play this video',
  100: 'the video was removed or is private',
  101: 'its owner does not allow it to be played on other sites',
  150: 'its owner does not allow it to be played on other sites',
};

/** The IFrame API, once per page. */
function loadYouTube(win: YtWindow): Promise<YtNamespace> {
  if (win.YT?.Player) return Promise.resolve(win.YT);
  return new Promise((resolve, reject) => {
    const prev = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (win.YT?.Player) resolve(win.YT);
    };
    loadScriptOnce(YOUTUBE_SCRIPT, win.document).catch(reject);
  });
}

const STATE = { ended: 0, playing: 1, paused: 2, buffering: 3 } as const;

export function createYouTubePlayer(container: HTMLElement, item: MediaItem, win: YtWindow = window as YtWindow): EmbedPlayer {
  const listeners: Record<EmbedEvent, Set<() => void>> = { state: new Set(), ended: new Set(), buffering: new Set(), error: new Set() };
  const emit = (e: EmbedEvent) => listeners[e].forEach((l) => l());
  const clock = createPositionClock();
  let player: YtPlayer | null = null;
  let state = -1;
  let disposed = false;
  let rates: readonly number[] = YOUTUBE_RATES;
  let applied = 1;
  let volume = -1;
  let pauseAskedAt: number | null = null;
  let seekAsked: number | null = null;
  let pauseLead: TimingFigure | null = null;
  let seekGranularity: TimingFigure | null = null;
  let failure: string | null = null;
  const now = () => performance.now() / 1000;

  const host = container.ownerDocument.createElement('div');
  container.appendChild(host);

  const ready = loadYouTube(win).then(
    (YT) =>
      new Promise<void>((resolve, reject) => {
        if (disposed) return reject(new Error('closed'));
        player = new YT.Player(host, {
          videoId: item.id,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              rates = player!.getAvailablePlaybackRates?.().length ? player!.getAvailablePlaybackRates() : YOUTUBE_RATES;
              resolve();
            },
            onStateChange: (e: { data: number }) => {
              state = e.data;
              clock.setPlaying(state === STATE.playing);
              if (state === STATE.paused && pauseAskedAt !== null) {
                pauseLead = { s: now() - pauseAskedAt, source: 'measured' };
                pauseAskedAt = null;
              }
              if ((state === STATE.playing || state === STATE.paused) && seekAsked !== null) {
                seekGranularity = { s: Math.abs(player!.getCurrentTime() - seekAsked), source: 'measured' };
                seekAsked = null;
              }
              emit('state');
              if (state === STATE.ended) emit('ended');
              if (state === STATE.buffering) emit('buffering');
            },
            onPlaybackRateChange: (e: { data: number }) => {
              applied = e.data;
              clock.setRate(applied);
            },
            onError: (e: { data: number }) => {
              const why = YOUTUBE_ERRORS[e.data] ?? `YouTube error ${e.data}`;
              failure = `${item.title} cannot be played here: ${why}`;
              reject(new Error(failure));
              emit('error');
            },
          },
        });
      }),
  );

  const nearest = (r: number) => rates.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), rates[0] ?? 1);

  return {
    get capabilities(): TransportCapabilities {
      const gap = clock.reportGapS();
      return {
        ...YOUTUBE_TRANSPORT,
        rate: { min: Math.min(...rates), max: Math.max(...rates), steps: rates },
        pauseLead,
        seekGranularity,
        positionLag: gap === null ? null : { s: gap, source: 'measured' },
      };
    },
    ready,
    play: () => player?.playVideo(),
    pause: () => {
      if (!player) return;
      if (state === STATE.playing) pauseAskedAt = now();
      player.pauseVideo();
    },
    seek: (s) => {
      if (!player) return;
      seekAsked = s;
      const stale = player.getCurrentTime();
      player.seekTo(s, true);
      clock.seek(s, stale);
    },
    setRate: (r) => {
      const want = nearest(r);
      if (player && want !== applied) {
        player.setPlaybackRate(want);
        applied = want;
        clock.setRate(want);
      }
      return applied;
    },
    setVolume: (v) => {
      const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
      if (player && pct !== volume) {
        player.setVolume(pct);
        volume = pct;
      }
    },
    position: () => {
      if (player) clock.report(player.getCurrentTime());
      return clock.read();
    },
    durationS: () => player?.getDuration() ?? 0,
    playing: () => state === STATE.playing,
    ended: () => state === STATE.ended,
    error: () => failure,
    on(event, listener) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    dispose() {
      disposed = true;
      player?.destroy();
      player = null;
      host.remove();
    },
  };
}
