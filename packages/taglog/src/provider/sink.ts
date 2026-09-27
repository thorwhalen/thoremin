/**
 * taglog — the event sink (the provider layer's append-only writer, design §9.2).
 *
 * A {@link TagEventSink} buffers the self-describing anchor record plus every
 * semantic {@link EdgeEvent} (serialized through the active {@link EventCodec}) as
 * JSONL lines, then hands them back with {@link TagEventSink.drain}. It mirrors the
 * recording subsystem's `FeatureJsonlTap`: serialize on receipt so value objects are
 * freed immediately, `drain()` is the seam a future appendable file sink flushes on
 * a timer. Swapping storage (a POST endpoint, IndexedDB, File System Access) never
 * touches the state machine — the sink only ever sees rows.
 *
 * Pure of DOM/filesystem — it produces strings; the host writes them.
 */
import { getCodec, type EventCodec } from '../affordances/codec';
import type { AnchorRecord, EdgeEvent } from '../affordances/schema';

export class TagEventSink {
  private lines: string[] = [];
  private readonly codec: EventCodec;

  /** @param codecName registered codec id; unknown/absent falls back to statusEnum. */
  constructor(codecName?: string) {
    this.codec = getCodec(codecName);
  }

  /** Write the self-describing anchor as the first line (§5). Call once at take start. */
  writeAnchor(anchor: AnchorRecord): void {
    this.lines.push(JSON.stringify(anchor));
  }

  /** Append semantic edges, serialized to 1..2 wire rows each via the codec. */
  append(edges: readonly EdgeEvent[]): void {
    for (const e of edges) {
      for (const row of this.codec.encode(e)) this.lines.push(JSON.stringify(row));
    }
  }

  /** Number of buffered lines (anchor + rows) so far. */
  get count(): number {
    return this.lines.length;
  }

  /** True until any line (even the anchor) has been buffered. */
  get isEmpty(): boolean {
    return this.lines.length === 0;
  }

  /** Take the buffered JSONL chunk and clear the buffer. '' when nothing is buffered. */
  drain(): string {
    if (!this.lines.length) return '';
    const chunk = this.lines.join('\n') + '\n';
    this.lines = [];
    return chunk;
  }
}
