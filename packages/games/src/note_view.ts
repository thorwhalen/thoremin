/**
 * How a timed game's notes are laid out on its stage: one projection from (time, row) to the
 * canvas, so every way of showing a song shares one drawing path. A row is a MIDI pitch (a melody)
 * or the one lane of a rhythm; a note is the box from (start, row - h) to (end, row + h), and its
 * four projected corners are the quad drawn.
 *
 * - `roll-h`: a piano roll travelling right to left to a now line, pitch up.
 * - `roll-v`: a piano roll falling from top to bottom onto a hit line, pitch across (low left).
 * - `highway`: the note highway of rhythm games, `roll-v` seen in perspective, the notes coming
 *   from the horizon (the Pitch Maze road's camera, `perspective`).
 *
 * Pure: geometry only, so a test checks where a note lands without a canvas.
 */
import { roadProjection, type Pt } from './perspective';

export const NOTE_VIEWS = ['roll-h', 'roll-v', 'highway'] as const;
export type NoteViewKind = (typeof NOTE_VIEWS)[number];

/** Each view's name for a player. */
export const NOTE_VIEW_LABELS: Record<NoteViewKind, string> = { 'roll-h': 'Piano roll (across)', 'roll-v': 'Piano roll (falling)', highway: 'Highway' };

/** The canvas box the notes fill. */
export interface NoteBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the view spans: the time on screen and the rows (MIDI, or 0 for a single lane). */
export interface NoteSpan {
  now: number;
  /** Earliest and latest time shown. */
  from: number;
  to: number;
  low: number;
  high: number;
}

export interface NoteViewOptions {
  /** Where the now line stands, as a share of the travel axis from the end notes arrive at. Default 0.3 across, 0.14 falling. */
  nowAt?: number;
  /** Highway: how deep the far end of the shown time is, in units of the near line's width. Default 5. */
  depth?: number;
}

/** How deep behind the hit line the highway still shows the past (units of `depth`). */
const BEHIND_DEPTH = 0.2;

/** The share of the travel axis behind the now line, per kind. */
const NOW_AT: Record<NoteViewKind, number> = { 'roll-h': 0.3, 'roll-v': 0.14, highway: 0.14 };

export interface NoteProjection {
  kind: NoteViewKind;
  /** A time and a (fractional) row on the canvas. */
  at(t: number, row: number): Pt;
  /** The size of one row at time t, pixels (the highway's rows shrink with distance). */
  rowSize(t: number): number;
  /** The now line's two ends (the lowest and the highest row). */
  nowLine: [Pt, Pt];
  /** The rows shown, edge to edge: a row r spans r - 0.5 .. r + 0.5. */
  rows: { low: number; high: number };
  /** Rows run across the screen (`roll-v`, `highway`) or up it (`roll-h`). */
  rowsAcross: boolean;
  /** The earliest and the latest time on screen: anything outside is clipped to it. */
  shown: [number, number];
}

/** The (time, row) to canvas projection of a kind in a box. */
export function noteProjection(kind: NoteViewKind, box: NoteBox, span: NoteSpan, opts: NoteViewOptions = {}): NoteProjection {
  const nowAt = opts.nowAt ?? NOW_AT[kind];
  const rows = { low: span.low - 0.5, high: span.high + 0.5 };
  const n = Math.max(1e-9, rows.high - rows.low);
  /** A row as a share of the row axis, 0 at the low edge. */
  const u = (row: number) => (row - rows.low) / n;
  const W = box.right - box.left;
  const H = box.bottom - box.top;
  const ahead = Math.max(1e-6, span.to - span.now);
  if (kind === 'roll-h') {
    const nowX = box.left + nowAt * W;
    const pxPerS = (box.right - nowX) / ahead;
    const at = (t: number, row: number): Pt => ({ x: nowX + (t - span.now) * pxPerS, y: box.bottom - u(row) * H });
    return { kind, at, rowSize: () => H / n, nowLine: [at(span.now, rows.low), at(span.now, rows.high)], rows, rowsAcross: false, shown: [span.now - (nowX - box.left) / pxPerS, span.to] };
  }
  const hitY = box.bottom - nowAt * H;
  if (kind === 'roll-v') {
    const pxPerS = (hitY - box.top) / ahead;
    const at = (t: number, row: number): Pt => ({ x: box.left + u(row) * W, y: hitY - (t - span.now) * pxPerS });
    return { kind, at, rowSize: () => W / n, nowLine: [at(span.now, rows.low), at(span.now, rows.high)], rows, rowsAcross: true, shown: [span.now - (box.bottom - hitY) / pxPerS, span.to] };
  }
  // The highway: the near line as wide as the box is at the hit line, the horizon at the top.
  const depth = opts.depth ?? 5;
  const width = Math.min(W, 1.6 * H);
  const road = roadProjection({ x: (box.left + box.right) / 2, y: hitY }, box.top, width);
  const d = (t: number) => ((t - span.now) / ahead) * depth;
  const at = (t: number, row: number): Pt => {
    const p = road(u(row) - 0.5, d(t));
    return { x: p.x, y: p.y };
  };
  // Behind the hit line the road widens fast: a short stretch of the past is enough.
  const behind = (BEHIND_DEPTH / depth) * ahead;
  return { kind, at, rowSize: (t) => (width / n) * road(0, d(t)).k, nowLine: [at(span.now, rows.low), at(span.now, rows.high)], rows, rowsAcross: true, shown: [span.now - behind, span.to] };
}

/**
 * The four corners of a note box: from `start` to `end` in time, `half` a row either side of
 * `row` (a rhythm note's caller ends it `RHYTHM_NOTE_S` after its start).
 */
export function noteQuad(P: NoteProjection, n: { start: number; end: number; row: number }, half = 0.4): [Pt, Pt, Pt, Pt] {
  return [P.at(n.start, n.row - half), P.at(n.start, n.row + half), P.at(n.end, n.row + half), P.at(n.end, n.row - half)];
}

/** How long a rhythm note's box is, seconds: a short block at the onset, not its notated length. */
export const RHYTHM_NOTE_S = 0.1;
