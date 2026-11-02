/**
 * The SoundCloud widget behind the {@link EmbedPlayer} shape: SoundCloud's own player in an iframe,
 * driven through its Widget API (play, pause, seek, volume, position by its PLAY_PROGRESS events).
 * Imported only when a SoundCloud item opens; SoundCloud's script loads then.
 */
import { createPositionClock, loadScriptOnce } from '../embed';
import { SOUNDCLOUD_TRANSPORT } from '../provider_transports';
import type { EmbedEvent, EmbedPlayer, MediaItem, TransportCapabilities } from '../types';

interface ScWidget {
  bind(event: string, cb: (e?: { currentPosition?: number }) => void): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(v: number): void;
  getDuration(cb: (ms: number) => void): void;
}
type ScWindow = Window & { SC?: { Widget: ((el: HTMLIFrameElement) => ScWidget) & { Events: Record<string, string> } } };

export const SOUNDCLOUD_SCRIPT = 'https://w.soundcloud.com/player/api.js';

export function createSoundCloudPlayer(container: HTMLElement, item: MediaItem, win: ScWindow = window as ScWindow): EmbedPlayer {
  if (item.media.kind !== 'embed') throw new Error(`${item.title} is not an embed`);
  const listeners: Record<EmbedEvent, Set<() => void>> = { state: new Set(), ended: new Set(), buffering: new Set(), error: new Set() };
  const emit = (e: EmbedEvent) => listeners[e].forEach((l) => l());
  const clock = createPositionClock();
  const frame = container.ownerDocument.createElement('iframe');
  frame.src = item.media.embedUrl;
  frame.title = item.title;
  frame.allow = 'autoplay';
  frame.style.border = '0';
  frame.style.width = '100%';
  frame.style.height = '100%';
  container.appendChild(frame);
  let widget: ScWidget | null = null;
  let playing = false;
  let ended = false;
  let duration = item.durationS ?? 0;
  let volume = -1;
  const ready = loadScriptOnce(SOUNDCLOUD_SCRIPT, container.ownerDocument).then(
    () =>
      new Promise<void>((resolve) => {
        const SC = win.SC!;
        widget = SC.Widget(frame);
        const E = SC.Widget.Events;
        widget.bind(E.READY, () => {
          widget!.getDuration((ms) => (duration = ms / 1000));
          resolve();
        });
        widget.bind(E.PLAY, () => {
          playing = true;
          ended = false;
          clock.setPlaying(true);
          emit('state');
        });
        widget.bind(E.PAUSE, () => {
          playing = false;
          clock.setPlaying(false);
          emit('state');
        });
        widget.bind(E.FINISH, () => {
          playing = false;
          ended = true;
          clock.setPlaying(false);
          emit('state');
          emit('ended');
        });
        widget.bind(E.PLAY_PROGRESS, (e) => {
          if (typeof e?.currentPosition === 'number') clock.report(e.currentPosition / 1000);
        });
      }),
  );
  return {
    get capabilities(): TransportCapabilities {
      const gap = clock.reportGapS();
      return { ...SOUNDCLOUD_TRANSPORT, positionLag: gap === null ? null : { s: gap, source: 'measured' } };
    },
    ready,
    play: () => widget?.play(),
    pause: () => widget?.pause(),
    seek: (s) => {
      widget?.seekTo(Math.max(0, s) * 1000);
      clock.seek(s);
    },
    setVolume: (v) => {
      const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
      if (widget && pct !== volume) {
        widget.setVolume(pct);
        volume = pct;
      }
    },
    position: () => clock.read(),
    durationS: () => duration,
    playing: () => playing,
    ended: () => ended,
    on(event, listener) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    dispose: () => {
      widget = null;
      frame.remove();
    },
  };
}
