/**
 * The `song_player` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */
import { type SongGrid } from '@thoremin/ictus';

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
}

/** How a song is played at a rate, pitch preserved. */
export interface Stretcher {
  /** Load a song by URL. Resolves when playable, rejects when it cannot be decoded. */
  load(url: string): Promise<void>;
  /** Start (or resume) playback; from the start when the song had ended. */
  play(): void;
  pause(): void;
  /** Playback rate, pitch preserved; 1 = the song's own tempo. */
  setRate(rate: number): void;
  setVolume(volume: number): void;
  /** Ramp the fader (separate from the volume) to `level` (0..1) over `seconds`; 0 seconds
   *  is immediate (#366: the conductor's hold fades the song). Absent = cuts only. */
  fade?(level: number, seconds: number): void;
  /** Position on the SONG's timeline, seconds: the audio leaving the stretcher now. */
  position(): number;
  /** Move to a position on the song's timeline, seconds (#187 PR 7: the conductor's cue). */
  seek?(position: number): void;
  playing(): boolean;
  ended(): boolean;
  /** True after the browser refused the last `play()` (an autoplay policy: WebKit wants
   *  a gesture per media element); cleared by the next `play()`. */
  blocked?(): boolean;
  /** Called from inside a user gesture (the Play button's click) so a later `play()`
   *  from the engine tick is allowed; a no-op where nothing needs unlocking. */
  unlock?(): void;
  dispose(): void;
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


export interface StretcherOptions {
  audioContext: AudioContext;
  destination: AudioNode;
}

export type StretcherFactory = (opts: StretcherOptions) => Stretcher;
