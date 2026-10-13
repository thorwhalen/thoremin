// @vitest-environment jsdom
/**
 * A folder the browser could not remember (#391 item 3, #393 item 6, from #307).
 * The folder handle is persisted in IndexedDB; a full disk or a private window makes
 * that save fail. The failure used to be swallowed (`idb.ts`) and the Trainer said the
 * takes were saved to the folder exactly as if it had been kept, so the player learned
 * otherwise only after a reload, when the next take asked for a folder again. The
 * Trainer may still name the folder (this page holds it), but it must not claim the
 * folder was remembered.
 *
 * Clicks: Trainer (1) -> "Save takes to a folder..." (2), with IndexedDB failing every
 * write (`test/helpers/fakeIndexedDb.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import TrainerPanel from '@/app/TrainerPanel';
import { useTools } from '@/app/toolsStore';
import { useTrainer } from '@/app/enroll/store';
import { useTrainerPrefs } from '@/app/enroll/prefs';
import { useRecordingConfig } from '@/app/recording/configStore';
import { DEFAULT_RECORDING_SESSION } from '@/app/recording/schema';
import type { FsDirHandle } from '@/app/recording/folder';
import { installFakeIndexedDb, type FakeIndexedDb } from './helpers/fakeIndexedDb';

const g = globalThis as unknown as { showDirectoryPicker?: unknown };

const takesFolder: FsDirHandle = {
  name: 'takes',
  getDirectoryHandle: async () => takesFolder,
  getFileHandle: async () => ({ createWritable: async () => ({ write: async () => undefined, close: async () => undefined }) }),
};

let idb: FakeIndexedDb;

beforeEach(() => {
  useTools.setState({ open: null });
  useTrainer.getState().reset();
  useTrainerPrefs.setState({ recordTake: true, manualAdvance: false });
  useRecordingConfig.setState({ session: DEFAULT_RECORDING_SESSION, folder: null });
  g.showDirectoryPicker = async () => takesFolder;
  idb = installFakeIndexedDb({ failWrites: true });
});
afterEach(() => {
  cleanup();
  idb.uninstall();
  delete g.showDirectoryPicker;
});

describe('the Trainer when IndexedDB cannot keep the chosen folder', () => {
  it('names the folder for this page but does not claim it was remembered (#393 item 6)', async () => {
    render(
      <>
        <ToolsBar />
        <TrainerPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Trainer'));
    const where = screen.getByLabelText('Where takes go');
    await act(async () => {
      fireEvent.click(screen.getByText('Save takes to a folder...'));
    });
    // Let the failing IndexedDB write settle (it fails on a timer, like a browser's).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(idb.data.size).toBe(0);
    expect(where.textContent).toContain('"takes"');
    expect(where.textContent).toMatch(/could not (be )?remember/i);
  });
});
