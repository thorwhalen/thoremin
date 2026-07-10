/**
 * taglog — the pluggable event codec (design §4c).
 *
 * The user asked for the point/interval *representation* to be a user-selectable
 * strategy. An {@link EventCodec} governs ONLY serialization: it maps the neutral
 * semantic {@link EdgeEvent} (produced by the state machine) to 0..2 wire rows and
 * back. The store always holds neutral edges; swapping the codec never touches the
 * state machine or the UI — this is the seam that makes the tool extractable.
 *
 * Three codecs ship:
 *  - **statusEnum** (default): one row per edge, `status in {open,close,point}` —
 *    smallest, self-describing, direct BORIS/Praat parity. Full round-trip.
 *  - **pointPair**: a `point` becomes TWO rows (open+close at the same `t`), so every
 *    tag is uniformly an interval downstream (a zero-length interval IS a point).
 *  - **kindField**: statusEnum plus a redundant `kind` field, for interop with tools
 *    that key off a per-row kind column.
 *
 * Pure — no I/O. The provider's JSONL sink stringifies whatever rows a codec emits.
 */
import {
  TagEventSchema,
  type EdgeEvent,
  type TagKind,
} from './schema';

/** A wire row is a plain JSON object (the codec decides its exact shape). */
export type WireRow = Record<string, unknown>;

/**
 * A representation strategy: `encode` one semantic edge -> 1..2 wire rows; `decode`
 * a full stream of rows -> semantic edges (the inverse over a stream). Stateless.
 */
export interface EventCodec {
  name: string;
  encode(edge: EdgeEvent): WireRow[];
  decode(rows: readonly WireRow[]): EdgeEvent[];
}

/** The canonical statusEnum row (also the `TagEvent` wire schema). Drops `kind`
 *  (redundant with the def) and omits `degenerate` unless set. */
function statusRow(edge: EdgeEvent): WireRow {
  const row: WireRow = {
    t: edge.t,
    tCorrected: edge.tCorrected,
    tag: edge.tag,
    status: edge.status,
    seq: edge.seq,
    clock: edge.clock,
    src: edge.src,
  };
  if (edge.degenerate) row.degenerate = true;
  return row;
}

/** Parse a statusEnum-shaped row back to a semantic edge (kind inferred from status:
 *  a `point` status is a point; open/close are intervals). Validates via Zod, so a
 *  malformed row throws with a clear message rather than corrupting the stream. */
function statusEdge(row: WireRow): EdgeEvent {
  const e = TagEventSchema.parse(row);
  const kind: TagKind = e.status === 'point' ? 'point' : 'interval';
  return {
    tag: e.tag,
    kind,
    status: e.status,
    t: e.t,
    tCorrected: e.tCorrected,
    seq: e.seq,
    clock: e.clock,
    src: e.src,
    ...(e.degenerate ? { degenerate: true } : {}),
  };
}

/** statusEnum (default): 1:1 edge <-> row. */
export const statusEnumCodec: EventCodec = {
  name: 'statusEnum',
  encode: (edge) => [statusRow(edge)],
  decode: (rows) => rows.map(statusEdge),
};

/**
 * pointPair: a `point` edge is written as an open+close pair at the same `t` (the
 * close carries `seq + 0.5`-style ordering via a paired suffix is avoided — instead
 * both rows share the point's seq and the close is emitted immediately after). On
 * decode the pair is recognised (same tag, same t, open then close) and folded back
 * into a single `point` edge, so the round-trip is faithful.
 */
export const pointPairCodec: EventCodec = {
  name: 'pointPair',
  encode: (edge) => {
    if (edge.status !== 'point') return [statusRow(edge)];
    const open: WireRow = { t: edge.t, tCorrected: edge.t, tag: edge.tag, status: 'open', seq: edge.seq, clock: edge.clock, src: edge.src };
    const close: WireRow = { t: edge.t, tCorrected: edge.t, tag: edge.tag, status: 'close', seq: edge.seq, clock: edge.clock, src: edge.src };
    return [open, close];
  },
  decode: (rows) => {
    const edges: EdgeEvent[] = [];
    for (let i = 0; i < rows.length; i++) {
      const e = statusEdge(rows[i]);
      const nextRow = rows[i + 1];
      // Fold a same-t, same-tag, same-seq open+close pair back into a point.
      if (e.status === 'open' && nextRow) {
        const n = statusEdge(nextRow);
        if (n.status === 'close' && n.tag === e.tag && n.t === e.t && n.seq === e.seq) {
          edges.push({ ...e, kind: 'point', status: 'point' });
          i++; // consume the close
          continue;
        }
      }
      edges.push(e);
    }
    return edges;
  },
};

/** kindField: statusEnum plus a redundant `kind` column (interop). */
export const kindFieldCodec: EventCodec = {
  name: 'kindField',
  encode: (edge) => [{ ...statusRow(edge), kind: edge.kind }],
  decode: (rows) =>
    rows.map((row) => {
      const e = statusEdge(row);
      const kind = row.kind === 'point' || row.kind === 'interval' ? (row.kind as TagKind) : e.kind;
      return { ...e, kind };
    }),
};

/** The shipped codec registry (open for extension — register more strategies here). */
export const CODECS: Record<string, EventCodec> = {
  [statusEnumCodec.name]: statusEnumCodec,
  [pointPairCodec.name]: pointPairCodec,
  [kindFieldCodec.name]: kindFieldCodec,
};

/** Look up a codec by name, falling back to the statusEnum default for an unknown
 *  id (a stale saved config never breaks logging). */
export function getCodec(name: string | undefined): EventCodec {
  return (name && CODECS[name]) || statusEnumCodec;
}
