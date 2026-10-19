/**
 * The song slice's settings (#600 S15; #186 PR G, H): the per-device pref `songPrefs` (level,
 * rate, following the dancer, the conductor's hold) and its bounds, which the commands and the
 * panel share. Moved from core's settings schema unchanged (field for field, so a stored pref
 * reads the same), with a default on every field.
 */
import { z } from 'zod';

/** The hot-store field of the per-device pref. */
export const SONG_PREFS = 'songPrefs';

/** The song's rate range: the native media element's quality range (research map §6.1),
 *  and the `song-player` node's default clamp. */
export const SONG_RATE_MIN = 0.5;
export const SONG_RATE_MAX = 2;
/**
 * The song the player dances to (#186 PR G): its level and the rate it plays at, pitch
 * preserved. A per-DEVICE tooling pref like `audioPrefs`, NOT a preset field: the song
 * plays under whatever instrument is loaded, so switching instrument must not change its
 * tempo, and moving its slider must not mark the instrument edited. Persisted with the
 * player's other device prefs (the slice's `PrefSlice`, #600 S15); the palette and the assistant reach it through the
 * `song.volume.set` / `song.rate.set` commands. The song ITSELF (`songHandle`) and its
 * transport (`songPlaying`) are transient and never persisted.
 */
export const SONG_FOLLOW_RANGE_MIN = 0.02;
export const SONG_FOLLOW_RANGE_MAX = 0.3;
export const SONG_HOLD_FADE_MAX = 2;
/** The song beat the conductor may start on (#364): well past any intro. */
export const SONG_START_BEAT_MAX = 2000;
export const SongSettingsSchema = z.object({
  // Defaults on every field, so a stored pref missing one is completed over the defaults
  // (core's heal rule did that with `overDefaults` before the pref became the slice's).
  volume: z.number().min(0).max(1).default(0.8),
  rate: z.number().min(SONG_RATE_MIN).max(SONG_RATE_MAX).default(1),
  /** The song follows the dancer (#186 PR H): its tempo is pulled toward the dancer's
   *  pulse by the pace controller, around `rate`. Per device, like the rest: an
   *  instrument load must not change how the song follows. Off by default; turning it on
   *  starts the body camera while a song is loaded. */
  follow: z.boolean().default(false),
  /** How far from `rate` following may pull the song, a fraction (0.1 = +-10 %, the
   *  D-Jogger default; the native element sounds clean well past it). */
  followRange: z.number().min(SONG_FOLLOW_RANGE_MIN).max(SONG_FOLLOW_RANGE_MAX).default(0.1),
  /** Seconds the song fades out when the conductor holds it and back in on the release
   *  (#366). 0 = a cut, what every earlier version did (the default until the length is
   *  decided on #168). Per device like the rest; additive, so no store bump. */
  holdFadeS: z.number().min(0).max(SONG_HOLD_FADE_MAX).default(0),
  /** How far toward the slowest rate the song slows during that fade-out, a fraction, so
   *  the held note stretches instead of ending (#573). 0 = the rate holds, what every
   *  earlier version did (the default until ears decide it on #168). Needs `holdFadeS` > 0. */
  holdSlow: z.number().min(0).max(1).default(0),
  /** Following the dancer, a Play moves the song once so its beat lands on the dancer's cycle start, instead of
   *  closing the phase error through the rate nudge over several seconds (#346 item 1). A seek of at most
   *  half a beat in the song's first moments, so off by default until it has been heard (#168). Per device;
   *  additive. */
  alignStart: z.boolean().default(false),
});
export type SongSettings = z.infer<typeof SongSettingsSchema>;
export const DEFAULT_SONG: SongSettings = { volume: 0.8, rate: 1, follow: false, followRange: 0.1, holdFadeS: 0, holdSlow: 0, alignStart: false };
