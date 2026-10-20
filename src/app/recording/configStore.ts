/**
 * The app's half of the recording config (#88, #257; the store itself is the SDK's since #600
 * S16c, `@thoremin/sdk-ui/recording/config`): the remembered folder (a handle in IndexedDB,
 * `./folder`) read into the store and followed on every change, and the recording host the
 * commands act on (`@/app/commands/recordingHost`), because this module owns both things a
 * recording command touches: the config and the folder. It installs the host only when asked
 * ({@link installRecording}, called by App on mount), never as a side effect of being imported:
 * importing the store for its config must not rewire the command registry.
 */
import { provideRecordingFolderReader, useRecordingConfig } from '@thoremin/sdk-ui/recording/config';
import { provideRecordingHost, type RecordingHost } from '@/app/commands/recordingHost';
import { chooseRecordingFolder, onRecordingFolderChange, rememberedRecordingFolder } from './folder';

export { recordingConfig, useRecordingConfig, type RecordingConfigState } from '@thoremin/sdk-ui/recording/config';

provideRecordingFolderReader(rememberedRecordingFolder);

onRecordingFolderChange((folder, { persistence }) =>
  useRecordingConfig.setState({ folder, folderRemembered: persistence !== 'page-only' }),
);

/** What a recording command acts on: this store's config and the folder module. */
const RECORDING_HOST: RecordingHost = {
  setLocation: (location) => useRecordingConfig.getState().setSession((prev) => ({ ...prev, location })),
  chooseFolder: () => chooseRecordingFolder(),
};

/**
 * Install the recording host, so the `recording.*` commands (the Record sheet, the
 * trainer's folder control, the palette, the assistant) act on this store. App calls it
 * in a mount effect; a test that dispatches a recording command through the registry
 * calls it too. Returns the uninstall, which puts back whatever host was there before,
 * but only while this host is still the installed one (two uninstalls out of order, as in
 * an HMR overlap, must not leave a stale host). React runs a child's effects before App's,
 * so a child must not dispatch a `recording.*` command from its own mount effect.
 */
export function installRecording(): () => void {
  const previous = provideRecordingHost(RECORDING_HOST);
  return () => {
    const current = provideRecordingHost(previous);
    if (current !== RECORDING_HOST) provideRecordingHost(current);
  };
}
