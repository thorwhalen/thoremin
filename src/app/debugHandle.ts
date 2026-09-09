/**
 * The read-only debug handle the engine host publishes on `window.thoremin` (#209).
 *
 * Every gate in this repo runs in Node or jsdom; the one thing they cannot answer is
 * whether the BUILT bundle, in a real browser, actually plays. The browser smoke
 * harness (`smoke/`) answers it by asking the running app three things it could not
 * otherwise observe without scraping pixels: is the engine ticking (the live feature
 * vector's time advances), is the audio graph up (the AudioContext is running), and
 * what is a node emitting right now (`getOutput`). A person verifying a live change
 * by hand gets the same handle in the devtools console.
 *
 * Read-only by construction: getters over the engine and the resources bag, no
 * setters, nothing that writes a dial or the store (the command registry is the one
 * write path, #87). It exposes no secrets — the key store is not reachable from it.
 * Installed by `useEngine` when the engine is ready and removed on teardown, so a
 * torn-down engine is never reachable through a stale handle.
 */
import { readLiveVector } from './enroll/liveVector';

/** The slice of the engine the handle needs — the same read the per-frame bridges use. */
export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

export interface ThoreminDebugHandle {
  /** A node's latest output on a port, or undefined before the first tick. */
  getOutput(nodeId: string, port: string): unknown;
  /** The live feature vector's engine time in ms, or 0 before the first tick — rises
   *  only if clock → Applier → tick → nodes → tap all ran. */
  liveVectorTime(): number;
  /** The host audio graph, if the player has tapped to play. */
  audio(): { state: AudioContextState | null; masterGain: number | null };
}

export const DEBUG_HANDLE_KEY = 'thoremin';

declare global {
  interface Window {
    [DEBUG_HANDLE_KEY]?: ThoreminDebugHandle;
  }
}

/** Build the handle over an engine and the host resources bag. Pure; testable. */
export function makeDebugHandle(engine: OutputReader, resources: Record<string, unknown>): ThoreminDebugHandle {
  return Object.freeze({
    getOutput: (nodeId: string, port: string) => engine.getOutput(nodeId, port),
    liveVectorTime: () => readLiveVector()?.t ?? 0,
    audio: () => {
      const ac = resources.audioContext as AudioContext | undefined;
      const master = resources.masterGain as GainNode | undefined;
      return { state: ac?.state ?? null, masterGain: master?.gain.value ?? null };
    },
  });
}

/** Publish the handle on `window` (a no-op outside a browser). Returns the uninstaller. */
export function installDebugHandle(engine: OutputReader, resources: Record<string, unknown>): () => void {
  if (typeof window === 'undefined') return () => {};
  const handle = makeDebugHandle(engine, resources);
  window[DEBUG_HANDLE_KEY] = handle;
  return () => {
    if (window[DEBUG_HANDLE_KEY] === handle) delete window[DEBUG_HANDLE_KEY];
  };
}
