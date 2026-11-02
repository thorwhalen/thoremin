/**
 * Embedded players in the Song tool: a provider's own player, shown as the provider shows it, in a
 * small window of its own at the bottom left of the page. It is open, and visible, exactly as long
 * as its session: closing the Song tool leaves it (the song keeps playing, as a file does), and its
 * close button ends it. Nothing listens while one plays (the listening gate, `./sources.ts`).
 *
 * The song player drives it like any song (`SongHandle.player`, through {@link embedStretcher}), so
 * the transport, the tempo, a seek and `songTime` work the same, as far as the provider allows.
 */
import { EMPTY_SONG_GRID } from '@thoremin/ictus';
import type { EmbedPlayer, MediaItem, PlaybackSession, SessionEvent, TransportCapabilities } from '@thoremin/sources';
import type { SongHandle, Stretcher } from '../nodes/song_player.schema';
import { requestSongSeek, setSongHandle, setSongPlaying, setSongPrefs, songHandle } from './state';
import { SONG_RATE_MAX, SONG_RATE_MIN } from '../schema';

/** The window's size: YouTube asks for at least 200 by 200 pixels. */
export const EMBED_WIDTH_PX = 360;
export const EMBED_HEIGHT_PX = 203;
/** The class every player window carries. */
export const EMBED_MOUNT_CLASS = 'thoremin-embed-player';
/** The title bar's height, for stacking windows. */
const BAR_PX = 30;

/** The song player's view of an embedded player: the same verbs, sent only when they change. */
export function embedStretcher(player: EmbedPlayer): Stretcher {
  let applied = 1;
  return {
    load: () => player.ready,
    play: () => player.play(),
    pause: () => player.pause(),
    setRate: (r) => {
      if (player.setRate) applied = player.setRate(r);
    },
    appliedRate: () => applied,
    setVolume: (v) => player.setVolume?.(v),
    position: () => player.position(),
    seek: player.seek ? (p) => player.seek!(p) : undefined,
    playing: () => player.playing(),
    ended: () => player.ended(),
    // The session owns the player: the song player never disposes it.
    dispose() {},
  };
}

export interface EmbedMount {
  /** Where the provider's player goes. */
  body: HTMLElement;
  remove(): void;
}

/** The player's own window, bottom left, above the camera: a title bar (the provider, the item, a
 *  link to its page, Close) over the provider's player. A window opened while another is still up
 *  (the next item loading while the last one plays) stacks above it, so neither is ever covered. */
export function createEmbedMount(item: MediaItem, provider: string, onClose: () => void, doc: Document = document): EmbedMount {
  const below = doc.getElementsByClassName(EMBED_MOUNT_CLASS).length;
  const box = doc.createElement('div');
  box.className = EMBED_MOUNT_CLASS;
  box.dataset.testid = 'embed-player';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', `${provider} player`);
  styleOf(box, [
    'position:fixed',
    'left:16px',
    `bottom:${16 + below * (EMBED_HEIGHT_PX + BAR_PX + 8)}px`,
    'z-index:60',
    `width:min(${EMBED_WIDTH_PX}px, calc(100vw - 32px))`,
    'border-radius:10px',
    'overflow:hidden',
    'background:#000',
    'box-shadow:0 8px 24px rgba(0,0,0,.5)',
    'border:1px solid rgba(255,255,255,.15)',
  ]);
  const bar = doc.createElement('div');
  styleOf(bar, 'display:flex;align-items:center;gap:8px;padding:4px 8px;font:12px system-ui,sans-serif;color:rgba(255,255,255,.8);background:rgba(20,20,20,.95)'.split(';'));
  const title = doc.createElement('span');
  title.textContent = `${provider} · ${item.title}`;
  styleOf(title, 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'.split(';'));
  bar.appendChild(title);
  if (item.pageUrl) {
    const link = doc.createElement('a');
    link.href = item.pageUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'page';
    styleOf(link, 'color:inherit;text-decoration:underline'.split(';'));
    bar.appendChild(link);
  }
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.setAttribute('aria-label', `Close the ${provider} player`);
  styleOf(close, 'color:inherit;background:rgba(255,255,255,.1);border:0;border-radius:6px;padding:2px 8px;cursor:pointer'.split(';'));
  close.onclick = onClose;
  bar.appendChild(close);
  const body = doc.createElement('div');
  styleOf(body, `width:100%;height:${EMBED_HEIGHT_PX}px;min-height:200px`.split(';'));
  box.append(bar, body);
  doc.body.appendChild(box);
  return { body, remove: () => box.remove() };
}

let nextEmbed = 1;

/** Set each `name:value` declaration on its own, so one a browser does not know never drops the rest. */
function styleOf(el: HTMLElement, declarations: readonly string[]): void {
  for (const d of declarations) {
    const i = d.indexOf(':');
    el.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
}

/** The song an embedded player plays: no audio of ours, so no beat grid (it is never analysed). */
export function embedSong(item: MediaItem, player: EmbedPlayer): SongHandle {
  return {
    id: `embed-${nextEmbed++}`,
    name: item.title,
    url: item.media.kind === 'embed' ? item.media.embedUrl : '',
    durationS: player.durationS(),
    grid: EMPTY_SONG_GRID,
    item,
    player: embedStretcher(player),
  };
}

/** A session over an embedded player: its transport goes through the song's hot-store transport
 *  (so the song player drives it, as it drives a file); closing it disposes the player and its
 *  window, always, and unloads the song if it is still the loaded one. */
export function embedSession(item: MediaItem, song: SongHandle, player: EmbedPlayer, mount: EmbedMount): PlaybackSession {
  const listeners: Record<SessionEvent, Set<() => void>> = { state: new Set(), ended: new Set(), buffering: new Set() };
  let closed = false;
  const live = () => !closed && songHandle() === song;
  const offs = (['state', 'ended', 'buffering'] as const).map((e) => player.on(e, () => live() && listeners[e].forEach((l) => l())));
  const caps = (): TransportCapabilities => player.capabilities;
  return {
    item,
    get capabilities() {
      return caps();
    },
    play: () => live() && caps().play && setSongPlaying(true),
    pause: () => live() && caps().play && setSongPlaying(false),
    seek: (positionS) => live() && caps().seek && requestSongSeek(positionS),
    setRate: (rate) => live() && caps().rate !== null && setSongPrefs({ rate: Math.max(SONG_RATE_MIN, Math.min(SONG_RATE_MAX, rate)) }),
    setVolume: (volume) => live() && caps().volume && setSongPrefs({ volume: Math.max(0, Math.min(1, volume)) }),
    position: () => (live() ? player.position() : 0),
    playing: () => live() && player.playing(),
    on(event, listener) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    close() {
      if (closed) return;
      const mine = live();
      closed = true;
      offs.forEach((off) => off());
      for (const set of Object.values(listeners)) set.clear();
      player.dispose();
      mount.remove();
      if (mine) setSongHandle(null);
    },
  };
}
