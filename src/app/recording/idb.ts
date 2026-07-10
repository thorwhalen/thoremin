/**
 * Minimal IndexedDB store for the picked recording directory handle (#88). A
 * `FileSystemDirectoryHandle` can't be JSON-serialized (so it can't live in the
 * localStorage session config), but it IS structured-cloneable, so IndexedDB can
 * persist it for silent reuse across takes — the user grants a folder once, then
 * subsequent recordings reuse it after a single permission re-grant.
 *
 * This is the ONLY IndexedDB usage in the app; kept deliberately tiny and
 * feature-detected (no-ops when IndexedDB is absent, e.g. the Node test runtime).
 */

const DB_NAME = 'thoremin-recording';
const STORE = 'handles';
const DIR_KEY = 'dir';

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Persist the picked directory handle for reuse (best-effort; swallows errors). */
export async function saveDirHandle(handle: unknown): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await withStore('readwrite', (s) => s.put(handle, DIR_KEY));
  } catch {
    /* IndexedDB unavailable / private mode — non-fatal, we just re-pick. */
  }
}

/** Load the previously-saved directory handle, or null if none / unavailable. */
export async function loadDirHandle<T = unknown>(): Promise<T | null> {
  if (!idbAvailable()) return null;
  try {
    return (await withStore<T | undefined>('readonly', (s) => s.get(DIR_KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Forget the saved directory handle (e.g. after a permission failure). */
export async function clearDirHandle(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await withStore('readwrite', (s) => s.delete(DIR_KEY));
  } catch {
    /* non-fatal */
  }
}
