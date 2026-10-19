/**
 * The song host (#186 PR G) — what the song commands (`./songCommands`) act on, by dependency
 * inversion, the shape of core's `recordingHost`.
 *
 * The command import firewall (`test/commands_firewall.test.ts`) keeps a command away
 * from the hot store, and the song (`songHandle`), its transport (`songPlaying`) and its
 * level and tempo (`songPrefs`, a per-device pref) are hot-store state, not dials. So the song module (`./host.ts`)
 * installs an implementation when it loads, and a command resolves it at dispatch time:
 * the registry can be built, listed and described (the palette, the AI tool surface)
 * before the host exists, and only DISPATCHING a song command before the app has loaded
 * it is an error, one that names what is missing.
 */

export interface SongHost {
  /** The loaded song's name, or null when none is loaded. */
  loaded(): string | null;
  /** Start or stop the transport. */
  setPlaying(playing: boolean): void;
  /** Set the song's level (0..1) or rate (pitch preserved), a per-device pref. */
  setVolume(volume: number): void;
  setRate(rate: number): void;
  /** Whether the song follows the dancer, and how far it may be pulled (#186 PR H), also
   *  per-device prefs. */
  setFollow(follow: boolean): void;
  setFollowRange(range: number): void;
  /** Whether a Play moves the song once onto the dancer's cycle start (#346 item 1). */
  setAlignStart(on: boolean): void;
  /** Seconds the song fades out on a conductor's hold and back in on the release (#366). */
  setHoldFade(seconds: number): void;
  setHoldSlow(fraction: number): void;
  /** The song beat the conductor's first beat lands on (#364), transient per song. */
  setStartBeat(beat: number): void;
}

let host: SongHost | null = null;

/** Installed by the song module when it loads. */
export function provideSongHost(next: SongHost | null): void {
  host = next;
}

/** The installed host; throws, naming the seam, when none is. */
export function songHost(): SongHost {
  if (!host) throw new Error('song host not installed: load the song slice host (src/slices/song/app/host) before dispatching a song command');
  return host;
}
