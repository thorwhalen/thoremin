/**
 * `song-player` node (#186 PR G) — plays the song the player loaded, at a live rate with
 * the pitch preserved, into the instrument's master bus, and publishes where the song is
 * as musical time.
 *
 * The song arrives on the `song` port as the stable {@link SongHandle} the hot store
 * carries (research map §9.5): the same object every tick until another song loads, so a
 * new song is detected by identity and loaded once. The transport (`playing`), the rate
 * and the level are live inputs, so the Song tool, the palette and the pace controller
 * (PR H, on `followRate`, which replaces `rate` while the song follows the dancer) drive
 * it without a graph rebuild.
 *
 * Playback is behind the {@link Stretcher} seam: the browser's own media element
 * (`playbackRate` with `preservesPitch`, `./song_stretcher`) by default, loaded the first
 * time a song needs it, or a host's own through `ctx.resources.createStretcher` (the
 * tests; Signalsmith Stretch is the measured next candidate, research map §6.1). Like
 * every audio node it is a no-op without an `AudioContext` (created on the player's
 * first tap), and it says where it is on `status` in the shared lazy-loading vocabulary:
 * `off` with no song, `unavailable` before the audio starts, `loading` while the element
 * buffers, `ready` when playable (reason `ended` once it has played to the end), `active`
 * while playing, and `error` with reason `autoplay` when the browser refused to start it
 * (see {@link unlockSongPlayback}).
 *
 * `songTime` is the song's {@link MusicalTime} read off its beat grid at the playback
 * position, with tempo and the next beat in ENGINE time (so a song at 1.1x has a 10 %
 * shorter period): what the pace controller (PR H) compares with the dancer's pulse.
 * A tool's claim (the Trainer) silences the song like every other voice; the player's
 * mute acts on the master gain the song is mixed into.
 */
import { z } from 'zod';
import { defineNode, realtimeOutputAllowed } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import type { LoadStatus } from '@thoremin/lazy';
import { songTimeAt, EMPTY_SONG_GRID, type MusicalTime, type SongGrid } from '@thoremin/ictus';

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
  /** Position on the SONG's timeline, seconds. */
  position(): number;
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
const LIVE = new Set<Stretcher>();

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

const Params = z.object({
  /** The rate range a live input may set: the native element's quality range. */
  minRate: z.number().positive().default(0.5),
  maxRate: z.number().positive().default(2),
});
type Params = z.infer<typeof Params>;

const OFF: LoadStatus = { phase: 'off', message: 'No song loaded' };

function audioOf(ctx: NodeContext): StretcherOptions | null {
  const audioContext = ctx.resources.audioContext as AudioContext | undefined;
  const destination = ctx.resources.masterGain as AudioNode | undefined;
  return audioContext && destination ? { audioContext, destination } : null;
}

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export const songPlayerNode = defineNode<Params>({
  type: 'song-player',
  roles: ['synth'],
  title: 'Song Player',
  description:
    'Plays the song loaded in the Song tool at a live rate with the pitch preserved, into the master bus, and publishes the song\'s beat as musical time.',
  inputs: [
    { name: 'song', kind: 'song-handle', description: 'The loaded song (the Song tool, through the store); absent = nothing to play' },
    { name: 'playing', kind: 'boolean', default: false, description: 'The transport: song.play / song.pause' },
    { name: 'rate', kind: 'number', default: 1, description: 'Playback rate, pitch preserved (clamped to minRate..maxRate)' },
    {
      name: 'followRate',
      kind: 'number',
      description: 'The pace controller\'s rate while the song follows the dancer (PR H); replaces `rate` when present',
    },
    { name: 'volume', kind: 'number', default: 0.8 },
    { name: 'claimed', kind: 'boolean', default: false, description: 'A tool holds the instrument quiet (the Trainer)' },
  ],
  outputs: [
    { name: 'status', kind: 'load-status' },
    { name: 'position', kind: 'number', description: 'Seconds into the song, on its own timeline' },
    { name: 'rate', kind: 'number', description: 'The rate the song is played at, after the clamp (what the pace controller reads back)' },
    { name: 'songTime', kind: 'musical-time', description: 'The song\'s beat at the playback position, tempo in engine time' },
  ],
  params: Params,
  make(p) {
    let stretcher: Stretcher | null = null;
    let starting = false;
    let failed = false;
    let loadedId: string | null = null;
    let status: LoadStatus = OFF;
    let wasPlaying = false;
    let disposed = false;
    let failedFor: string | null = null;

    /** The stretcher, once there is one; starts the default loading on first need. */
    const stretcherFor = (ctx: NodeContext, audio: StretcherOptions, songId: string): Stretcher | null => {
      if (stretcher || starting || failed) return stretcher;
      const injected = ctx.resources.createStretcher as StretcherFactory | undefined;
      if (injected) {
        stretcher = injected(audio);
        LIVE.add(stretcher);
        return stretcher;
      }
      // The default is browser-only (a DOM audio element): loaded once, on first need.
      starting = true;
      void import('./song_stretcher')
        .then(({ createMediaElementStretcher }) => {
          // A node disposed while the module loaded must not leave an element behind.
          if (disposed) return;
          stretcher = createMediaElementStretcher(audio);
          LIVE.add(stretcher);
        })
        .catch((e) => {
          failed = true;
          failedFor = songId;
          (ctx.log ?? console.warn)(`[song-player] the stretcher failed to load: ${String(e)}`);
        })
        .finally(() => {
          starting = false;
        });
      return null;
    };

    const idle = (ctx: NodeContext, s: LoadStatus, grid: SongGrid = EMPTY_SONG_GRID) => ({
      status: s,
      position: 0,
      rate: 1,
      songTime: songTimeAt(grid, 0, { t: ctx.time, playing: false }) as MusicalTime,
    });

    return {
      process(inputs, ctx) {
        const song = (inputs.song as SongHandle | null | undefined) ?? null;
        const audio = realtimeOutputAllowed(ctx) ? audioOf(ctx) : null;
        if (!song) {
          if (stretcher && loadedId) stretcher.pause();
          loadedId = null;
          wasPlaying = false;
          status = OFF;
          return idle(ctx, status);
        }
        if (!audio) {
          return idle(ctx, { phase: 'unavailable', reason: 'no-audio', message: 'Tap to play to start the audio, then play the song' }, song.grid);
        }
        // A new song retries a stretcher that failed to load (a chunk lost to a redeploy).
        if (failed && song.id !== failedFor) failed = false;
        const s = stretcherFor(ctx, audio, song.id);
        if (!s) {
          return idle(
            ctx,
            failed ? { phase: 'error', message: 'The song player could not start' } : { phase: 'loading', message: 'Starting the song player...' },
            song.grid,
          );
        }
        if (loadedId !== song.id) {
          s.pause();
          loadedId = song.id;
          wasPlaying = false;
          status = { phase: 'loading', message: `Loading ${song.name}...` };
          const id = song.id;
          s.load(song.url).then(
            () => {
              if (loadedId === id) status = { phase: 'ready', message: `${song.name} is ready` };
            },
            () => {
              if (loadedId === id) status = { phase: 'error', reason: 'decode', message: `${song.name} could not be played` };
            },
          );
        }
        const playing = inputs.playing === true;
        // While the song follows the dancer, the pace controller's rate replaces the
        // player's (which is then the controller's base, the centre of its clamp).
        const rate = Math.max(p.minRate, Math.min(p.maxRate, finite(inputs.followRate, finite(inputs.rate, 1))));
        const volume = inputs.claimed === true ? 0 : Math.max(0, Math.min(1, finite(inputs.volume, 0.8)));
        s.setVolume(volume);
        s.setRate(rate);
        if (status.phase === 'ready' || status.phase === 'active' || status.reason === 'autoplay') {
          // A rising edge plays (from the start when the song had ended); holding
          // `playing` after the end does not loop it.
          // A press made while the song was still loading is an edge here, once it is
          // ready (`wasPlaying` only moves while the song is playable).
          if (playing && !wasPlaying) s.play();
          else if (!playing && s.playing()) s.pause();
          wasPlaying = playing;
          const sounding = s.playing();
          status = sounding
            ? { phase: 'active', message: `Playing ${song.name}` }
            : s.blocked?.()
              ? { phase: 'error', reason: 'autoplay', message: 'The browser blocked the song: press Play in the Song tool' }
              : s.ended()
              ? { phase: 'ready', reason: 'ended', message: `${song.name} has finished` }
              : { phase: 'ready', message: `${song.name} is ready` };
        }
        const position = s.position();
        return {
          status,
          position,
          rate,
          songTime: songTimeAt(song.grid, position, { t: ctx.time, rate, playing: s.playing() }),
        };
      },
      dispose() {
        disposed = true;
        if (stretcher) LIVE.delete(stretcher);
        stretcher?.dispose();
        stretcher = null;
        loadedId = null;
      },
    };
  },
});
