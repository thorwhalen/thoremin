/**
 * The recording config store (#88, #257) — the one in-memory truth of the player's
 * last-used {@link RecordingSession} (where takes go, the frame rate, the formats, the
 * streams), persisted under {@link RECORDING_SESSION_KEY} exactly as before, so a
 * config saved by an older build still parses (`parseSession` heals it).
 *
 * Why a store and not React state: before #257 the Record sheet held this config in
 * `useEngine`'s component state and the trainer re-read localStorage at each start,
 * so a change made anywhere but the sheet (the trainer's folder control, a command,
 * the palette, the AI assistant) could not reach the sheet until a reload. One store,
 * read by the sheet, the trainer and the commands, is what makes "set it in the
 * Trainer, see it in the Record sheet" true.
 *
 * Beside the config, the store mirrors the NAME of the remembered folder (`./folder`),
 * which lives in IndexedDB as a handle and so cannot be read synchronously by a panel:
 * `refreshFolder()` reads it on open, and the store follows every later change
 * (`onRecordingFolderChange`: a pick from the control or at take start, a refused
 * handle forgotten), with whether the browser kept it beyond this page
 * (`folderRemembered`). The name is derived, never persisted here; the handle is the SSOT.
 *
 * This module also installs the recording host the commands act on
 * (`@/app/commands/recordingHost`), because it owns both things a recording command
 * touches: the config and the folder.
 */
import { create } from 'zustand';
import { provideRecordingHost } from '@/app/commands/recordingHost';
import { DEFAULT_RECORDING_SESSION, parseSession, RECORDING_SESSION_KEY, type RecordingSession } from './schema';
import { chooseRecordingFolder, onRecordingFolderChange, rememberedRecordingFolder } from './folder';

type SessionUpdate = RecordingSession | ((prev: RecordingSession) => RecordingSession);

export interface RecordingConfigState {
  /** The last-used recording config (persisted). */
  session: RecordingSession;
  /** The remembered folder's name, null when none is remembered or not yet read. */
  folder: string | null;
  /** False when that folder is held for this page only: the browser could not keep it
   *  (IndexedDB refused the handle), so a reload will ask for it again. */
  folderRemembered: boolean;
  /** Update the config and persist it (auto-save; the sheet is a settings surface). */
  setSession(next: SessionUpdate): void;
  /** Re-read the remembered folder's name from the handle store. */
  refreshFolder(): Promise<void>;
}

/** Read the persisted last-used config (validated), or the default. */
function loadSession(): RecordingSession {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECORDING_SESSION_KEY) : null;
    return parseSession(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_RECORDING_SESSION;
  }
}

function persistSession(session: RecordingSession): void {
  try {
    localStorage.setItem(RECORDING_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* localStorage full/unavailable: the take still records this session. */
  }
}

export const useRecordingConfig = create<RecordingConfigState>()((set, get) => ({
  session: loadSession(),
  folder: null,
  folderRemembered: true,
  setSession: (next) => {
    const session = typeof next === 'function' ? next(get().session) : next;
    persistSession(session);
    set({ session });
  },
  refreshFolder: async () => {
    set({ folder: await rememberedRecordingFolder() });
  },
}));

/** The config as a non-React caller reads it (the trainer's take start). */
export function recordingConfig(): RecordingSession {
  return useRecordingConfig.getState().session;
}

onRecordingFolderChange((folder, { persistence }) =>
  useRecordingConfig.setState({ folder, folderRemembered: persistence !== 'page-only' }),
);

provideRecordingHost({
  setLocation: (location) => useRecordingConfig.getState().setSession((prev) => ({ ...prev, location })),
  chooseFolder: () => chooseRecordingFolder(),
});
