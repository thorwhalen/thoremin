/**
 * The air drum's hit tap (#269): every hit the node emits, kept where a take can read
 * them at human frequency.
 *
 * The `air-drum` node's `hits` output is the list of hits decided this tick (usually
 * empty, sometimes one, a flam two). A pattern take needs all of them over half a
 * minute, stamped on the engine clock, and it polls; so a per-tick sink (the shape tap's
 * pattern, `src/app/air/shapeTap.ts`) appends each new list to a holder, and the take
 * reads what arrived since it began. No React, no store: the list changes every hit and
 * nothing needs a re-render for it.
 *
 * A tick that re-reports the same list object is not a new hit; a hit's `t` is in the
 * future (a prediction), so the holder keeps them in arrival order and the take sorts.
 */
import type { DrumHit } from '@/extensions/air/nodes/air_drum';

export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

/** How many hits the holder keeps: a minute of fast playing, and no more. */
const KEEP = 2000;

const hits: DrumHit[] = [];
let last: unknown = undefined;

/** Per-tick sink: append this tick's hits (a new list object) to the holder. */
export function makeHitsTap(engine: OutputReader, nodeId: string, port = 'hits'): () => void {
  return () => {
    const out = engine.getOutput(nodeId, port) as DrumHit[] | undefined;
    if (!out || out === last) return;
    last = out;
    if (out.length === 0) return;
    hits.push(...out);
    if (hits.length > KEEP) hits.splice(0, hits.length - KEEP);
  };
}

/** The hits whose sounding time is at or after `sinceS` (engine seconds), in time order. */
export function hitsSince(sinceS: number): DrumHit[] {
  return hits.filter((h) => h.t >= sinceS).sort((a, b) => a.t - b.t);
}

/** Append hits directly (tests, a replay). */
export function pushHits(list: readonly DrumHit[]): void {
  hits.push(...list);
  if (hits.length > KEEP) hits.splice(0, hits.length - KEEP);
}

/** Forget everything (the engine teardown, a test). */
export function clearHits(): void {
  hits.length = 0;
  last = undefined;
}
