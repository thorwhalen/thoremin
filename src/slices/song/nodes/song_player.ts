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
 * `../app/song_stretcher_signalsmith`, #187 PR 7, installed by the slice's app half through
 * `provideStretcherLoader`) by default, loaded the first time a song
 * needs it, which falls back by itself to the browser's own media element (`playbackRate`
 * with `preservesPitch`, `../app/song_stretcher`) where the worklet cannot start; the
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
 * A hold under a conductor fades instead of cutting (#366): with `holdFade` > 0 the
 * stretcher's fader ramps to silence over that many seconds, the song keeps sounding
 * meanwhile and pauses once it is silent; a release before the end of the ramp climbs
 * back from where it was, one after it fades in from silence. A cue waits out the ramp.
 * A tool's claim (the Trainer) silences the song like every other voice; the player's
 * mute acts on the master gain the song is mixed into.
 */
import { z } from 'zod';
import { defineNode, realtimeOutputAllowed } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import type { LoadStatus } from '@thoremin/lazy';
import { songTimeAt, songTimeOfBeat, EMPTY_SONG_GRID, type MusicalTime, type SongGrid } from '@thoremin/ictus';
import { type SongHandle, type Stretcher, LIVE, installedStretcherLoader, unlockSongPlayback } from './song_player.schema';
import { type StretcherOptions, type StretcherFactory } from './song_player.schema';
export type { StretcherOptions, StretcherFactory } from './song_player.schema';
export { unlockSongPlayback } from './song_player.schema';
export type { SongHandle, Stretcher } from './song_player.schema';

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

/** Whether the song can be played and moved now: loaded (`ready`, `active`), or loaded and
 *  only waiting for the browser to allow audio. The player acts on a cue or a press only
 *  then; the pace controller leads only then (#500), since while a new song loads the
 *  player's `songTime` is that song's grid read at the previous song's position. */
export function songPlayable(status: LoadStatus | undefined | null): boolean {
  return !!status && (status.phase === 'ready' || status.phase === 'active' || status.reason === 'autoplay');
}

export const songPlayerNode = defineNode<Params>({
  type: 'song-player',
  roles: ['synth'],
  title: 'Song Player',
  description:
    'Plays the song loaded in the Song tool at a live rate with the pitch preserved, into the master bus, and publishes the song\'s beat as musical time.',
  inputs: [
    { name: 'song', kind: 'song-handle', description: 'The loaded song (the Song tool, through the store); absent = nothing to play' },
    { name: 'playing', kind: 'boolean', default: false, description: 'The transport: song.play / song.pause' },
    {
      name: 'play',
      kind: 'number',
      description:
        'The press counter (song.play increments it): a change while `playing` is a press, so a Play made in the frame the song ends is not lost to a level that never fell (#344)',
    },
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
    {
      name: 'holdFade',
      kind: 'number',
      default: 0,
      description: "Seconds the song fades out on a conductor's hold and in on the release (#366); 0 = a cut",
    },
    {
      name: 'holdSlow',
      kind: 'number',
      default: 0,
      description:
        "How far toward `minRate` the song slows during a conductor's hold fade-out (#573), a fraction (0 = the rate holds, as before); needs `holdFade` > 0. The rate eases back over the same length on the release",
    },
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
    /** A hold's slowdown (#573): the rate when the fade-out began, and, once the hold is
     *  over, the rate it eases back from. */
    let slowed: { from: number; to: number } | null = null;
    let easing: { from: number; t0: number } | null = null;
    /** The last cue acted on (by id). Forgotten while no cue arrives, so a new leader's
     *  ids (a fresh servo counts from 1 again) are never mistaken for an old one's. */
    let cuedId: number | null = null;
    /** Whether a leader held the transport last tick. */
    let wasLed = false;
    /** The press counter last honoured (#344): a change is a press even while the
     *  `playing` level stayed up. Moves only while the song is playable, like `wasPlaying`. */
    let pressed: unknown = undefined;
    /** A hold's fade-out under way (engine time it began), and whether the fader is down. */
    let fading: { t0: number } | null = null;
    let faded = false;

    /** The stretcher, once there is one; starts the default loading on first need. */
    const stretcherFor = (ctx: NodeContext, audio: StretcherOptions, songId: string): Stretcher | null => {
      if (stretcher || starting || failed) return stretcher;
      const injected = ctx.resources.createStretcher as StretcherFactory | undefined;
      if (injected) {
        stretcher = injected(audio);
        LIVE.add(stretcher);
        return stretcher;
      }
      // The default is browser-only (a DOM audio element, a worklet): loaded once, on first need,
      // through the loader the slice's app half installs.
      const load = installedStretcherLoader();
      if (!load) {
        failed = true;
        failedFor = songId;
        (ctx.log ?? console.warn)('[song-player] no stretcher: the song slice installs its loader (provideStretcherLoader)');
        return null;
      }
      starting = true;
      const factory: Promise<StretcherFactory> = load(p.stretcher === 'element' ? 'element' : 'signalsmith');
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
          if (faded) stretcher?.fade?.(1, 0);
          fading = null;
          faded = false;
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
          if (faded) s.fade?.(1, 0);
          fading = null;
          faded = false;
          loadedId = song.id;
          wasPlaying = false;
          // Nor is a press counted before this song loaded.
          pressed = inputs.play;
          // A cue standing from the previous song is not a request about this one.
          const standing = inputs.cue as { id?: unknown } | undefined;
          cuedId = typeof standing?.id === 'number' ? standing.id : null;
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
        const led = typeof inputs.followPlaying === 'boolean';
        // When the leader lets go, the song stops and waits for a fresh press of Play: the
        // Song tool's transport may still read "playing" from before the leader took over.
        if (wasLed && !led) {
          s.pause();
          fading = null;
          if (faded) s.fade?.(1, 0);
          faded = false;
          wasPlaying = inputs.playing === true;
          pressed = inputs.play;
        }
        wasLed = led;
        const playing = led ? (inputs.followPlaying as boolean) : inputs.playing === true;
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
        // The fade-out stretches the held note: the rate eases toward the minimum over the
        // fade, and back over the same length once the hold is released (#573).
        const slow = led ? Math.max(0, Math.min(1, finite(inputs.holdSlow, 0))) : 0;
        const slowLen = led && s.fade ? Math.max(0, finite(inputs.holdFade, 0)) : 0;
        if (slow > 0 && slowLen > 0 && fading) {
          slowed ??= { from: applied, to: applied + (p.minRate - applied) * slow };
          easing = null;
          wanted = slowed.from + (slowed.to - slowed.from) * Math.min(1, (ctx.time - fading.t0) / slowLen);
        } else if (slowed && led && !playing) {
          wanted = slowed.to; // a paused song keeps the slowed rate until the release
        } else if (slowed) {
          easing ??= { from: applied, t0: ctx.time };
          const k = slowLen > 0 ? Math.min(1, (ctx.time - easing.t0) / slowLen) : 1;
          wanted = easing.from + (wanted - easing.from) * k;
          if (k >= 1) slowed = easing = null;
        }
        const rate = Math.max(p.minRate, Math.min(p.maxRate, wanted));
        applied = rate;
        const volume = inputs.claimed === true ? 0 : Math.max(0, Math.min(1, finite(inputs.volume, 0.8)));
        s.setVolume(volume);
        s.setRate(rate);
        const playable = songPlayable(status);
        // A cue moves the song to a beat; one that arrives while the song is still loading
        // is acted on once it is playable.
        const cue = inputs.cue as { id?: unknown; beat?: unknown } | undefined;
        if (!cue) cuedId = null;
        // A cue waits out a fade-out: the jump would be heard mid-ramp.
        const fadeS = led && s.fade ? Math.max(0, finite(inputs.holdFade, 0)) : 0;
        const fadingOut = fading !== null || (fadeS > 0 && !playing && s.playing());
        if (playable && !fadingOut && cue && typeof cue.id === 'number' && cue.id !== cuedId && typeof cue.beat === 'number' && s.seek) {
          const at = songTimeOfBeat(song.grid, cue.beat);
          if (Number.isFinite(at)) s.seek(Math.max(0, Math.min(song.durationS, at)));
          cuedId = cue.id;
        }
        if (playable) {
          // A rising edge plays (from the start when the song had ended); holding
          // `playing` after the end does not loop it.
          // A press made while the song was still loading is an edge here, once it is
          // ready (`wasPlaying` only moves while the song is playable).
          // A leader cannot restart a song that has played to its end (a release cue past
          // the end lands there): the song is over until the player presses Play.
          // A press is also an edge when the counter moved while the level stayed up (the
          // song ended and was pressed again between two ticks, #344); a press while the
          // song sounds changes nothing. The counter is the player's, so a leader ignores it.
          const press = !led && playing && inputs.play !== pressed && !s.playing();
          if (playing && fading) {
            // Released mid-ramp: back up from where the fader is, no pause, no restart.
            fading = null;
            s.fade?.(1, fadeS);
            faded = false;
          } else if ((playing && !wasPlaying && !(led && s.ended())) || press) {
            if (faded) s.fade?.(1, fadeS);
            faded = false;
            s.play();
          } else if (!playing && s.playing()) {
            if (fadeS > 0) {
              if (!fading) {
                fading = { t0: ctx.time };
                faded = true;
                s.fade?.(0, fadeS);
              }
              if (ctx.time - fading.t0 >= fadeS) {
                s.pause();
                fading = null;
              }
            } else {
              s.pause();
            }
          } else if (!playing && fading) {
            // The song ended under the ramp.
            fading = null;
          }
          wasPlaying = playing || fading !== null;
          pressed = inputs.play;
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
