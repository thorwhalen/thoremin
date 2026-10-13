/**
 * Where the next take goes, in words (#257) — the pure reading of the recording
 * location preference, the remembered folder and the browser's capability that the
 * trainer's control (and any other surface) renders. Pure so the four cases are
 * unit-tested as data and every surface says the same thing.
 *
 * The cases: no picker in this browser (Safari, Firefox: takes download as a zip and
 * there is nothing to choose); Downloads chosen; a folder chosen and remembered; a
 * folder chosen but none remembered (the handle was refused or cleared), so the
 * take will ask at start.
 *
 * A remembered folder the browser could not keep beyond this page (IndexedDB refused
 * the handle, #393 item 6) is still where this page's takes go, so it is named, with
 * one more sentence saying the next reload will ask again.
 */
import type { RecordingLocation } from './schema';

export interface TakeDestinationInput {
  location: RecordingLocation;
  /** The remembered folder's name, null when none. */
  folder: string | null;
  /** Whether this browser has a folder picker. */
  supported: boolean;
  /** False when the folder is held for this page only (the browser could not keep it). Default true. */
  remembered?: boolean;
}

export interface TakeDestination {
  /** One sentence: where the next take lands. */
  text: string;
  /** The label of the folder action, or null when the browser cannot offer one. */
  chooseLabel: string | null;
  /** Whether "use Downloads instead" is an action worth offering (a folder is in use). */
  offerDownloads: boolean;
}

/** Said after the folder's name when the browser could not keep it beyond this page. */
const NOT_REMEMBERED_NOTE = 'The browser could not remember it, so it will be asked for again after a reload.';

export function describeTakeDestination({ location, folder, supported, remembered = true }: TakeDestinationInput): TakeDestination {
  if (!supported) {
    return {
      text: 'Takes download as a zip (this browser has no folder picker; Chrome or Edge has one).',
      chooseLabel: null,
      offerDownloads: false,
    };
  }
  if (location === 'downloads') {
    return { text: 'Takes download as a zip.', chooseLabel: 'Save takes to a folder...', offerDownloads: false };
  }
  if (folder) {
    const saved = `Takes are saved to the folder "${folder}".`;
    return {
      text: remembered ? saved : `${saved} ${NOT_REMEMBERED_NOTE}`,
      chooseLabel: 'Change folder...',
      offerDownloads: true,
    };
  }
  return {
    text: 'Takes are saved to a folder you will be asked for when the take starts.',
    chooseLabel: 'Choose folder...',
    offerDownloads: true,
  };
}
