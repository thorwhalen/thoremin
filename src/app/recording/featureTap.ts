/**
 * Feature-stream JSONL tap (#88) — a DAG {@link Tap} that serializes every
 * observed edge value to one JSONL line `{tick,t,key,value}` on receipt, filtered
 * to a chosen set of edges. Attached to the running engine via `engine.addTap`
 * only while a take is in progress, then detached.
 *
 * Unlike `StreamRecorder` (`src/dag/recorder.ts`), which retains every value
 * OBJECT in memory for the whole run, this serializes each value to a string
 * immediately — so the value objects are freed as they arrive (the #49
 * unbounded-accumulation caveat). `drain()` hands back the buffered lines and
 * clears. Today the session calls it once on stop to write the `.features.jsonl`
 * file; the string buffer therefore still grows over the take (much smaller than
 * retained objects, fine for the minutes-long takes this instrument produces).
 * `drain()` is already the seam for the follow-up: an appendable sink (FS Access
 * `createWritable({keepExistingData:true})`) could flush it on a timer for
 * hours-long, all-edge captures. Pure (no DOM/filesystem), unit-testable.
 */
import type { NodeContext, Tap } from '@/dag';

export class FeatureJsonlTap implements Tap {
  /** Only record these `"<node>.<port>"` keys; empty/undefined = all edges. */
  private readonly only?: Set<string>;
  private buffer: string[] = [];
  private total = 0;
  private readonly seen = new Set<string>();

  constructor(edges: string[] = []) {
    if (edges.length) this.only = new Set(edges);
  }

  onValue(key: string, value: unknown, ctx: NodeContext): void {
    if (this.only && !this.only.has(key)) return;
    this.seen.add(key);
    // Serialize now so the (possibly large) value object can be GC'd immediately
    // rather than retained until stop. One compact JSON object per line.
    this.buffer.push(JSON.stringify({ tick: ctx.tick, t: ctx.time, key, value }));
    this.total++;
  }

  /** Total lines recorded so far. */
  get count(): number {
    return this.total;
  }

  /** The distinct edge keys seen so far (for the manifest / diagnostics). */
  keysSeen(): string[] {
    return [...this.seen];
  }

  /** Take the buffered lines as a JSONL chunk and clear the buffer (for
   * incremental flushing). Returns '' when nothing is buffered. */
  drain(): string {
    if (!this.buffer.length) return '';
    const chunk = this.buffer.join('\n') + '\n';
    this.buffer = [];
    return chunk;
  }
}
