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
 * Beside the config, the store mirrors the NAME of the remembered folder (the app's folder module),
 * which lives in IndexedDB as a handle and so cannot be read synchronously by a panel:
 * `refreshFolder()` reads it on open, and the app keeps the store following every later
 * change (a pick from the control or at take start, a refused handle forgotten), with whether the browser kept it beyond this page
 * (`folderRemembered`). The name is derived, never persisted here; the handle is the SSOT.
 *
 * The folder itself is the app's (a handle in IndexedDB, its picker): the app provides the
 * reader ({@link provideRecordingFolderReader}) and mirrors every change into this store
 * (`src/app/recording/configStore.ts`), so an extension's panel (the Trainer's folder control)
 * reads and sets the config here without importing the app (#600 S16c).
 */
import { create } from 'zustand';
import { DEFAULT_RECORDING_SESSION, parseSession, RECORDING_SESSION_KEY, type RecordingSession } from './schema';

/** How the remembered folder's name is read: the app's handle store, or none (a headless host). */
let readFolder: () => Promise<string | null> = async () => null;

/** Provide the remembered folder's reader (the app does, when its recording config loads). Returns
 *  a withdraw that only removes this one. */
export function provideRecordingFolderReader(read: () => Promise<string | null>): () => void {
  readFolder = read;
  return () => {
    if (readFolder === read) readFolder = async () => null;
  };
}

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
    set({ folder: await readFolder() });
  },
}));

/** The config as a non-React caller reads it (the trainer's take start). */
export function recordingConfig(): RecordingSession {
  return useRecordingConfig.getState().session;
}
