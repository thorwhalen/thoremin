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
 * Playback is behind the {@link Stretcher} seam: Signalsmith Stretch (an AudioWorklet,
 * `./song_stretcher_signalsmith`, #187 PR 7) by default, loaded the first time a song
 * needs it, which falls back by itself to the browser's own media element (`playbackRate`
 * with `preservesPitch`, `./song_stretcher`) where the worklet cannot start; the
 * `stretcher` param picks the element outright; a host's own comes through
 * `ctx.resources.createStretcher` (the tests). Like
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
 *
 * A conductor can lead the transport too (#187 PR 7): `followPlaying`, when present,
 * replaces `playing` (the conductor's beat servo pauses the song while he waits or
 * holds), and `cue` moves the song to a beat (seeking to its time on the grid) whenever
 * its id changes.
 * A tool's claim (the Trainer) silences the song like every other voice; the player's
 * mute acts on the master gain the song is mixed into.
 */
import { z } from 'zod';
import { defineNode, realtimeOutputAllowed } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import type { LoadStatus } from '@thoremin/lazy';
import { songTimeAt, songTimeOfBeat, EMPTY_SONG_GRID, type MusicalTime, type SongGrid } from '@thoremin/ictus';

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

export const STRETCHERS = ['signalsmith', 'element'] as const;

const Params = z.object({
  /** The rate range a live input may set: the native element's quality range. */
  minRate: z.number().positive().default(0.5),
  maxRate: z.number().positive().default(2),
  /** Which stretcher plays the song: Signalsmith Stretch (falls back to the element where
   *  its worklet cannot start) or the media element outright. */
  stretcher: z.enum(STRETCHERS).default('signalsmith'),
});
type Params = z.infer<typeof Params>;

const OFF: LoadStatus = { phase: 'off', message: 'No song loaded' };

/** Seconds over which the rate glides back to the player's own when following stops
 *  mid-song (a jump of up to the follow range is audible; a glide is not). */
const FOLLOW_RELEASE_S = 2;

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
    {
      name: 'followPlaying',
      kind: 'boolean',
      description: "The conductor's transport (#187 PR 7): replaces `playing` when present (paused while the conductor waits or holds)",
    },
    { name: 'cue', kind: 'song-cue', description: "Move the song to a beat (the conductor's cue): seeks whenever its id changes" },
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
    /** The rate applied last tick, whether the pace controller set it, and the glide back
     *  to the player's own rate once it stops. */
    let applied = 1;
    let wasFollowed = false;
    let glide: { from: number; t0: number } | null = null;
    /** The last cue acted on (by id). */
    let cuedId: number | null = null;

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
      const factory: Promise<StretcherFactory> =
        p.stretcher === 'element'
          ? import('./song_stretcher').then((m) => m.createMediaElementStretcher)
          : import('./song_stretcher_signalsmith').then((m) => m.createSignalsmithStretcher);
      void factory
        .then((create) => {
          // A node disposed while the module loaded must not leave an element behind.
          if (disposed) return;
          stretcher = create(audio);
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
          cuedId = null;
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
        // The conductor's transport replaces the player's while he leads (#187 PR 7).
        const playing = typeof inputs.followPlaying === 'boolean' ? inputs.followPlaying : inputs.playing === true;
        // While the song follows the dancer, the pace controller's rate replaces the
        // player's (which is then the controller's base, the centre of its clamp).
        const followed = typeof inputs.followRate === 'number' && Number.isFinite(inputs.followRate);
        if (wasFollowed && !followed) glide = { from: applied, t0: ctx.time };
        if (followed) glide = null;
        wasFollowed = followed;
        let wanted = followed ? (inputs.followRate as number) : finite(inputs.rate, 1);
        if (glide) {
          const k = Math.min(1, (ctx.time - glide.t0) / FOLLOW_RELEASE_S);
          wanted = glide.from + (wanted - glide.from) * k;
          if (k >= 1) glide = null;
        }
        const rate = Math.max(p.minRate, Math.min(p.maxRate, wanted));
        applied = rate;
        const volume = inputs.claimed === true ? 0 : Math.max(0, Math.min(1, finite(inputs.volume, 0.8)));
        s.setVolume(volume);
        s.setRate(rate);
        const playable = status.phase === 'ready' || status.phase === 'active' || status.reason === 'autoplay';
        // A cue moves the song to a beat; one that arrives while the song is still loading
        // is acted on once it is playable.
        const cue = inputs.cue as { id?: unknown; beat?: unknown } | undefined;
        if (playable && cue && typeof cue.id === 'number' && cue.id !== cuedId && typeof cue.beat === 'number' && s.seek) {
          const at = songTimeOfBeat(song.grid, cue.beat);
          if (Number.isFinite(at)) s.seek(Math.max(0, Math.min(song.durationS, at)));
          cuedId = cue.id;
        }
        if (playable) {
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
