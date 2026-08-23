/**
 * The live feature-vector tap (#160) — how the trainer sees what the instrument sees.
 *
 * The DAG already computes a named scalar feature vector every tick (`faceVec.vector`
 * and `handVec.vector`, feeding the Lab meters). The trainer needs exactly that, in the
 * host. This is the one-way bridge.
 *
 * ## Why a module holder and not a zustand store
 *
 * This is written **per tick**, at frame rate. A zustand `set()` per tick would notify
 * subscribers and re-render React sixty times a second for a value no component needs at
 * that resolution — the same hot-path/human-frequency split the repo already enforces
 * between `useControls` (hot, read synchronously each tick) and the dials store (edits).
 * So the tap writes a plain module variable, and the panel *polls* it at UI rate while a
 * cue is running. The trainer is a human-frequency consumer of a hot signal, and the
 * cheapest correct shape for that is a holder plus a poll, not a subscription.
 *
 * Merging face and hand into ONE vector is the point, not a convenience: it is what makes
 * the trainer modality-general without knowing which modality is present. A missing
 * source simply contributes no keys.
 */
import type { NodeContext, Tap } from '@/dag';
import type { FeatureVector } from '@/enroll';

/** The edge keys the tap listens to — the catalog's two vector-producing nodes. */
export const FEATURE_VECTOR_EDGES = ['faceVec.vector', 'handVec.vector'] as const;

/** The latest merged vector, or null before the first tick with any source present. */
let latest: FeatureVector | null = null;
/** Tick time of the latest vector, in MILLISECONDS. The DAG clock (`ctx.time`) is in
 *  seconds; the trainer's sampler (`dwellMs`, `speedWindowMs`) is in ms, and v1
 *  passed the seconds through unconverted — a 220 ms dwell became 220 s, and the
 *  speed estimate (displacement / dt) was a thousand times too large, so nothing
 *  ever read as "held". Convert HERE, at the boundary, once. */
let latestT = 0;

/** Per-edge last value, so one absent source does not erase the other's keys. */
const byEdge = new Map<string, FeatureVector>();

/**
 * A DAG {@link Tap} that keeps {@link readLiveVector} current. Attach once at engine
 * construction and leave attached — it costs one object spread per tick and is the
 * only way the host can see the feature vector at all.
 */
export class LiveVectorTap implements Tap {
  onValue(key: string, value: unknown, ctx: NodeContext): void {
    if (!(FEATURE_VECTOR_EDGES as readonly string[]).includes(key)) return;
    if (!value || typeof value !== 'object') return;
    byEdge.set(key, value as FeatureVector);
    // Merge in a fixed edge order so a key present in both sources resolves the same way
    // every tick (it should not happen — face and hand ids are namespaced — but a
    // non-deterministic merge would be an awful bug to chase).
    const merged: FeatureVector = {};
    for (const k of FEATURE_VECTOR_EDGES) {
      const part = byEdge.get(k);
      if (part) Object.assign(merged, part);
    }
    latest = merged;
    latestT = ctx.time * 1000;
  }
}

/** The most recent merged feature vector (and its tick time in ms), or null if none
 *  has arrived yet. */
export function readLiveVector(): { vector: FeatureVector; t: number } | null {
  return latest ? { vector: latest, t: latestT } : null;
}

/** Forget everything — used by tests, and on engine teardown. */
export function resetLiveVector(): void {
  latest = null;
  latestT = 0;
  byEdge.clear();
}
