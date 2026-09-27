/**
 * The air instruments' live shape taps (#249) — how an enrolment UI sees exactly what
 * its instrument's node sees.
 *
 * An air instrument that reads a shape (the guitar's chord hand, the flute's fingers)
 * emits the live feature vector it classifies on its `shape` port. Enrolment captures its
 * samples from there, so what is learned and what is played against are the same
 * numbers. The vector changes every camera frame and no component needs it re-rendered,
 * so it lands in a plain holder, keyed by node id, that the enrolment UI polls while it
 * captures (the hot-path / human-frequency split `src/app/enroll/liveVector.ts`
 * explains), not in a zustand store.
 */
import type { FeatureVector } from '@/enroll';

export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

const latest = new Map<string, FeatureVector | null>();

const keyOf = (nodeId: string, port: string) => `${nodeId}.${port}`;

/** Per-tick sink: copy one node's shape output (`shape` by default; the flute also has
 *  `mouth`) into its holder (no React). */
export function makeShapeTap(engine: OutputReader, nodeId: string, port = 'shape'): () => void {
  const key = keyOf(nodeId, port);
  return () => {
    const v = engine.getOutput(nodeId, port) as FeatureVector | null | undefined;
    latest.set(key, v ?? null);
  };
}

/** The node's latest live shape (null: nothing in view, or the instrument is off). */
export const readShape = (nodeId: string, port = 'shape'): FeatureVector | null => latest.get(keyOf(nodeId, port)) ?? null;

/** Set a holder directly (tests); `setShape(id, null)` clears one. */
export function setShape(nodeId: string, v: FeatureVector | null, port = 'shape'): void {
  latest.set(keyOf(nodeId, port), v);
}

/** Clear every holder (the engine teardown). */
export function clearShapes(): void {
  latest.clear();
}
