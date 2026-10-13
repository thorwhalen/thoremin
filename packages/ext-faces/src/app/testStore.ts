/**
 * Testing a face categorizer live (#330 P3): the player makes faces and sees what the
 * categorizer reads (which category, the memberships, "none of these"), under the tuning they
 * are setting. A zustand store the panel renders, with its dependencies injected like the
 * session's (`./sessionStore.ts`), so a test drives it with the synthetic face.
 *
 * The hot-path split: the poll reads the live vector at frame rate and feeds the reader (its
 * hysteresis needs every frame); the store is told at most every `publishMs`, or at once when
 * the settled category changes (what a person can see change).
 *
 * While testing it claims the face feature groups and hushes the instrument under its own owner
 * (`faces-test`), not the session's, so ending a test never releases a recording's claim.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { createLiveReader, type LiveModel, type LiveReader, type LiveReading } from '../lib/live';
import type { FaceSource } from './sources';

export interface FaceTestDeps {
  source: () => FaceSource;
  /** Claim (true) or release the face features and the instrument's quiet. */
  claim: (on: boolean) => void;
  /** Engine-clock ms. */
  now: () => number;
  pollMs: number;
  publishMs: number;
}

export const FACE_TEST_DEFAULTS = {
  pollMs: 33,
  publishMs: 100,
  /** Frames averaged into a correction ("this face is X"): about a quarter second. */
  captureFrames: 8,
} as const;

export interface FaceTestState {
  running: boolean;
  /** The latest reading, or null before one (or while no face is in view). */
  reading: LiveReading | null;
  /** No face in the latest frame (the readout says so instead of guessing). */
  noFace: boolean;
  /** Start reading live faces against `live`. */
  start(live: LiveModel): void;
  /** Swap in a re-tuned or corrected model without stopping. */
  retune(live: LiveModel): void;
  stop(): void;
  /** The mean of the last few raw live faces (for a correction), or null with no face. */
  capture(): FeatureVector | null;
}

/** Whether `v` carries any of the model's features (a frame with no face carries none). */
const hasFace = (v: FeatureVector, features: readonly string[]) => features.some((f) => Number.isFinite(v[f]));

function meanOf(vectors: readonly FeatureVector[]): FeatureVector {
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  for (const v of vectors)
    for (const [k, x] of Object.entries(v)) {
      if (!Number.isFinite(x)) continue;
      sum[k] = (sum[k] ?? 0) + x;
      n[k] = (n[k] ?? 0) + 1;
    }
  return Object.fromEntries(Object.keys(sum).map((k) => [k, sum[k] / n[k]]));
}

export function createFaceTestStore(deps: FaceTestDeps): StoreApi<FaceTestState> {
  let source: FaceSource | null = null;
  let reader: LiveReader | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let claimed = false;
  let lastPublish = -Infinity;
  const recent: FeatureVector[] = [];

  return createStore<FaceTestState>()((set, get) => {
    const tick = () => {
      if (!source || !reader) return;
      const live = source.read();
      const features = reader.live.model.features;
      const now = deps.now();
      if (!live || !hasFace(live.vector, features)) {
        if (!get().noFace) set({ noFace: true, reading: null });
        recent.length = 0;
        return;
      }
      recent.push(live.vector);
      if (recent.length > FACE_TEST_DEFAULTS.captureFrames) recent.shift();
      const reading = reader.push(live.vector);
      const prev = get().reading;
      if (get().noFace || !prev || prev.categoryId !== reading.categoryId || prev.rejected !== reading.rejected || now - lastPublish >= deps.publishMs) {
        lastPublish = now;
        set({ reading, noFace: false });
      }
    };
    return {
      running: false,
      reading: null,
      noFace: false,

      start(live) {
        get().stop();
        source = deps.source();
        reader = createLiveReader(live);
        deps.claim(true);
        claimed = true;
        recent.length = 0;
        lastPublish = -Infinity;
        timer = setInterval(tick, deps.pollMs);
        set({ running: true, reading: null, noFace: false });
      },

      retune(live) {
        if (!get().running) return;
        reader = createLiveReader(live);
        lastPublish = -Infinity;
      },

      stop() {
        if (timer) clearInterval(timer);
        timer = null;
        if (claimed) deps.claim(false);
        claimed = false;
        source?.dispose();
        source = null;
        reader = null;
        recent.length = 0;
        if (get().running) set({ running: false, reading: null, noFace: false });
      },

      capture() {
        return recent.length > 0 ? meanOf(recent) : null;
      },
    };
  });
}
