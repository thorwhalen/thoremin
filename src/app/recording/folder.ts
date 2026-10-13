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
 * Whoever shows the folder's name subscribes with {@link onRecordingFolderChange}:
 * the remembered folder changes at take start too (a pick, a refused handle
 * forgotten), not only from the control, and a panel reading it once on open would
 * show a stale name after that.
 *
 * The handle store and the picker are keyword options so tests run the whole thing
 * with an in-memory store and a stubbed picker; the defaults are the real ones.
 *
 * What goes wrong in a browser, and what each verb does about it (#307, #393 item 6):
 * an EXCEPTION while asking for permission (a `SecurityError` once the click's user
 * activation has lapsed) is not a refusal, so the folder is kept and the take simply
 * not started; a folder deleted or renamed on disk still reads `granted`, so the sink
 * finds out from `getDirectoryHandle` and calls {@link forgetRecordingFolder} before
 * asking again; and an IndexedDB that cannot keep the handle leaves it held for this
 * page only, which the listeners are told (`remembered: false`), so a panel does not
 * claim a folder the next reload will not have.
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

/**
 * Whether a saved handle will outlive the page: `remembered` (persisted);
 * `page-only` (held for this page, the persistence tier failed to keep it); or
 * `no-storage` (this runtime has no persistence tier at all, so nothing was expected
 * to outlive the page and there is nothing to warn about).
 */
export type FolderPersistence = 'remembered' | 'page-only' | 'no-storage';

/** Where a remembered handle lives: IndexedDB in the browser, memory in a test. */
export interface FolderHandleStore {
  load(): Promise<FsDirHandle | null>;
  /** Keep the handle. A store that resolves with nothing kept it for good. */
  save(handle: FsDirHandle): Promise<void | FolderPersistence>;
  clear(): Promise<void>;
}

/**
 * The page's own copy of the folder, the memory tier in front of IndexedDB.
 * `undefined` defers to IndexedDB (nothing chosen or forgotten on this page yet, so
 * a choice made in another tab is still seen); a handle or `null` is this page's
 * own latest word, which IndexedDB may have failed to record.
 */
let held: FsDirHandle | null | undefined;

/**
 * The browser's store: memory first, then the app's one IndexedDB record (`./idb`)
 * as the persistence tier. Holding the handle in memory is what keeps a folder the
 * player just chose usable for the rest of the page when IndexedDB refuses to keep it
 * (a full disk, a private window). Where IndexedDB is absent there is no tier to
 * stand in front of, so nothing is held (no browser with a folder picker lacks it).
 */
const IDB_FOLDER_STORE: FolderHandleStore = {
  load: async () => (held !== undefined ? held : loadDirHandle<FsDirHandle>()),
  save: async (handle) => {
    const outcome = await saveDirHandle(handle);
    if (outcome === 'unavailable') return 'no-storage';
    held = handle;
    return outcome === 'saved' ? 'remembered' : 'page-only';
  },
  clear: async () => {
    held = null;
    await clearDirHandle();
  },
};

/** The picker as the browser exposes it, or null where it does not (Safari, Firefox, Node). */
function browserDirectoryPicker(): DirPicker | null {
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

/** What a listener is told beside the name: whether the folder will outlive the page. */
export interface FolderChangeInfo {
  persistence: FolderPersistence;
}

type FolderListener = (name: string | null, info: FolderChangeInfo) => void;
const listeners = new Set<FolderListener>();

/** Be told whenever the remembered folder changes (its name, or null once forgotten),
 *  and whether the browser kept it beyond this page. */
export function onRecordingFolderChange(listener: FolderListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function remember(store: FolderHandleStore, handle: FsDirHandle): Promise<void> {
  const persistence = (await store.save(handle)) ?? 'remembered';
  for (const l of listeners) l(nameOf(handle), { persistence });
}

async function forget(store: FolderHandleStore): Promise<void> {
  await store.clear();
  for (const l of listeners) l(null, { persistence: 'remembered' });
}

/**
 * Forget the remembered folder, so the next {@link acquireRecordingFolder} offers the
 * picker. What the sink calls when the folder turns out to be gone from disk
 * (`NotFoundError`, `InvalidStateError`): its permission still reads `granted`, so
 * only writing into it finds out, and keeping it would fail every later take too.
 */
export async function forgetRecordingFolder({ store = IDB_FOLDER_STORE }: Pick<FolderOptions, 'store'> = {}): Promise<void> {
  await forget(store);
}

/**
 * Whether the handle may be written to: `granted`; `denied` (the browser or the
 * player refused, the handle is dead); or `prompt`, which is what a DISMISSED
 * "allow edits?" prompt leaves behind. A dismissal is not a refusal: the folder is
 * still the player's choice and is kept, the take is simply not started.
 *
 * An exception that is the browser declining to ASK (a `SecurityError` or
 * `NotAllowedError` once the click's user activation has lapsed) reads as `prompt`
 * too, for the same reason: it is not the player declining the folder (#393 item 6),
 * and the next click can ask again. Any other exception says nothing about a later
 * click, so it reads `denied` and the folder is forgotten, rather than kept to fail
 * every take after it.
 */
const ASK_DECLINED_ERRORS: ReadonlySet<string> = new Set(['SecurityError', 'NotAllowedError']);

async function permissionState(handle: FsDirHandle): Promise<PermissionState> {
  try {
    const opts = { mode: 'readwrite' as const };
    const queried = await handle.queryPermission?.(opts);
    if (queried === 'granted' || queried === 'denied') return queried;
    return (await handle.requestPermission?.(opts)) ?? 'denied';
  } catch (e) {
    return ASK_DECLINED_ERRORS.has((e as { name?: string })?.name ?? '') ? 'prompt' : 'denied';
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
  await remember(store, handle);
  return { kind: 'chosen', name: nameOf(handle) };
}

/**
 * The folder a take writes into: the remembered one when its permission still holds
 * (or is re-granted on asking), else a fresh pick. Null when there is no picker or the
 * player dismissed it. A remembered folder whose permission is REFUSED is forgotten,
 * so the next start asks for a folder rather than failing on the old one again; one
 * whose re-grant prompt was merely dismissed is kept, and the take does not start.
 */
export async function acquireRecordingFolder({
  store = IDB_FOLDER_STORE,
  picker = browserDirectoryPicker(),
}: FolderOptions = {}): Promise<FsDirHandle | null> {
  if (!picker) return null;
  const remembered = await store.load();
  if (remembered) {
    const state = await permissionState(remembered);
    if (state === 'granted') return remembered;
    if (state === 'prompt') return null;
    await forget(store);
  }
  const handle = await prompt(picker);
  if (handle) await remember(store, handle);
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
