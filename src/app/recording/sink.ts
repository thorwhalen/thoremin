/**
 * RecordingSink (#88) — a three-tier destination for the files of one recording
 * folder, generalizing the single-file `saveBlob` (`./save`) into an interface
 * with `add(name, data)` + `close()`:
 *
 *   1. directory — File System Access API: a real folder with N streamed files
 *      (Chromium). The folder is picked and remembered by `./folder` (#257), the
 *      one mechanism the trainer's control shares.
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
import { acquireRecordingFolder, forgetRecordingFolder, type FsDirHandle } from './folder';
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
  /** The folder the take is written into: the name asked for, or (directory sink) that
   *  name with a `-2`, `-3` ... suffix when a folder of that name already exists. */
  readonly folderName: string;
  /** Write one file into the recording folder. */
  add(name: string, data: Blob | string): Promise<void>;
  /** Finalize (flush/close/download) and return a toast label + file count. */
  close(): Promise<SinkResult>;
}

function toBytes(data: Blob | string): Promise<Uint8Array> {
  if (typeof data === 'string') return Promise.resolve(new TextEncoder().encode(data));
  return data.arrayBuffer().then((b) => new Uint8Array(b));
}

/** How many `-2`, `-3`, ... suffixes to try before giving up on a free name. */
const MAX_TAKE_SUFFIX = 999;

/**
 * Create a subfolder that did not exist before: `name`, else `name-2`, `name-3`, ...
 * A take name typed in the Record sheet is remembered and reused, and reopening its
 * folder would truncate the files the new take writes and keep the ones it doesn't,
 * mixing two takes (#355). Only a NotFoundError means the name is free.
 */
async function freshSubfolder(base: FsDirHandle, name: string): Promise<{ dir: FsDirHandle; name: string }> {
  for (let n = 1; n <= MAX_TAKE_SUFFIX; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    try {
      await base.getDirectoryHandle(candidate);
    } catch (e) {
      // A FILE of that name (TypeMismatchError) is taken too: try the next suffix.
      if ((e as { name?: string })?.name === 'TypeMismatchError') continue;
      if ((e as { name?: string })?.name !== 'NotFoundError') throw e;
      return { dir: await base.getDirectoryHandle(candidate, { create: true }), name: candidate };
    }
  }
  throw new Error(`No free folder name for "${name}" (tried up to -${MAX_TAKE_SUFFIX})`);
}

/**
 * The errors a folder handle throws once its folder is gone from disk: deleted or
 * renamed (`NotFoundError`, since creating a subfolder in an EXISTING folder never
 * reports one), or a handle the browser has invalidated (`InvalidStateError`).
 */
const VANISHED_FOLDER_ERRORS: ReadonlySet<string> = new Set(['NotFoundError', 'InvalidStateError']);

function folderVanished(e: unknown): boolean {
  return VANISHED_FOLDER_ERRORS.has((e as { name?: string })?.name ?? '');
}

/**
 * Directory sink: acquire the base folder (`./folder`: the remembered one, else the
 * picker), create the recording subfolder, and stream each file into it. Acquires
 * the handle up-front (at construction) so the folder prompt appears when recording
 * starts, not on stop. A name already taken gets a `-2`, `-3`, ... suffix. Throws {@link SinkCancelled} if the user dismisses the picker
 * (or no picker exists) so the caller can fall back to a zip.
 *
 * A remembered folder deleted or renamed on disk still reads `granted`, so it is
 * found out here, by the subfolder it refuses (#393 item 6): it is forgotten and the
 * picker offered once, in the same start, rather than failing this take and every
 * later one while the Trainer still names it.
 */
async function createDirectorySink(folderName: string): Promise<RecordingSink> {
  const subfolderIn = async (): Promise<{ dir: FsDirHandle; name: string }> => {
    const base = await acquireRecordingFolder();
    if (!base) throw new SinkCancelled();
    return freshSubfolder(base, folderName);
  };
  let made: { dir: FsDirHandle; name: string };
  try {
    made = await subfolderIn();
  } catch (e) {
    if (!folderVanished(e)) throw e;
    await forgetRecordingFolder();
    // The picker opens after several awaits here; if the click's activation has lapsed it throws SecurityError and this take fails, but the folder is already forgotten, so the next take offers the picker cleanly.
    made = await subfolderIn();
  }

  const { dir, name: label } = made;
  let count = 0;
  return {
    kind: 'directory',
    folderName: label,
    async add(name, data) {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
      count++;
    },
    async close() {
      return { label, count, viaPicker: true };
    },
  };
}

/** The zip's DEFLATE level (fflate's 0-9): its balanced default. A take is mostly
 *  already-compressed media, so a higher level buys little and costs time on close. */
const ZIP_LEVEL = 6;

/** Zip sink: accumulate `{folderName/name: bytes}` and, on close, lazily zip
 * (fflate) into one download. The zip preserves the one-folder mental model. */
function createZipSink(folderName: string): RecordingSink {
  const files: Record<string, Uint8Array> = {};
  let count = 0;
  return {
    kind: 'zip',
    folderName,
    async add(name, data) {
      files[`${folderName}/${name}`] = await toBytes(data);
      count++;
    },
    async close() {
      const { zipSync } = await import('fflate');
      const zipped = zipSync(files, { level: ZIP_LEVEL });
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
    folderName,
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
