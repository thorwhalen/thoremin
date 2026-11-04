/**
 * The `song_player` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */
import { type SongGrid } from '@thoremin/ictus';
import type { Stretcher, StretcherFactory } from '@thoremin/sdk/audio/stretcher';

/**
 * The song's stretcher seam (#976) is the SDK's, `@thoremin/sdk/audio/stretcher`: the
 * {@link Stretcher} contract, its factory, and the resource a host or an extension sets to wrap or
 * replace the factory (`ctx.resources.createStretcher`, read when a song loads; the module header
 * there says how). Re-exported here so the slice's existing imports keep working.
 */
export type { Stretcher, StretcherFactory, StretcherFormant, StretcherOptions } from '@thoremin/sdk/audio/stretcher';
export { SONG_STRETCHER_RESOURCE } from '@thoremin/sdk/audio/stretcher';

/** The song as the instrument sees it: one stable object per loaded file. Never
 *  persisted (the object URL dies with the page; the grid is re-tracked on load). */
export interface SongHandle {
  /** A fresh id per load, so a consumer can tell a new song from the same one. */
  id: string;
  /** The file's name, for the panel and the status line. */
  name: string;
  /** What the stretcher streams: an object URL for a local file. */
  url: string;
  durationS: number;
  grid: SongGrid;
  /** The source item it was opened from (a `MediaItem` of `@thoremin/sources`, read here by its
   *  shape: the node's contract stays free of that package): its provider, rights, licence and
   *  page. Absent for a song set directly (a test). */
  item?: SongSourceItem;
  /** The song's own player, when it plays in a provider's embedded player rather than through the
   *  song player's stretcher. The session that opened it owns it (and disposes it); the node only
   *  drives it, and reads its position for `songTime`. */
  player?: Stretcher;
}

/** What the song knows of the source item it came from. */
export interface SongSourceItem {
  source: string;
  id: string;
  title: string;
  artist?: string;
  rights: string;
  pageUrl?: string;
  licence?: { name: string; url?: string };
}

/** A request to move the song to a position (a playback session's `seek`): a fresh id per request. */
export interface SongSeek {
  id: number;
  positionS: number;
}

/** The live stretchers, so a click can unlock them (see {@link unlockSongPlayback}). */
export const LIVE = new Set<Stretcher>();

/**
 * Unlock song playback from inside a user gesture. The node calls `play()` from the
 * engine tick, not from a click, and WebKit's autoplay policy refuses that for a media
 * element that was never played in a gesture; the Song tool's Play button calls this in
 * its click handler first. Commands from the palette, the assistant or a hand gesture are
 * not clicks: on WebKit those report `reason: 'autoplay'` until the button is pressed.
 */
export function unlockSongPlayback(): void {
  for (const s of LIVE) s.unlock?.();
}

/** Which default stretcher the node's `stretcher` param asks for. */
export type StretcherKind = 'signalsmith' | 'element';

/** Loads a default stretcher's factory on first need (the browser engines, a DOM audio element or an
 *  AudioWorklet). The node never imports them: the slice's app half installs this (#600 S15, the
 *  rule S13 and S14 set: a slice's node never imports its browser engine). */
export type StretcherLoader = (kind: StretcherKind) => Promise<StretcherFactory>;

let stretcherLoader: StretcherLoader | null = null;

/** Install the default stretchers' loader (`../app/stretchers.ts`); returns the previous one. */
export function provideStretcherLoader(next: StretcherLoader | null): StretcherLoader | null {
  const was = stretcherLoader;
  stretcherLoader = next;
  return was;
}

/** The installed loader, or null in a host that installed none (a headless test, or a host with a
 *  factory of its own, sets `ctx.resources.createStretcher` instead: the seam, which wins over
 *  this loader). */
export function installedStretcherLoader(): StretcherLoader | null {
  return stretcherLoader;
}
