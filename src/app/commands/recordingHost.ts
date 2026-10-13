/**
 * The recording host (#257) — what the recording commands (`./recording`) act on, by
 * dependency inversion, the way `@thoremin/sdk-ui/host` gives an extension the app's
 * seams without importing the app.
 *
 * Why a seam and not an import: the command import firewall
 * (`test/commands_firewall.test.ts`) lets a command reach only the dials layer, the
 * settings schema and its sibling command modules, so the recording config and the
 * folder picker (`src/app/recording/`) are out of a command's reach by design. The
 * recording module installs an implementation when it loads (`configStore.ts`); a
 * command resolves it at dispatch time, so the registry can be built, listed and
 * described (the palette, the AI tool surface) before the host exists, and only
 * DISPATCHING a recording command before the app has loaded it is an error, one
 * that names what is missing.
 */

/** Where a take's files go: the player's recording-location preference. */
export type RecordingLocationChoice = 'directory' | 'downloads';

/** What choosing a folder came to, as data (a panel says it in words). */
export type ChosenFolder = { kind: 'chosen'; name: string } | { kind: 'cancelled' } | { kind: 'unsupported' };

export interface RecordingHost {
  /** Set where takes go; persisted with the player's recording config. */
  setLocation(location: RecordingLocationChoice): void;
  /** Open the folder picker (from a user gesture) and remember the choice. */
  chooseFolder(): Promise<ChosenFolder>;
}

let host: RecordingHost | null = null;

/** Installed by `installRecording()` (the recording config store), which App calls on
 *  mount. Returns the host it replaced, so an installer can put that one back. */
export function provideRecordingHost(next: RecordingHost | null): RecordingHost | null {
  const previous = host;
  host = next;
  return previous;
}

/** The installed host; throws, naming the seam, when none is. */
export function recordingHost(): RecordingHost {
  if (!host) throw new Error('recording host not installed: call installRecording() (src/app/recording/configStore) before dispatching a recording command');
  return host;
}
