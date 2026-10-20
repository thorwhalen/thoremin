/**
 * Recording commands (#257) — where a take is saved, as `acture` commands, so the
 * trainer's "save takes to a folder" control (and the palette, and the AI assistant)
 * go through the one dispatch surface like every other discrete control.
 *
 * Two commands, because choosing a folder is two decisions the player may make
 * apart: WHERE takes go (`recording.location.set`, a plain preference write) and
 * WHICH folder (`recording.folder.choose`, which opens the browser's picker and
 * remembers the answer). Choosing a folder implies the folder location; using
 * Downloads again is only the preference, the remembered folder stays for next time.
 *
 * The picker can only open inside a user gesture, so `recording.folder.choose`
 * dispatched by the AI assistant comes back refused by the browser; that surfaces
 * as an error naming the reason rather than a silent no-op. Recording config is a
 * tooling preference, never a dial (`@thoremin/sdk-ui/recording/schema`), which is why
 * these reach it through the recording host seam (`./recordingHost`) and not the
 * dials layer.
 */
import { z } from 'zod';
import { defineCommand, ok, err, type Result } from 'acture';
import { recordingHost } from './recordingHost';

const RecordingLocationParam = z
  .enum(['directory', 'downloads'])
  .describe('Where takes are saved: a chosen folder (where the browser has a folder picker), or the Downloads folder as a zip.');

/** Set where takes go. */
export const setRecordingLocationCmd = defineCommand({
  id: 'recording.location.set',
  title: 'Set where recordings go',
  description: 'Save takes to the chosen folder, or to Downloads as a zip.',
  category: 'Recording',
  params: z.object({ location: RecordingLocationParam }),
  execute: async ({ location }) => {
    recordingHost().setLocation(location);
    return ok({ location });
  },
});

/** What choosing came to: the folder's name, or a cancel that changed nothing. */
interface ChosenFolderValue {
  folder: string | null;
  cancelled: boolean;
}

/** Open the folder picker, remember the folder and save takes there from now on. */
export const chooseRecordingFolderCmd = defineCommand({
  id: 'recording.folder.choose',
  title: 'Choose a folder for recordings',
  description:
    'Pick the folder takes are saved to (remembered for later takes). Needs a click: the browser only opens its folder picker from one.',
  category: 'Recording',
  params: z.object({}),
  execute: async (): Promise<Result<ChosenFolderValue>> => {
    const host = recordingHost();
    let result: Awaited<ReturnType<typeof host.chooseFolder>>;
    try {
      result = await host.chooseFolder();
    } catch (e) {
      // The browser refuses a picker opened outside a user gesture (the assistant).
      if (e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) {
        return err('needs_gesture', 'The folder picker only opens from a click in the app.', { name: e.name });
      }
      throw e;
    }
    if (result.kind === 'unsupported') {
      return err('unsupported', 'This browser has no folder picker; takes download as a zip. Chrome or Edge has one.');
    }
    if (result.kind === 'cancelled') return ok({ folder: null, cancelled: true });
    host.setLocation('directory');
    return ok({ folder: result.name, cancelled: false });
  },
});

/** All recording commands, registered together. */
export const RECORDING_COMMANDS = [setRecordingLocationCmd, chooseRecordingFolderCmd] as const;
