/**
 * Exemplar frames (#330 P2): grabbed by seeking the take's kept video to each exemplar's time,
 * drawn small, and stored in IndexedDB so a saved categorizer shows its faces after a reload
 * (the video itself is not kept: the stills are what the grid needs).
 *
 * Two pieces, each a seam:
 * - {@link grabFrames}: seek a video blob and draw the frames at the given times (the browser's
 *   `<video>` + canvas; a test passes its own grabber).
 * - {@link ThumbStore}: a key-value store for the stills, IndexedDB by default
 *   ({@link idbThumbStore}, the precedent is the recorder's folder handle store), an in-memory
 *   one where IndexedDB is absent (a test, a private window that refuses it).
 *
 * Keys are `<takeId>:<sample index>`; a categorizer's samples keep the take's order, so a saved
 * model finds its stills by its take id and its exemplar indices.
 */

export interface ThumbStore {
  get(key: string): Promise<Blob | null>;
  put(key: string, blob: Blob): Promise<void>;
  /** Remove every key that starts with `prefix`. */
  removePrefix(prefix: string): Promise<void>;
}

export const thumbKey = (takeId: string, index: number): string => `${takeId}:${index}`;

export function memoryThumbStore(): ThumbStore {
  const m = new Map<string, Blob>();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, b) => void m.set(k, b),
    removePrefix: async (p) => {
      for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k);
    },
  };
}

const DB_NAME = 'thoremin-faces';
const STORE = 'thumbs';

/** IndexedDB, or memory when it is unavailable or refuses to open. */
export function idbThumbStore(): ThumbStore {
  if (typeof indexedDB === 'undefined') return memoryThumbStore();
  let fallback: ThumbStore | null = null;
  const open = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void, viaMemory: (m: ThumbStore) => Promise<T>): Promise<T> => {
    const db = await open;
    if (!db) return viaMemory((fallback ??= memoryThumbStore()));
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: async (k) => ((await run<unknown>('readonly', (s) => s.get(k), (m) => m.get(k))) as Blob | undefined) ?? null,
    put: (k, b) => run<void>('readwrite', (s) => void s.put(b, k), (m) => m.put(k, b)),
    removePrefix: (p) =>
      run<void>(
        'readwrite',
        (s) => void s.delete(IDBKeyRange.bound(p, `${p}￿`)),
        (m) => m.removePrefix(p),
      ),
  };
}

export interface GrabOptions {
  /** The still's width in pixels (height keeps the video's aspect). */
  width?: number;
  /** JPEG quality, 0..1. */
  quality?: number;
  /** Mirror the frame, as the instrument's view is mirrored. */
  mirror?: boolean;
}

export const GRAB_DEFAULTS = { width: 120, quality: 0.8, mirror: true } as const;

/** What turns (blob, times in seconds) into stills, in the same order (null where a frame failed). */
export type FrameGrabber = (video: Blob, seconds: readonly number[], options?: GrabOptions) => Promise<(Blob | null)[]>;

const once = (el: HTMLElement, event: string, ms = 4000): Promise<boolean> =>
  new Promise((resolve) => {
    const done = (ok: boolean) => {
      el.removeEventListener(event, on);
      clearTimeout(timer);
      resolve(ok);
    };
    const on = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    el.addEventListener(event, on);
  });

/**
 * The browser grabber: a hidden `<video>` over the blob, seeked to each time in turn. A recorded
 * WebM often reports an infinite duration until it has been read to the end, so it is first
 * seeked far past the end, which makes the browser find the real one.
 */
export const grabFrames: FrameGrabber = async (blob, seconds, options = {}) => {
  const o = { ...GRAB_DEFAULTS, ...options };
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    if (video.readyState < 1 && !(await once(video, 'loadedmetadata'))) return seconds.map(() => null);
    if (!Number.isFinite(video.duration)) {
      video.currentTime = 1e9;
      await once(video, 'seeked');
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const w = o.width;
    const h = Math.max(1, Math.round((w * (video.videoHeight || 3)) / (video.videoWidth || 4)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return seconds.map(() => null);
    const out: (Blob | null)[] = [];
    for (const s of seconds) {
      video.currentTime = Math.min(Math.max(0, s), Math.max(0, duration - 0.05));
      if (!(await once(video, 'seeked'))) {
        out.push(null);
        continue;
      }
      ctx.save();
      if (o.mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
      out.push(await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', o.quality)));
    }
    return out;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
};
