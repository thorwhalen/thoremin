/**
 * The recording folder (#88, #257) — the ONE place a save folder is picked and
 * remembered, shared by the directory sink (which needs a folder when a take starts)
 * and by the trainer's "save takes to a folder" control (which lets the player pick it
 * once, up front, so a training take lands there without a manual move afterwards).
 *
 * Why one module: the File System Access API has two things to get right, and getting
 * them right twice is how they drift. The picker (`showDirectoryPicker`) may only be
 * invoked from a user gesture, and the handle it returns cannot be serialised, so the
 * only place it can be remembered is IndexedDB (`./idb`); on the next load the handle
 * is back, but its permission is not, and must be queried or re-requested before use.
 *
 * Three verbs, all feature-detected (Safari and Firefox ship no picker):
 *
 * - {@link chooseRecordingFolder} — always prompts; what a CONTROL calls, inside the
 *   player's click. Remembers the choice. Reports `chosen` / `cancelled` / `unsupported`
 *   as data, never as an exception, so a panel can say what happened.
 * - {@link acquireRecordingFolder} — the remembered folder if its permission holds (or
 *   is re-granted), else the picker; what the SINK calls at record start.
 * - {@link rememberedRecordingFolder} — the remembered folder's name, for a panel to
 *   show where takes go. Never prompts.
 *
 * The handle store and the picker are keyword options so tests run the whole thing
 * with an in-memory store and a stubbed picker; the defaults are the real ones.
 */
import { loadDirHandle, saveDirHandle, clearDirHandle } from './idb';

// ---- File System Access API surface (not in the TS DOM lib) -----------------
export interface FsWritable {
  write(data: Blob | string | BufferSource): Promise<void>;
  close(): Promise<void>;
}
export interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
}
export interface FsDirHandle {
  name?: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
export type DirPicker = (opts?: {
  mode?: 'read' | 'readwrite';
  startIn?: string;
  id?: string;
}) => Promise<FsDirHandle>;

/** Where a remembered handle lives: IndexedDB in the browser, memory in a test. */
export interface FolderHandleStore {
  load(): Promise<FsDirHandle | null>;
  save(handle: FsDirHandle): Promise<void>;
  clear(): Promise<void>;
}

/** The browser's store: the app's one IndexedDB record (`./idb`). */
export const IDB_FOLDER_STORE: FolderHandleStore = {
  load: () => loadDirHandle<FsDirHandle>(),
  save: (handle) => saveDirHandle(handle),
  clear: () => clearDirHandle(),
};

/** The picker as the browser exposes it, or null where it does not (Safari, Firefox, Node). */
export function browserDirectoryPicker(): DirPicker | null {
  const picker = (globalThis as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof picker === 'function' ? (picker as DirPicker) : null;
}

/** How the picker is opened: for writing, starting at Downloads (where takes went
 *  before #257, so the player finds the old ones next to the new), under one id so
 *  the browser reopens it where the player last chose. */
const PICKER_OPTIONS = { mode: 'readwrite', startIn: 'downloads', id: 'thoremin-recording' } as const;

export interface FolderOptions {
  /** The handle store; default IndexedDB. */
  store?: FolderHandleStore;
  /** The picker; default the browser's (`showDirectoryPicker`), null where absent. */
  picker?: DirPicker | null;
}

export type ChooseFolderResult =
  | { kind: 'chosen'; name: string }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' };

/** A handle's display name; the API always sets one, the type leaves it optional. */
function nameOf(handle: FsDirHandle): string {
  return handle.name ?? '';
}

async function permissionHolds(handle: FsDirHandle): Promise<boolean> {
  try {
    const opts = { mode: 'readwrite' as const };
    if ((await handle.queryPermission?.(opts)) === 'granted') return true;
    return (await handle.requestPermission?.(opts)) === 'granted';
  } catch {
    return false;
  }
}

/** Open the picker; null when the player dismissed it. Any other failure propagates. */
async function prompt(picker: DirPicker): Promise<FsDirHandle | null> {
  try {
    return await picker(PICKER_OPTIONS);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/**
 * Let the player choose the folder takes go to, and remember it. Must be called from
 * a user gesture (the browser refuses the picker otherwise). A new choice replaces the
 * remembered one; a dismissed picker leaves it as it was.
 */
export async function chooseRecordingFolder({
  store = IDB_FOLDER_STORE,
  picker = browserDirectoryPicker(),
}: FolderOptions = {}): Promise<ChooseFolderResult> {
  if (!picker) return { kind: 'unsupported' };
  const handle = await prompt(picker);
  if (!handle) return { kind: 'cancelled' };
  await store.save(handle);
  return { kind: 'chosen', name: nameOf(handle) };
}

/**
 * The folder a take writes into: the remembered one when its permission still holds
 * (or is re-granted on asking), else a fresh pick. Null when there is no picker or the
 * player dismissed it. A remembered folder whose permission is refused is forgotten,
 * so the next start asks for a folder rather than failing on the old one again.
 */
export async function acquireRecordingFolder({
  store = IDB_FOLDER_STORE,
  picker = browserDirectoryPicker(),
}: FolderOptions = {}): Promise<FsDirHandle | null> {
  if (!picker) return null;
  const remembered = await store.load();
  if (remembered) {
    if (await permissionHolds(remembered)) return remembered;
    await store.clear();
  }
  const handle = await prompt(picker);
  if (handle) await store.save(handle);
  return handle;
}

/** The remembered folder's name, or null when none is remembered. Never prompts and
 *  never asks for permission: a name is enough to say where the next take will go. */
export async function rememberedRecordingFolder({
  store = IDB_FOLDER_STORE,
}: Pick<FolderOptions, 'store'> = {}): Promise<string | null> {
  const handle = await store.load();
  return handle ? nameOf(handle) : null;
}
