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
 *
 * In the SDK's app half (not the app) so an extension's tool reads the SAME vectors the
 * trainer learns from (the personal categorizer session, #330); the app attaches the tap and
 * re-exports this module from `src/app/enroll/liveVector.ts`.
 *
 * ## The stamp is the camera frame's, not the tick's (#858)
 *
 * The camera sources return their cached frame on every tick until inference delivers the
 * next one, so on a camera slower than the engine tick the same camera frame is re-offered
 * under a new tick time. Stamped with the tick, it reached every consumer as a new frame with
 * zero displacement, deflating the noise estimate (#856 skips only an identical stamp). So the
 * tap also watches the sources ({@link SOURCE_FRAME_EDGES}) and stamps a part with the tick at
 * which its source frame was FIRST offered: a re-offer keeps the stamp, and every consumer's
 * same-stamp check skips it. Identity, not the frame's capture stamp: `frameTime` honours a
 * capture stamp only at speed 1 and for this document's own frames (a replay or a batch clock
 * gets the tick time, and the dedupe would vanish), while the source frame object is the same
 * one in every mode; and the stamp stays on the tick's base, which the trainer's clock shares.
 * Never by vector content: a pinned feature repeats legitimately.
 *
 * The merged stamp is the newest part's. A vector whose parts are ALL re-offers repeats the
 * previous stamp; one with a new face frame and a re-offered hand frame gets the new stamp, its
 * hand features repeated (a per-feature stamp would be needed to skip those, and the slow-camera
 * case is one camera feeding every source).
 */
import type { NodeContext, Tap } from '@thoremin/dag';
import type { FeatureVector } from '@thoremin/sdk/enroll';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';

/** The edge keys the tap listens to — the catalog's three vector-producing nodes. */
export const FEATURE_VECTOR_EDGES = ['faceVec.vector', 'handVec.vector', 'bodyVec.vector'] as const;

/** The source frame each vector is computed from (the slot candidates keep these node ids). */
export const SOURCE_FRAME_EDGES: Readonly<Record<(typeof FEATURE_VECTOR_EDGES)[number], string>> = {
  'faceVec.vector': 'camFace.face',
  'handVec.vector': `${TRUNK.cam}.hands`,
  'bodyVec.vector': 'camBody.body',
};
const SOURCE_KEYS: ReadonlySet<string> = new Set(Object.values(SOURCE_FRAME_EDGES));

/** The latest merged vector, or null before the first tick with any source present. */
let latest: FeatureVector | null = null;
/** Stamp of the latest vector, in MILLISECONDS: the tick at which its newest source frame was
 *  first offered (see the module header). The DAG clock (`ctx.time`) is in
 *  seconds; the trainer's sampler (`dwellMs`, `speedWindowMs`) is in ms, and v1
 *  passed the seconds through unconverted — a 220 ms dwell became 220 s, and the
 *  speed estimate (displacement / dt) was a thousand times too large, so nothing
 *  ever read as "held". Convert HERE, at the boundary, once. */
let latestT = 0;

/** Per-edge last value and the tick (`ctx.time`) it came from. Only the parts emitted in
 *  the CURRENT tick are merged: a source whose node left the graph (the face branch drops
 *  when nothing demands it) stops emitting, and its last vector must not ride along in
 *  every later tick as if the face were still there. */
const byEdge = new Map<string, { vector: FeatureVector; time: number; stamp: number }>();

/** Per source edge: the last frame object offered, the tick (seconds) it was first offered, and
 *  the last tick it was offered on. A source that missed a tick (its node left the graph) starts
 *  over when it returns, even with the same object (an empty-frame constant). */
const sources = new Map<string, { frame: unknown; firstSeen: number; lastSeen: number }>();
/** The tick before the current one, and the current one (seconds). */
let prevTick = -Infinity;
let currTick = -Infinity;

/**
 * A DAG {@link Tap} that keeps {@link readLiveVector} current. Attach once at engine
 * construction and leave attached — it costs one object spread per tick and is the
 * only way the host can see the feature vector at all.
 */
export class LiveVectorTap implements Tap {
  onValue(key: string, value: unknown, ctx: NodeContext): void {
    if (ctx.time !== currTick) {
      prevTick = currTick;
      currTick = ctx.time;
    }
    if (SOURCE_KEYS.has(key)) {
      const seen = sources.get(key);
      const continued = seen !== undefined && seen.frame === value && seen.lastSeen >= prevTick;
      sources.set(key, { frame: value, firstSeen: continued ? seen.firstSeen : ctx.time, lastSeen: ctx.time });
      return;
    }
    if (!(FEATURE_VECTOR_EDGES as readonly string[]).includes(key)) return;
    if (!value || typeof value !== 'object') return;
    // A source the tap did not see this tick (none in the graph, or not yet offered) stamps
    // its vector with the tick, as before #858.
    const source = sources.get(SOURCE_FRAME_EDGES[key as (typeof FEATURE_VECTOR_EDGES)[number]]);
    const stamp = source && source.lastSeen === ctx.time ? source.firstSeen : ctx.time;
    byEdge.set(key, { vector: value as FeatureVector, time: ctx.time, stamp });
    // Merge in a fixed edge order so a key present in both sources resolves the same way
    // every tick (it should not happen — face and hand ids are namespaced — but a
    // non-deterministic merge would be an awful bug to chase).
    const merged: FeatureVector = {};
    let newest = -Infinity;
    for (const k of FEATURE_VECTOR_EDGES) {
      const part = byEdge.get(k);
      if (!part || part.time !== ctx.time) continue;
      Object.assign(merged, part.vector);
      newest = Math.max(newest, part.stamp);
    }
    latest = merged;
    latestT = newest * 1000;
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
  sources.clear();
  prevTick = -Infinity;
  currTick = -Infinity;
}
