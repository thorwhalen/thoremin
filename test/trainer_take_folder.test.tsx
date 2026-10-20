// @vitest-environment jsdom
/**
 * The take folder is reachable from a cold load (#257): the tools bar opens the
 * Trainer, and the Trainer says where takes go and offers to save them to a folder,
 * which opens the browser's picker from that click, remembers the folder, names it,
 * and makes the folder the recording location, through the command registry. Where
 * the browser has no picker, the control is honest: takes download as a zip and
 * there is no button.
 *
 * Clicks from a cold load: Trainer (1) -> "Save takes to a folder..." (2) -> the
 * browser's folder dialog.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ToolsBar from '@/app/tools/ToolsBar';
// The Trainer is an extension tool since #600 S16d: the shell's frame host mounts it while open.
import ExtensionToolPanels from '@/app/tools/ExtensionToolPanels';
import { useTools } from '@/app/tools/toolsStore';
import { useTrainer, useTrainerStores } from '@/slices/trainer/app/store';
import { createCueStore, createRoutineStore } from '@/slices/trainer/app/cueStore';
import { STARTER_ROUTINES } from '@/slices/trainer/app/realVsAirCues';
import { createInMemoryProvider } from '@zodal/store';
import { useTrainerPrefs } from '@/slices/trainer/app/prefs';
import { installRecording, useRecordingConfig } from '@/app/recording/configStore';
import { DEFAULT_RECORDING_SESSION } from '@thoremin/sdk-ui/recording/schema';
import { journal } from '@/app/commands/registry';
import type { FsDirHandle } from '@/app/recording/folder';
import { TRAINER } from './helpers/extensions';

const g = globalThis as unknown as { showDirectoryPicker?: unknown };
let pickerCalls = 0;

function installPicker(handle: FsDirHandle | null) {
  g.showDirectoryPicker = async () => {
    pickerCalls++;
    if (!handle) throw new DOMException('dismissed', 'AbortError');
    return handle;
  };
}

const takesFolder: FsDirHandle = {
  name: 'takes',
  getDirectoryHandle: async () => takesFolder,
  getFileHandle: async () => ({ createWritable: async () => ({ write: async () => undefined, close: async () => undefined }) }),
};

// App installs the recording host on mount (#392); these tests render the panel alone.
let uninstallRecording: () => void = () => {};
beforeEach(() => {
  uninstallRecording = installRecording();
  useTools.setState({ open: null });
  useTrainer.getState().reset();
  useTrainerPrefs.setState({ recordTake: true, manualAdvance: false });
  useRecordingConfig.setState({ session: DEFAULT_RECORDING_SESSION, folder: null });
  journal.clear();
  pickerCalls = 0;
  delete g.showDirectoryPicker;
});
afterEach(() => {
  uninstallRecording();
  cleanup();
  delete g.showDirectoryPicker;
});

function openTrainerWithoutWhere() {
  render(
    <>
      <ToolsBar />
      <ExtensionToolPanels />
    </>,
  );
  fireEvent.click(screen.getByText('Trainer'));
}

function openTrainer() {
  openTrainerWithoutWhere();
  return screen.getByLabelText('Where takes go');
}

describe.runIf(TRAINER)('the take folder is reachable from the Trainer (#257)', () => {
  it('with a folder picker: Trainer -> "Save takes to a folder..." picks, remembers, names and switches the location', async () => {
    installPicker(takesFolder);
    const where = openTrainer();
    expect(where.textContent).toContain('Takes download as a zip.');
    const choose = screen.getByText('Save takes to a folder...');
    await act(async () => {
      fireEvent.click(choose);
    });
    expect(pickerCalls).toBe(1);
    expect(useRecordingConfig.getState().session.location).toBe('directory');
    expect(where.textContent).toContain('Takes are saved to the folder "takes".');
    expect(screen.getByText('Change folder...')).toBeTruthy();
    // The write went through the registry, not around it.
    expect(journal.entries().map((e) => e.command)).toContain('recording.folder.choose');
  });

  it('a dismissed picker leaves the location as it was', async () => {
    installPicker(null);
    const where = openTrainer();
    await act(async () => {
      fireEvent.click(screen.getByText('Save takes to a folder...'));
    });
    expect(pickerCalls).toBe(1);
    expect(useRecordingConfig.getState().session.location).toBe('downloads');
    expect(where.textContent).toContain('Takes download as a zip.');
  });

  it('"Downloads instead" is offered once a folder is in use, and dispatches the location write', async () => {
    installPicker(takesFolder);
    useRecordingConfig.setState({ session: { ...DEFAULT_RECORDING_SESSION, location: 'directory' }, folder: 'takes' });
    const where = openTrainer();
    await act(async () => {
      fireEvent.click(screen.getByText('Downloads instead'));
    });
    expect(useRecordingConfig.getState().session.location).toBe('downloads');
    expect(where.textContent).toContain('Takes download as a zip.');
    expect(journal.entries().map((e) => e.command)).toContain('recording.location.set');
  });

  it('without a folder picker (Safari, Firefox): says takes download as a zip, and offers no button', () => {
    const where = openTrainer();
    expect(where.textContent).toContain('no folder picker');
    expect(screen.queryByText('Save takes to a folder...')).toBeNull();
    expect(screen.queryByText('Downloads instead')).toBeNull();
  });

  it('is hidden when nothing is recorded (the pref off), and shown for a real-versus-air routine, which always records', async () => {
    useTrainerPrefs.setState({ recordTake: false });
    useTrainerStores({ cues: createCueStore(createInMemoryProvider([])), routines: createRoutineStore(createInMemoryProvider([])) });
    try {
      installPicker(takesFolder);
      openTrainerWithoutWhere();
      expect(screen.queryByLabelText('Where takes go')).toBeNull();
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Choose a routine'), { target: { value: STARTER_ROUTINES[0].id } });
      });
      expect(screen.getByLabelText('Where takes go').textContent).toContain('Takes download as a zip.');
      expect(screen.getByText('Save takes to a folder...')).toBeTruthy();
    } finally {
      useTrainerStores(null);
    }
  });
});
