/**
 * Embedded players: what every embed adapter shares. An item opens through the host's visible
 * player mount (`SourceHost.openEmbed`); the provider's SDK loads only then (each provider's player
 * module is imported on open, never with the app), and a host that shows no embeds refuses.
 */
import { SourceError, type EmbedPlayerFactory, type MediaItem, type PlaybackSession, type SourceHost, type TransportCapabilities } from './types';

/** A player only its own buttons control, that reports nothing (an iframe with no API). */
export const NO_CONTROL: TransportCapabilities = {
  play: false,
  position: false,
  seek: false,
  rate: null,
  volume: false,
  pauseLead: null,
  seekGranularity: null,
  positionLag: null,
};

/** Open `item` in the player `load` resolves to (its module imported now, not before). */
export async function openEmbedded(item: MediaItem, host: SourceHost, load: () => Promise<EmbedPlayerFactory>): Promise<PlaybackSession> {
  if (item.media.kind !== 'embed') throw new SourceError('unsupported', `${item.title} is not an embed`, item.source);
  if (!host.openEmbed) throw new SourceError('unsupported', `this page cannot show ${item.title}'s player`, item.source);
  return host.openEmbed(item, await load());
}

/** Load a provider's script once per page (the official SDK, from the provider). */
export function loadScriptOnce(src: string, doc: Document = document): Promise<void> {
  const cache = (loadScriptOnce as unknown as { done?: Map<string, Promise<void>> }).done ?? new Map<string, Promise<void>>();
  (loadScriptOnce as unknown as { done: Map<string, Promise<void>> }).done = cache;
  const was = cache.get(src);
  if (was) return was;
  const p = new Promise<void>((resolve, reject) => {
    const el = doc.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      cache.delete(src);
      reject(new Error(`could not load ${new URL(src).hostname}'s player`));
    };
    doc.head.appendChild(el);
  });
  cache.set(src, p);
  return p;
}

/**
 * Position between a provider's reports: the last reported position plus the time since, at the
 * applied rate, while playing. Also measures how often reports arrive (the position lag figure).
 */
export function createPositionClock(now: () => number = () => performance.now() / 1000) {
  let pos = 0;
  let reported = Number.NaN;
  let at = now();
  let rate = 1;
  let playing = false;
  const gaps: number[] = [];
  return {
    /** A provider's report; an unchanged value is no news (its cache was read again). */
    report(positionS: number) {
      if (positionS === reported) return;
      reported = positionS;
      const t = now();
      if (playing) gaps.push(t - at);
      if (gaps.length > 32) gaps.shift();
      pos = positionS;
      at = t;
    },
    /** A seek: the position is `positionS` now, and `stale` (what the provider still reports
     *  from before it) is not news. */
    seek(positionS: number, stale?: number) {
      pos = positionS;
      at = now();
      reported = stale ?? positionS;
    },
    setPlaying(on: boolean) {
      if (on === playing) return;
      pos = this.read();
      at = now();
      playing = on;
    },
    setRate(r: number) {
      pos = this.read();
      at = now();
      rate = r;
    },
    read(): number {
      return playing ? pos + (now() - at) * rate : pos;
    },
    /** The median gap between reports while playing, once there are a few; null before. */
    reportGapS(): number | null {
      if (gaps.length < 4) return null;
      const s = [...gaps].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    },
  };
}
