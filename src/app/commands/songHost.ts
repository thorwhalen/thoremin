/**
 * The song host (#186 PR G) — what the song commands (`./song`) act on, by dependency
 * inversion, the shape of `./recordingHost`.
 *
 * The command import firewall (`test/commands_firewall.test.ts`) keeps a command away
 * from the hot store, and the song (`songHandle`) and its transport (`songPlaying`) are
 * transient hot-store state, not dials. So the song module (`src/app/song/host.ts`)
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
}

let host: SongHost | null = null;

/** Installed by the song module when it loads. */
export function provideSongHost(next: SongHost | null): void {
  host = next;
}

/** The installed host; throws, naming the seam, when none is. */
export function songHost(): SongHost {
  if (!host) throw new Error('song host not installed: load src/app/song/host before dispatching a song command');
  return host;
}
