/**
 * The stills of a hold (#385 E3): taken AT CAPTURE, from the live camera, cropped to the
 * modality's region (the face box), the moment the take sees a hold emitted; kept in memory
 * until a save files them in IndexedDB, so a saved categorizer shows its faces after a reload.
 * No video is recorded and nothing is seeked: a pause, a synthetic source and a merge work the
 * same way, and the raw video of the player's face never exists in memory.
 *
 * Three pieces, each a seam:
 * - {@link openLiveFrames}: a hidden `<video>` over the source's stream, a frame drawn from it
 *   on demand (a test passes its own opener).
 * - {@link ThumbStore}: a key-value store for the stills, IndexedDB by default
 *   ({@link idbThumbStore}, the precedent is the recorder's folder handle store), an in-memory
 *   one where IndexedDB is absent (a test, a private window that refuses it).
 * - Keys are HOLD IDS ({@link holdId}: `<takeId>:<n>`), the sample ids of the categorizer
 *   file: unique across takes, so a still is filed once, a merge or a move never re-files one,
 *   and two records sharing a hold share its still. A v1 record's samples are given its old
 *   keys as ids on migration (`models.ts`), so its stills are found where they are.
 */
import type { PixelBox, PixelPoint } from '@thoremin/sdk-ui/enroll/modality';

export interface ThumbStore {
  get(key: string): Promise<Blob | null>;
  put(key: string, blob: Blob): Promise<void>;
  /** Remove these keys (absent ones are ignored). */
  remove(keys: readonly string[]): Promise<void>;
}

/** Hold `n` of take `takeId`: its sample id, and its still's key. */
// The one definition is the record schema's (a v1 record's stills are found by it there).
export { holdId } from '@thoremin/sdk/enroll/record';

export function memoryThumbStore(): ThumbStore {
  const m = new Map<string, Blob>();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, b) => void m.set(k, b),
    remove: async (keys) => {
      for (const k of keys) m.delete(k);
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
    remove: (keys) =>
      run<void>(
        'readwrite',
        (s) => {
          for (const k of keys) s.delete(k);
        },
        (m) => m.remove(keys),
      ),
  };
}

export interface GrabOptions {
  /** The still's width in pixels (height keeps the crop's aspect). */
  width?: number;
  /** JPEG quality, 0..1. */
  quality?: number;
  /** Mirror the still, as the instrument's view is mirrored. */
  mirror?: boolean;
}

export const GRAB_DEFAULTS = { width: 120, quality: 0.8, mirror: true, overlayColor: 'rgba(120, 220, 255, 0.9)', overlayWidth: 1.5 } as const;

/** A live stream's frames, drawn on demand. */
export interface LiveFrames {
  /** The current frame as a still, cropped to `crop(size)` (null: the whole frame), with
   *  `overlay(size)`'s polylines (video pixels) drawn over it (#385 E8: a hand skeleton), or
   *  null when no frame is showing yet. */
  grab(crop?: ((size: { width: number; height: number }) => PixelBox | null) | null, overlay?: ((size: { width: number; height: number }) => readonly (readonly PixelPoint[])[] | null) | null): Promise<Blob | null>;
  /** Stop drawing and let the stream go (never stops its tracks: the instrument owns the camera). */
  close(): void;
}

/** What opens a stream for stills (null: it cannot be read here). */
export type FrameOpener = (stream: MediaStream, options?: GrabOptions) => LiveFrames | null;

/** `box` clamped into a `width` x `height` frame, or null when nothing of it is inside. */
export function clampBox(box: PixelBox, width: number, height: number): PixelBox | null {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(width, box.x + box.w);
  const y1 = Math.min(height, box.y + box.h);
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** The browser opener: a hidden, muted `<video>` playing the stream, drawn into a canvas. */
export const openLiveFrames: FrameOpener = (stream, options = {}) => {
  if (typeof document === 'undefined') return null;
  const o = { ...GRAB_DEFAULTS, ...options };
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void video.play().catch(() => undefined);
  const canvas = document.createElement('canvas');
  return {
    async grab(crop, overlay) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // HAVE_CURRENT_DATA: a frame to draw.
      if (video.readyState < 2 || !vw || !vh) return null;
      const asked = crop?.({ width: vw, height: vh }) ?? null;
      const box = (asked && clampBox(asked, vw, vh)) ?? { x: 0, y: 0, w: vw, h: vh };
      const w = o.width;
      const h = Math.max(1, Math.round((w * box.h) / box.w));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.save();
      if (o.mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, w, h);
      const lines = overlay?.({ width: vw, height: vh }) ?? null;
      if (lines && lines.length > 0) drawPolylines(ctx, lines, box, w / box.w, o);
      ctx.restore();
      return new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', o.quality));
    },
    close() {
      video.pause();
      video.srcObject = null;
    },
  };
};

/** `lines` (video pixels) drawn over a still whose crop is `box`, drawn at `scale` (still pixels
 *  per video pixel), in the still's own (possibly mirrored) transform. */
function drawPolylines(ctx: CanvasRenderingContext2D, lines: readonly (readonly PixelPoint[])[], box: PixelBox, scale: number, o: { overlayColor: string; overlayWidth: number }): void {
  ctx.strokeStyle = o.overlayColor;
  ctx.lineWidth = o.overlayWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const line of lines) {
    if (line.length < 2) continue;
    ctx.beginPath();
    line.forEach((p, i) => {
      const x = (p.x - box.x) * scale;
      const y = (p.y - box.y) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
