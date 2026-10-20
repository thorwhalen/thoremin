/**
 * Where the hand model runs (#326, step 5 of the 2026-10-05 timing plan): on the main
 * thread, as it always did, or in a Web Worker, so the engine's tick is not blocked for the
 * length of an inference.
 *
 * What the worker buys is a REGULAR tick, not lead. `detectForVideo` is synchronous: on the
 * main thread it blocks every animation frame it overlaps (21 ms a hand frame on an M1's GPU,
 * about 100 ms on the CPU delegate), so the overlay, the tick and everything else on the page
 * wait for it. In a worker it overlaps them instead.
 *
 * The frame and its stamp. The capture time does not travel with a frame (a `VideoFrame`'s
 * metadata has no `captureTime`, and a worker's `performance.now()` has its own origin), so
 * the main thread's frame pump stays the clock: inside its callback, `createImageBitmap`
 * snapshots the frame the element shows NOW, which is the frame the pump stamped, so frame
 * and stamp are paired by construction. The bitmap is transferred to the worker, which
 * infers on it with the stamp's own time and posts the landmarks back. While the worker is
 * busy the frames offered are dropped, not queued (see {@link workerHandRunner}), and counted
 * in the next result's `skipped`, as the main thread's own busy frames are.
 *
 * The seam. A {@link HandRunner} takes frames and says what it found; `webcam-hands` does
 * not know which one it has. {@link createHandRunner} picks: the worker where the browser can
 * host one (a `Worker`, `createImageBitmap`, and an `OffscreenCanvas` with WebGL2 inside the
 * worker for the GPU delegate), the main thread otherwise, and the main thread again if the
 * worker fails to start or dies later. The fallback is automatic and says so once. A GPU that
 * fails in the worker tries the main thread's GPU first (a blocking 20-odd ms a frame at full
 * rate beats the CPU delegate's 40 to 100 ms anywhere), then the CPU delegate in the worker
 * (where it does not block the tick), then the CPU on the main thread.
 *
 * Dev mode (`vite dev`) cannot run the worker: Vite serves a classic worker unbundled, and
 * its `import` is a syntax error there, so `?hands.runner=worker` falls back to the main
 * thread (and says so). Measure the worker on a build (`npm run build`, `vite preview`).
 *
 * Not done here (later rungs of the plan's frame-transport ladder): Chromium's
 * `MediaStreamTrackProcessor`, which hands the worker frames without a main-thread copy, and
 * Safari's in-worker track. Both need the frame-to-stamp pairing measured first.
 */
import { z } from 'zod';
import type { FrameStamp } from './frame_pump';
import type { HandLandmarkerResultLike } from './webcam_hands.schema';
import type { Delegate } from './delegate';

export const HandRunnerChoiceSchema = z.enum(['auto', 'worker', 'main']);
/** `auto`: the worker where the browser can host it, else the main thread. */
export type HandRunnerChoice = z.infer<typeof HandRunnerChoiceSchema>;

/** What a runner found in one frame, with the stamp of the frame it ran on. */
export interface HandResult {
  result: HandLandmarkerResultLike;
  width: number;
  height: number;
  stamp: FrameStamp;
}

export interface HandRunner {
  /** Which thread this runner infers on. */
  readonly where: 'main' | 'worker';
  /** Offer the frame the element shows now, with its stamp. `false`: not consumed (not ready
   *  yet), offer again. A result arrives through the runner's `onResult`, now or later. */
  offer(video: HTMLVideoElement, stamp: FrameStamp): boolean;
  /** Look for `n` hands from the next frame on (#325). Rejects if the model could not change. */
  setNumHands(n: number): Promise<void>;
  close(): void;
}

/** How a runner reaches MediaPipe: what the hand node's own loader would create. */
export interface LandmarkerOptions {
  wasmBase: string;
  modelUrl: string;
  delegate: Delegate;
  numHands: number;
}

/** The minimal runtime surface of tasks-vision's `HandLandmarker` used by a runner. */
export interface HandLandmarkerLike {
  detectForVideo(image: TexImageSource | ImageBitmap, timestampMs: number): HandLandmarkerResultLike;
  /** Reconfigures the live landmarker; a `numHands` change rebuilds its graph, not the model. */
  setOptions(options: { numHands?: number }): Promise<void>;
  close(): void;
}

/** Loads a landmarker on THIS thread (the main-thread runner's loader). A GPU request falls
 *  back to the CPU delegate on this thread unless `cpuFallback` is false (the runner then
 *  chooses where the CPU delegate runs, #326). */
export type LoadLandmarker = (options: LandmarkerOptions, opts?: { cpuFallback?: boolean }) => Promise<HandLandmarkerLike>;

/** The main thread: today's path, `detectForVideo` on the element itself. */
export function mainHandRunner(landmarker: HandLandmarkerLike, onResult: (r: HandResult) => void): HandRunner {
  return {
    where: 'main',
    offer(video, stamp) {
      try {
        const result = landmarker.detectForVideo(video, stamp.tMs);
        onResult({ result, width: video.videoWidth, height: video.videoHeight, stamp });
      } catch {
        /* transient inference error; the node keeps its last frame */
      }
      return true;
    },
    setNumHands: (n) => Promise.resolve().then(() => landmarker.setOptions({ numHands: n })),
    close: () => landmarker.close(),
  };
}

// ---- The worker's protocol (both sides import these types) ---------------------------

export type ToWorker =
  | { type: 'init'; options: LandmarkerOptions }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; tMs: number }
  | { type: 'numHands'; id: number; n: number }
  | { type: 'close' };

export type FromWorker =
  | { type: 'ready'; delegate: Delegate }
  | { type: 'init-error'; message: string }
  | { type: 'result'; id: number; result: HandLandmarkerResultLike }
  | { type: 'frame-error'; id: number }
  | { type: 'numHands-done'; id: number; error?: string };

/** The part of a `Worker` the client uses (a seam for tests). */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<FromWorker>) => void) | null;
  onerror: ((ev: ErrorEvent | Event) => void) | null;
  onmessageerror?: ((ev: MessageEvent) => void) | null;
}

/** Everything the worker runner takes from the browser, injectable for tests. */
export interface WorkerRunnerDeps {
  createWorker: () => WorkerLike;
  createImageBitmap: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  /** How long a frame may go unanswered before the worker counts as hung (ms). */
  frameTimeoutMs?: number;
  /** How many frames in a row may fail before the worker counts as broken. */
  maxFrameErrors?: number;
  /** How long the worker may take to say it is ready (ms), the model's download included. */
  loadTimeoutMs?: number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** A frame unanswered this long means a hung worker (a stuck GPU process, a bitmap that never
 *  came): it is treated as dead, so the main thread takes over rather than the instrument
 *  holding its last pose in silence. Far above any inference seen (about 1 s, 4x throttled). */
export const WORKER_FRAME_TIMEOUT_MS = 5000;
/** A worker not ready after this long (a GPU process hung building the graph) counts as dead,
 *  so the hand model loads elsewhere rather than never. The model's download is inside it. */
export const WORKER_LOAD_TIMEOUT_MS = 30_000;
/** This many failed frames in a row (a lost WebGL context in the worker fails every one)
 *  means a broken worker: the main thread takes over. About a second of camera frames. */
export const WORKER_MAX_FRAME_ERRORS = 30;

/** The one frame in the worker. */
interface InFlight {
  id: number;
  width: number;
  height: number;
  stamp: FrameStamp;
}

/**
 * The worker runner. Resolves once the worker's landmarker is loaded, rejects if it cannot
 * start (the caller falls back to the main thread). `onDead` is called once if the worker
 * dies afterwards; the runner then takes no more frames.
 *
 * One frame at a time, and never a queued one: a frame offered while the worker is busy is
 * dropped (and counted in the next result's `skipped`), and the worker takes the first frame
 * offered after it frees. A frame held for the worker would be up to a camera period old by
 * the time it ran: measured on the CPU delegate, holding the newest frame added 19 ms (p50)
 * to capture-to-tick for a few more frames a second. Dropping it also spares the main thread
 * a bitmap for every frame the worker never sees.
 */
export function workerHandRunner(
  options: LandmarkerOptions,
  onResult: (r: HandResult) => void,
  deps: WorkerRunnerDeps,
  onDead: (reason: unknown) => void = () => {},
): Promise<HandRunner> {
  const worker = deps.createWorker();
  let ready = false;
  let dead = false;
  let closed = false;
  let seq = 0;
  /** The frame being snapshotted or inferred; null when the worker is free. */
  let busy: InFlight | null = null;
  /** Frames dropped since the last one sent: added to its `skipped`. */
  let dropped = 0;
  /** Hand-count changes in flight, each with its watchdog: `setOptions` rebuilds the graph
   *  in the worker, and a rebuild that hangs would otherwise hold the instrument on its last
   *  pose for good (the pump offers no frame while a change is in flight). */
  const changes = new Map<number, { resolve: () => void; reject: (e: Error) => void; watchdog: unknown }>();
  let changeId = 0;
  /** Failed frames in a row. */
  let frameErrors = 0;
  const frameTimeoutMs = deps.frameTimeoutMs ?? WORKER_FRAME_TIMEOUT_MS;
  const maxFrameErrors = deps.maxFrameErrors ?? WORKER_MAX_FRAME_ERRORS;
  const setTimer = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  /** The watchdog on the frame in flight. */
  let watchdog: unknown = null;
  const stopped = (): boolean => dead || closed;
  /** The worker is free again: the frame in flight is over, answered or not. */
  const free = (): void => {
    busy = null;
    if (watchdog !== null) clearTimer(watchdog);
    watchdog = null;
  };

  const rejectChanges = (err: Error): void => {
    for (const c of changes.values()) {
      clearTimer(c.watchdog);
      c.reject(err);
    }
    changes.clear();
  };

  const die = (reason: unknown): void => {
    if (stopped()) return;
    dead = true;
    free();
    rejectChanges(new Error('the hand worker stopped'));
    worker.terminate();
    if (ready) onDead(reason);
  };

  const runner: HandRunner = {
    where: 'worker',
    offer(video, stamp) {
      if (!ready || stopped()) return false;
      if (busy) {
        dropped += 1 + stamp.skipped;
        return true;
      }
      // The pump's stamp, with the frames dropped since the last one sent.
      const frame: InFlight = { id: ++seq, width: video.videoWidth, height: video.videoHeight, stamp: dropped ? { ...stamp, skipped: stamp.skipped + dropped } : stamp };
      dropped = 0;
      busy = frame;
      watchdog = setTimer(() => {
        if (busy === frame) die(new Error(`the hand worker did not answer a frame in ${frameTimeoutMs} ms`));
      }, frameTimeoutMs);
      // Snapshotted NOW, inside the pump's callback: the frame the element shows is the one
      // the pump stamped.
      deps
        .createImageBitmap(video)
        .then((bitmap) => {
          if (stopped() || busy !== frame) {
            bitmap.close();
            return;
          }
          worker.postMessage({ type: 'frame', id: frame.id, bitmap, tMs: frame.stamp.tMs }, [bitmap]);
        })
        .catch(() => {
          // The element had no frame to give (a resize, a stall): nothing to infer. The
          // drops this frame carried, and the frame itself, count against the next one.
          if (busy === frame) {
            dropped += 1 + frame.stamp.skipped;
            free();
          }
        });
      return true;
    },
    setNumHands(n) {
      if (dead || closed) return Promise.reject(new Error('the hand worker stopped'));
      const id = ++changeId;
      return new Promise<void>((resolve, reject) => {
        const watchdog = setTimer(() => {
          if (changes.has(id)) die(new Error(`the hand worker did not change its hand count in ${frameTimeoutMs} ms`));
        }, frameTimeoutMs);
        changes.set(id, { resolve, reject, watchdog });
        worker.postMessage({ type: 'numHands', id, n });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      free();
      rejectChanges(new Error('the hand runner closed'));
      try {
        worker.postMessage({ type: 'close' });
      } finally {
        worker.terminate();
      }
    },
  };

  return new Promise<HandRunner>((resolve, reject) => {
    /** The load's timer, cleared once the worker answers the init. */
    let loading: unknown = null;
    worker.onmessage = (ev) => {
      const m = ev.data;
      if ((m.type === 'ready' || m.type === 'init-error') && loading !== null) {
        clearTimer(loading);
        loading = null;
      }
      if (m.type === 'ready') {
        ready = true;
        resolve(runner);
      } else if (m.type === 'init-error') {
        die(new Error(m.message));
        reject(new Error(m.message));
      } else if (m.type === 'result' || m.type === 'frame-error') {
        const done = busy && busy.id === m.id ? busy : null;
        if (!done) return;
        free();
        if (m.type === 'result') {
          frameErrors = 0;
          if (!stopped()) onResult({ result: m.result, width: done.width, height: done.height, stamp: done.stamp });
        } else {
          // A failed frame is a frame nobody saw: it and the drops it carried count
          // against the next result's `skipped`.
          dropped += 1 + done.stamp.skipped;
          if (++frameErrors >= maxFrameErrors) die(new Error(`${frameErrors} hand frames in a row failed in the worker`));
        }
      } else if (m.type === 'numHands-done') {
        const c = changes.get(m.id);
        changes.delete(m.id);
        if (c) clearTimer(c.watchdog);
        if (m.error === undefined) c?.resolve();
        else c?.reject(new Error(m.error));
      }
    };
    const fail = (ev: unknown): void => {
      // Handled here: not re-reported as an uncaught error of the page.
      (ev as Event | undefined)?.preventDefault?.();
      const reason = typeof ErrorEvent !== 'undefined' && ev instanceof ErrorEvent ? ev.error ?? ev.message : ev;
      if (!ready) reject(reason instanceof Error ? reason : new Error('the hand worker could not start'));
      die(reason);
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    const loadTimeoutMs = deps.loadTimeoutMs ?? WORKER_LOAD_TIMEOUT_MS;
    loading = setTimer(() => {
      if (ready || stopped()) return;
      const reason = new Error(`the hand worker was not ready in ${loadTimeoutMs} ms`);
      reject(reason);
      die(reason);
    }, loadTimeoutMs);
    worker.postMessage({ type: 'init', options });
  });
}

/** How often, and how far apart, the main-thread replacement for a dead worker is tried again
 *  when it fails to load (#737): three more tries over about a minute cover a dropped connection
 *  coming back, without a reload storm. */
export const MAIN_REPLACEMENT_RETRIES = 3;
export const MAIN_REPLACEMENT_RETRY_MS = 20_000;

/** Whether this browser can host the worker runner at all (WebGL2 is checked inside it). */
export function canHostHandWorker(g: typeof globalThis = globalThis): boolean {
  return typeof g.Worker === 'function' && typeof g.createImageBitmap === 'function' && typeof g.OffscreenCanvas === 'function';
}

export interface CreateHandRunnerDeps {
  /** Loads a landmarker on the main thread (the fallback, and `main`). */
  loadMain: LoadLandmarker;
  /** The worker runner's browser dependencies; absent where the browser has none. */
  worker?: WorkerRunnerDeps;
}

/**
 * The runner for `choice`: the worker when chosen (or `auto` and possible) and it starts,
 * the main thread otherwise. A worker that dies later is replaced by the main thread, with the
 * same `onResult`, without the caller noticing (beyond a console line).
 */
export async function createHandRunner(
  choice: HandRunnerChoice,
  options: LandmarkerOptions,
  onResult: (r: HandResult) => void,
  deps: CreateHandRunnerDeps,
): Promise<HandRunner> {
  const main = async (): Promise<HandRunner> => mainHandRunner(await deps.loadMain(options), onResult);
  if (choice === 'main' || !deps.worker) return main();

  // The live runner behind a stable facade, so a worker that dies is swapped for the main
  // thread in place. `numHands` follows the facade, so the replacement looks for the same count.
  let current: HandRunner | null = null;
  let closed = false;
  let numHands = options.numHands;
  const facade: HandRunner = {
    get where() {
      return current?.where ?? 'main';
    },
    offer: (video, stamp) => current?.offer(video, stamp) ?? false,
    setNumHands: async (n) => {
      const r = current;
      // Between a dead worker and its replacement: the replacement is made with this count.
      if (!r) {
        numHands = n;
        return;
      }
      try {
        await r.setNumHands(n);
        numHands = n;
      } catch (err) {
        // The worker died during the change: the same, the replacement takes the count.
        if (current === r) throw err;
        numHands = n;
      }
    },
    close: () => {
      closed = true;
      current?.close();
      current = null;
    },
  };
  /** The replacement for a worker that ran with `o`: the GPU cascade may have left a CPU
   *  worker running after the main thread's GPU failed, and that GPU is not tried again. */
  const setTimer = deps.worker?.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  /** Load the main-thread replacement; a load that fails (offline: the model is fetched again
   *  on this thread; a wasm refused here) is tried again a few times, spaced out, rather than
   *  leaving the hands frozen for the session with only a console line (#737). */
  const replaceOnMain = (o: LandmarkerOptions, attempt: number): void => {
    const loading = numHands;
    void deps
      .loadMain({ ...o, numHands: loading })
      .then((lm) => {
        if (closed) {
          lm.close();
          return;
        }
        const replacement = mainHandRunner(lm, onResult);
        current = replacement;
        // The count changed while the main thread was loading.
        if (numHands !== loading)
          void replacement.setNumHands(numHands).catch((err) => console.warn('[thoremin] the hand model could not change its hand count', err));
      })
      .catch((err) => {
        if (closed) return;
        if (attempt >= MAIN_REPLACEMENT_RETRIES) {
          console.error('[thoremin] the hand model could not load on the main thread either; the hands stay off', err);
          return;
        }
        console.warn(`[thoremin] the hand model could not load on the main thread (retry ${attempt + 1} of ${MAIN_REPLACEMENT_RETRIES} in ${MAIN_REPLACEMENT_RETRY_MS} ms)`, err);
        setTimer(() => {
          if (!closed && current === null) replaceOnMain(o, attempt + 1);
        }, MAIN_REPLACEMENT_RETRY_MS);
      });
  };
  const onDeadFor = (o: LandmarkerOptions) => (reason: unknown): void => {
    console.warn('[thoremin] the hand worker stopped; the hand model moves to the main thread', reason);
    current = null;
    replaceOnMain(o, 0);
  };
  const inWorker = async (o: LandmarkerOptions): Promise<HandRunner> => {
    const r = await workerHandRunner(o, onResult, deps.worker!, onDeadFor(o));
    console.info(`[thoremin] the hand model runs in a Web Worker (${o.delegate})`);
    return r;
  };
  try {
    current = await inWorker(options);
  } catch (err) {
    if (options.delegate !== 'GPU') {
      console.warn('[thoremin] the hand worker could not start; the hand model runs on the main thread', err);
      current = await main();
    } else {
      // The GPU failed in the worker (#326). The main thread's GPU first: a blocking 20-odd ms a
      // frame at full rate beats the CPU delegate's 40 to 100 ms anywhere. Only when that fails
      // too does the CPU delegate run, in the worker, where it does not block the tick, and on
      // the main thread last.
      console.warn('[thoremin] the hand worker could not start on the GPU; trying the GPU on the main thread', err);
      try {
        current = mainHandRunner(await deps.loadMain(options, { cpuFallback: false }), onResult);
      } catch (mainGpuErr) {
        console.warn('[thoremin] the GPU delegate failed on the main thread too; the CPU delegate runs in the worker', mainGpuErr);
        const cpu = { ...options, delegate: 'CPU' as const };
        try {
          current = await inWorker(cpu);
        } catch (cpuErr) {
          console.warn('[thoremin] the hand worker could not start on the CPU either; the hand model runs on the main thread', cpuErr);
          current = mainHandRunner(await deps.loadMain(cpu), onResult);
        }
      }
    }
  }
  return facade;
}
