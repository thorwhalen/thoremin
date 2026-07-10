/**
 * RecordingSink (#88) — a three-tier destination for the files of one recording
 * folder, generalizing the single-file `saveBlob` (`./save`) into an interface
 * with `add(name, data)` + `close()`:
 *
 *   1. directory — File System Access API: a real folder with N streamed files
 *      (Chromium). The picked handle is reused from IndexedDB across takes.
 *   2. zip       — one `.zip` (lazy `fflate`) = the whole folder, one download.
 *      Works everywhere (the honest fallback where no folder picker exists) and
 *      lands in the browser's Downloads folder.
 *   3. perFile   — per-file `saveBlob` (last resort).
 *
 * The backend is chosen by `chooseSinkKind` (`./caps`, feature-detected). All
 * three write the identical file names from the pure {@link planRecording}, so the
 * naming contract can't drift between them.
 */
import { saveBlob } from './save';
import { loadDirHandle, saveDirHandle, clearDirHandle } from './idb';
import type { SinkKind } from './caps';

/** A recording session was cancelled by the user (e.g. dismissed the folder
 * picker). Thrown by the directory sink factory so the caller can fall back. */
export class SinkCancelled extends Error {
  constructor() {
    super('recording sink cancelled by user');
    this.name = 'SinkCancelled';
  }
}

export interface SinkResult {
  /** User-facing label for the toast (folder name, or `NAME.zip`). */
  label: string;
  /** How many files were written. */
  count: number;
  /** True if a native picker was used (folder / save-as), false for a download. */
  viaPicker: boolean;
  /** True if the user dismissed the final Save-As dialog — nothing was written, so
   * callers must report a cancellation, not a success. */
  cancelled?: boolean;
}

export interface RecordingSink {
  /** The concrete backend, for the manifest/HUD and tests. */
  readonly kind: SinkKind;
  /** Write one file into the recording folder. */
  add(name: string, data: Blob | string): Promise<void>;
  /** Finalize (flush/close/download) and return a toast label + file count. */
  close(): Promise<SinkResult>;
}

// ---- File System Access API surface (not in the TS DOM lib) -----------------
interface FsWritable {
  write(data: Blob | string | BufferSource): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
}
interface FsDirHandle {
  name?: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
type DirPicker = (opts?: {
  mode?: 'read' | 'readwrite';
  startIn?: string;
  id?: string;
}) => Promise<FsDirHandle>;

function toBytes(data: Blob | string): Promise<Uint8Array> {
  if (typeof data === 'string') return Promise.resolve(new TextEncoder().encode(data));
  return data.arrayBuffer().then((b) => new Uint8Array(b));
}

async function ensurePermission(handle: FsDirHandle): Promise<boolean> {
  try {
    const opts = { mode: 'readwrite' as const };
    if ((await handle.queryPermission?.(opts)) === 'granted') return true;
    return (await handle.requestPermission?.(opts)) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Directory sink: acquire a base folder (reused from IndexedDB, else the picker
 * opened at Downloads), create the recording subfolder, and stream each file into
 * it. Acquires the handle up-front (at construction) so the folder prompt appears
 * when recording starts, not on stop. Throws {@link SinkCancelled} if the user
 * dismisses the picker so the caller can fall back to a zip.
 */
async function createDirectorySink(folderName: string): Promise<RecordingSink> {
  const picker = (globalThis as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
  if (!picker) throw new SinkCancelled();

  // Reuse a previously-picked folder when its permission is still (re-)grantable.
  let base = await loadDirHandle<FsDirHandle>();
  if (base && !(await ensurePermission(base))) {
    await clearDirHandle();
    base = null;
  }
  if (!base) {
    try {
      base = await picker({ mode: 'readwrite', startIn: 'downloads', id: 'thoremin-recording' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new SinkCancelled();
      throw e;
    }
    await saveDirHandle(base);
  }

  const dir = await base.getDirectoryHandle(folderName, { create: true });
  let count = 0;
  return {
    kind: 'directory',
    async add(name, data) {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
      count++;
    },
    async close() {
      return { label: folderName, count, viaPicker: true };
    },
  };
}

/** Zip sink: accumulate `{folderName/name: bytes}` and, on close, lazily zip
 * (fflate) into one download. The zip preserves the one-folder mental model. */
function createZipSink(folderName: string): RecordingSink {
  const files: Record<string, Uint8Array> = {};
  let count = 0;
  return {
    kind: 'zip',
    async add(name, data) {
      files[`${folderName}/${name}`] = await toBytes(data);
      count++;
    },
    async close() {
      const { zipSync } = await import('fflate');
      const zipped = zipSync(files, { level: 6 });
      // Copy into a fresh ArrayBuffer so the Blob owns contiguous bytes (avoids a
      // SharedArrayBuffer/subarray-view type mismatch across TS lib versions).
      const buf = new Uint8Array(zipped.length);
      buf.set(zipped);
      const blob = new Blob([buf], { type: 'application/zip' });
      const res = await saveBlob(blob, `${folderName}.zip`);
      return {
        label: res?.filename ?? `${folderName}.zip`,
        count,
        viaPicker: res?.viaPicker ?? false,
        cancelled: res === null,
      };
    },
  };
}

/** Per-file sink (last resort): save each file separately, offering the picker
 * only for the first (mirrors the multi-format save in the old flow). */
function createPerFileSink(folderName: string): RecordingSink {
  const pending: { name: string; data: Blob | string }[] = [];
  return {
    kind: 'perFile',
    async add(name, data) {
      pending.push({ name, data });
    },
    async close() {
      let first = true;
      let viaPicker = false;
      for (const { name, data } of pending) {
        const blob = typeof data === 'string' ? new Blob([data], { type: 'application/octet-stream' }) : data;
        const res = await saveBlob(blob, name, { allowPicker: first });
        if (res?.viaPicker) viaPicker = true;
        first = false;
      }
      return { label: `${folderName} (${pending.length} files)`, count: pending.length, viaPicker };
    },
  };
}

/**
 * Build the sink for a take. `chooseSinkKind` already picks `zip` when no folder
 * picker exists, so a `directory` kind means the picker IS available — dismissing
 * it here is a deliberate user cancel (this happens at record START, before
 * anything is captured), so {@link SinkCancelled} propagates for the caller to
 * abort the take rather than silently recording somewhere the user didn't choose.
 */
export async function createRecordingSink(kind: SinkKind, folderName: string): Promise<RecordingSink> {
  if (kind === 'directory') return createDirectorySink(folderName);
  if (kind === 'perFile') return createPerFileSink(folderName);
  return createZipSink(folderName);
}
