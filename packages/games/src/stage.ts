/**
 * The listening games' stage: the whole picture of a game, drawn on a 2D canvas from a game's
 * view model only (`view`). thoremin's games slice wraps it as an overlay element; a standalone
 * game page calls {@link drawStage} on its own canvas. The game owns the canvas: an opaque
 * background first (the seeds hide the video), then the game's own convention (the research doc,
 * section 7): pitch bars with the voice's trail for Sing, a highway to a hit line for Play along
 * and the calibration take, a tuner dial with a hold ring for Match the note; the count-in, the
 * running score and the results card on top.
 *
 * `layout` is pure (positions from the view and the canvas size), so a test checks where things go
 * without a canvas.
 */
import type { GameView, ViewNote } from './view';
import { nameOf } from './lesson';
import { noteProjection, noteQuad, RHYTHM_NOTE_S, type NoteBox, type NoteProjection, type NoteViewKind } from './note_view';
import type { Pt } from './perspective';
import { drawStaff, staffLayout, type StaffMode } from './staff';
import type { KeyFifths } from './spelling';
import { BG, DIM, GRID, TEXT, TRAIL, drawResultsCard, text } from './paint';

/** The canvas the stage draws on. `overlayOnly`: draw no background (a transparent overlay export). */
export interface StageFrame {
  W: number;
  H: number;
  overlayOnly?: boolean;
  /** How Sing and Play along lay out their notes (`note_view`). Default `roll-h`. */
  notes?: NoteViewKind;
  /** A staff with the notes (`over`: stacked above a roll across, a strip over a falling one), alone (`only`), or none. Default `off`. */
  staff?: StaffMode;
  /** The key the staff spells in (fifths). Default C major. */
  key?: KeyFifths;
}

// The palette, the text and the results card are `paint`'s, shared with the field and echo stages.
export { BG, DIM, GRID, TEXT, TRAIL, drawResultsCard, text } from './paint';
const NOW = 'rgba(255,255,255,0.7)';
const ROAD_SURFACE = 'rgba(148,163,184,0.08)';
const STATE_COLOR: Record<ViewNote['state'], string> = { pending: '#64748b', active: '#e2e8f0', hit: '#f5d142', miss: '#ef4444' };
const TIER_COLOR: Record<string, string> = { perfect: '#f5d142', great: '#34d399', good: '#60a5fa', miss: '#ef4444', 'wrong note': '#ef4444', extra: '#f97316' };

/** The header row's height (title, score), as a fraction of the height: below the shell's own top-left and top-right chrome. */
export const HEADER_Y = 0.2;

/** Where the now line (Sing) or the hit line (Play along) stands, as a fraction of the width. */
export const NOW_X = { sing: 0.3, lane: 0.18 } as const;

/** Pure geometry of the stage for a view and a canvas size. */
export function layout(v: GameView, W: number, H: number) {
  const top = HEADER_Y * H + 40;
  const bottom = 0.86 * H;
  const nowX = (v.game === 'sing' ? NOW_X.sing : NOW_X.lane) * W;
  const span = v.to - v.now;
  const pxPerS = span > 0 ? (W - nowX) / span : 0;
  const xOf = (t: number) => nowX + (t - v.now) * pxPerS;
  const rows = Math.max(1, v.high - v.low);
  const yOfMidi = (m: number) => bottom - ((m - v.low) / rows) * (bottom - top);
  return { top, bottom, nowX, pxPerS, xOf, yOfMidi, semitone: (bottom - top) / rows };
}


/** Fill a quad. */
function fillQuad(g: CanvasRenderingContext2D, q: readonly Pt[], color: string, alpha = 1) {
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  q.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.fill();
  g.globalAlpha = 1;
}

function line(g: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, width = 1) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
}

/** The box the notes fill on the canvas: under the header, above the row labels. */
export function noteBox(W: number, H: number): NoteBox {
  return { left: 0, top: HEADER_Y * H + 40, right: W, bottom: 0.86 * H };
}

/** The projection a timed game's notes are drawn through: its rows, the stage's time span. */
export function stageProjection(v: GameView, W: number, H: number, kind: NoteViewKind = 'roll-h', rows?: { low: number; high: number }, box: NoteBox = noteBox(W, H)): NoteProjection {
  const r = rows ?? { low: v.low, high: v.high };
  return noteProjection(kind, box, { now: v.now, from: v.from, to: v.to, low: r.low, high: r.high }, kind === 'roll-h' ? { nowAt: v.game === 'sing' ? NOW_X.sing : NOW_X.lane } : {});
}

/** A note clipped to the time on screen, or null when none of it is. */
function clipped(P: NoteProjection, start: number, end: number): [number, number] | null {
  const a = Math.max(start, P.shown[0]);
  const b = Math.min(end, P.shown[1]);
  return b > a ? [a, b] : null;
}

/** The rows' lines along the time axis, and their labels: under the hit line when rows run across, at the left edge when they run up. */
function drawRows(g: CanvasRenderingContext2D, P: NoteProjection, edges: readonly number[], labels: readonly { row: number; text: string }[]) {
  const [t0, t1] = P.shown;
  // The highway's surface, so the notes ride on a road rather than in the dark.
  if (P.kind === 'highway') fillQuad(g, [P.at(t0, P.rows.low), P.at(t0, P.rows.high), P.at(t1, P.rows.high), P.at(t1, P.rows.low)], ROAD_SURFACE);
  for (const r of edges) line(g, P.at(t0, r), P.at(t1, r), GRID);
  for (const l of labels) {
    if (P.rowsAcross) {
      const p = P.at(P.shown[0], l.row);
      text(g, l.text, p.x, p.y + 12, 11, DIM, 'center');
    } else {
      const p = P.at(t0, l.row);
      text(g, l.text, p.x + 6, p.y - 7, 11, DIM);
    }
  }
}

function drawSing(g: CanvasRenderingContext2D, v: GameView, W: number, H: number, kind: NoteViewKind, box: NoteBox) {
  const P = stageProjection(v, W, H, kind, undefined, box);
  const edges: number[] = [];
  const labels: { row: number; text: string }[] = [];
  for (let m = Math.ceil(v.low); m <= v.high; m++) {
    edges.push(m);
    if (m % 12 === 0 || m === Math.ceil(v.low)) labels.push({ row: m, text: nameOf(m) });
  }
  drawRows(g, P, edges, labels);
  // A bar most of a semitone row thick, inside a faint band as wide as the tolerance: where the
  // voice counts as on the note.
  const half = 0.35;
  const band = Math.max(half, v.toleranceCents / 100);
  for (const n of v.notes) {
    if (n.midi === undefined) continue;
    const span = clipped(P, n.start, n.end);
    if (!span) continue;
    const box = { start: span[0], end: span[1], row: n.midi };
    fillQuad(g, noteQuad(P, box, band), STATE_COLOR.pending, 0.15);
    fillQuad(g, noteQuad(P, box, half), STATE_COLOR[n.state === 'hit' ? 'pending' : n.state], 0.55);
    const filled = n.fill && n.fill > 0 ? clipped(P, n.start, n.start + (n.end - n.start) * n.fill) : null;
    if (filled) fillQuad(g, noteQuad(P, { start: filled[0], end: filled[1], row: n.midi }, half), n.state === 'miss' ? STATE_COLOR.miss : STATE_COLOR.hit, 0.9);
    if (n.start >= P.shown[0] && (n.state === 'active' || (n.start > v.now && n.start < v.now + 1.5))) {
      const p = P.at(span[0], n.midi + (P.rowsAcross ? 0 : half));
      text(g, nameOf(n.midi), p.x, P.rowsAcross ? p.y + 10 : p.y - 9, 12, TEXT, P.rowsAcross ? 'center' : 'left');
    }
  }
  g.strokeStyle = TRAIL;
  g.lineWidth = 3;
  g.beginPath();
  let pen = false;
  for (const p of v.trail) {
    if (p.midi === null || p.midi < v.low - 1 || p.midi > v.high + 1 || p.t < P.shown[0]) {
      pen = false;
      continue;
    }
    const q = P.at(p.t, p.midi);
    if (pen) g.lineTo(q.x, q.y);
    else g.moveTo(q.x, q.y);
    pen = true;
  }
  g.stroke();
  line(g, P.nowLine[0], P.nowLine[1], NOW, 2);
}

/** Play along's rows: a lane per semitone of a melody's range, or the one lane of a rhythm. */
export function laneRows(v: GameView): { pitched: boolean; low: number; high: number } {
  const pitched = v.game === 'play-along' && v.notes.length > 0 && v.notes.every((n) => n.midi !== undefined);
  return pitched ? { pitched, low: v.low, high: v.high } : { pitched, low: 0, high: 0 };
}

function drawLanes(g: CanvasRenderingContext2D, v: GameView, W: number, H: number, kind: NoteViewKind, box: NoteBox) {
  const { pitched, ...rows } = laneRows(v);
  const P = stageProjection(v, W, H, kind, rows, box);
  const edges: number[] = [];
  for (let r = rows.low; r <= rows.high + 1; r++) edges.push(r - 0.5);
  const labels = pitched && P.rowSize(v.now) >= 16 ? Array.from({ length: rows.high - rows.low + 1 }, (_, k) => ({ row: rows.low + k, text: nameOf(rows.low + k) })) : [];
  drawRows(g, P, edges, labels);
  line(g, P.nowLine[0], P.nowLine[1], NOW, 4);
  // A note is a box as long as it lasts (a rhythm's, a short block at its onset), hit at its start.
  const half = pitched ? 0.4 : 0.3;
  for (const n of v.notes) {
    const row = pitched ? n.midi! : 0;
    const span = clipped(P, n.start, pitched ? n.end : n.start + RHYTHM_NOTE_S);
    if (!span) continue;
    const color = n.state === 'hit' ? (TIER_COLOR[n.label ?? 'good'] ?? STATE_COLOR.hit) : STATE_COLOR[n.state];
    fillQuad(g, noteQuad(P, { start: span[0], end: span[1], row }, half), color, n.state === 'hit' || n.state === 'miss' ? 0.5 : 1);
    const size = Math.min(16, P.rowSize(n.start) * 0.5);
    if (pitched && n.state !== 'hit' && n.start >= P.shown[0] && size >= 8) {
      const p = P.at(n.start, row);
      text(g, nameOf(n.midi!), p.x + (P.rowsAcross ? 0 : 4), p.y - (P.rowsAcross ? size * 0.7 : 0), size, TEXT, P.rowsAcross ? 'center' : 'left');
    }
  }
  const top = Math.min(P.nowLine[0].y, P.nowLine[1].y);
  drawFlashes(g, v, { x: (P.nowLine[0].x + P.nowLine[1].x) / 2, y: P.rowsAcross ? top - 30 : top - 14 });
}

/** The judgments of the last second, rising and fading over the now line. */
function drawFlashes(g: CanvasRenderingContext2D, v: GameView, at: Pt) {
  v.flashes.forEach((f, i) => {
    const age = v.now - f.t;
    const ms = f.offset === undefined ? '' : ` ${f.offset < 0 ? 'early' : 'late'} ${Math.abs(Math.round(f.offset * 1000))} ms`;
    g.globalAlpha = Math.max(0, 1 - age);
    text(g, `${f.label}${Math.abs(f.offset ?? 0) >= 0.01 ? ms : ''}`, at.x, at.y - i * 16 - age * 20, 14, TIER_COLOR[f.label] ?? TEXT, 'center');
    g.globalAlpha = 1;
  });
}

/** Where the notes and the staff go for a view and a staff mode: a roll's box and a staff's box, either may be absent. */
export function stageBoxes(W: number, H: number, kind: NoteViewKind, staff: StaffMode): { roll: NoteBox | null; staff: NoteBox | null } {
  const box = noteBox(W, H);
  if (staff === 'off') return { roll: box, staff: null };
  if (staff === 'only') return { roll: null, staff: box };
  const cut = box.top + STAFF_SHARE[kind] * (box.bottom - box.top);
  // Across, the staff is stacked above the roll and shares its time axis; falling, it is a strip over the far end.
  if (kind === 'roll-h') return { roll: { ...box, top: cut + 8 }, staff: { ...box, bottom: cut } };
  return { roll: box, staff: { ...box, bottom: cut } };
}

/** The share of the notes' box a staff takes with the notes, per view. */
const STAFF_SHARE: Record<NoteViewKind, number> = { 'roll-h': 0.42, 'roll-v': 0.34, highway: 0.34 };

/** The staff of a timed game's notes, in time with the roll (across: its very axis; otherwise its own, at the same clock). */
function drawStaffFor(g: CanvasRenderingContext2D, v: GameView, W: number, H: number, kind: NoteViewKind, boxes: { roll: NoteBox | null; staff: NoteBox }, key: KeyFifths | undefined) {
  if (!v.grid) return;
  const lanes = laneRows(v);
  const rows = v.game === 'sing' ? { low: v.low, high: v.high } : lanes;
  const axis = kind === 'roll-h' && boxes.roll ? stageProjection(v, W, H, 'roll-h', rows, boxes.roll) : stageProjection(v, W, H, 'roll-h', rows, boxes.staff);
  const xOf = (t: number) => axis.at(t, rows.low).x;
  const notes = v.notes.map((n) => (v.game === 'sing' || lanes.pitched ? n : { ...n, midi: undefined }));
  const range = v.game === 'sing' || lanes.pitched ? { low: v.low, high: v.high } : undefined;
  const L = staffLayout(notes, boxes.staff, xOf, v.grid, { ...(key === undefined ? {} : { key }), ...(range ? { range } : {}) });
  drawStaff(g, L, boxes.staff, { nowX: xOf(v.now), ...(key === undefined ? {} : { key }), panel: kind !== 'roll-h' && boxes.roll !== null });
  if (!boxes.roll) drawFlashes(g, v, { x: xOf(v.now), y: L.top - 3 * L.space });
}

function drawMatch(g: CanvasRenderingContext2D, v: GameView, W: number, H: number) {
  const cx = W / 2;
  const cy = H * 0.62;
  const R = Math.min(W, H) * 0.32;
  const range = Math.max(100, v.toleranceCents * 3);
  const angle = (cents: number) => -Math.PI / 2 + (Math.max(-range, Math.min(range, cents)) / range) * (Math.PI / 3);
  g.lineWidth = 10;
  g.strokeStyle = GRID;
  g.beginPath();
  g.arc(cx, cy, R, angle(-range), angle(range));
  g.stroke();
  g.strokeStyle = '#34d399';
  g.beginPath();
  g.arc(cx, cy, R, angle(-v.toleranceCents), angle(v.toleranceCents));
  g.stroke();
  const t = v.target;
  if (t) {
    text(g, nameOf(t.midi), cx, cy - R * 0.45, Math.min(64, H * 0.12), TEXT, 'center');
    if (t.cents !== null) {
      const a = angle(t.cents);
      g.strokeStyle = Math.abs(t.cents) <= v.toleranceCents ? '#34d399' : TRAIL;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      g.stroke();
      text(g, `${t.cents > 0 ? '+' : ''}${Math.round(t.cents)} cents`, cx, cy + 24, 16, DIM, 'center');
    } else text(g, 'listen... then sing or play it', cx, cy + 24, 16, DIM, 'center');
    // The hold ring fills while the note is held in tune.
    g.strokeStyle = '#f5d142';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, R * 0.2, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * t.hold);
    g.stroke();
  }
  const n = v.notes.length;
  v.notes.forEach((note, i) => {
    g.fillStyle = note.state === 'hit' ? TIER_COLOR[note.label ?? 'good'] ?? STATE_COLOR.hit : STATE_COLOR[note.state];
    g.beginPath();
    g.arc(cx + (i - (n - 1) / 2) * 26, H * 0.93, 8, 0, Math.PI * 2);
    g.fill();
  });
}


function drawResults(g: CanvasRenderingContext2D, v: GameView, W: number, H: number) {
  if (v.results) drawResultsCard(g, W, H, v.results, v.game === 'calibrate' ? 'Timing measured' : `${Math.round(v.results.accuracy * 100)} %`);
}

/** Draw the whole stage for one view. */
export function drawStage(g: CanvasRenderingContext2D, frame: StageFrame, v: GameView): void {
  const { W, H } = frame;
  if (!frame.overlayOnly) {
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);
  }
  const headY = HEADER_Y * H;
  text(g, v.title, W / 2, headY, 20, TEXT, 'center');
  if (v.game !== 'match' && v.game !== 'calibrate') text(g, `${Math.round(v.accuracy * 100)} %${v.combo > 1 ? `   x${v.combo}` : ''}`, W / 2, headY + 22, 15, DIM, 'center');
  if (v.game === 'calibrate') text(g, `taps heard ${v.combo}`, W / 2, headY + 22, 15, DIM, 'center');
  const kind = v.game === 'calibrate' ? 'roll-h' : (frame.notes ?? 'roll-h');
  const boxes = stageBoxes(W, H, kind, v.game === 'calibrate' || !v.grid ? 'off' : (frame.staff ?? 'off'));
  if (v.game === 'match') drawMatch(g, v, W, H);
  else {
    if (boxes.roll) (v.game === 'sing' ? drawSing : drawLanes)(g, v, W, H, kind, boxes.roll);
    if (boxes.staff) drawStaffFor(g, v, W, H, kind, { roll: boxes.roll, staff: boxes.staff }, frame.key);
  }
  if (v.phase === 'count-in' && v.countdown > 0) text(g, String(v.countdown), W / 2, H / 2, Math.min(120, H * 0.25), TEXT, 'center');
  if (v.phase === 'results') drawResults(g, v, W, H);
  if (v.notice) text(g, v.notice, W / 2, H * 0.5 + 60, 16, '#fbbf24', 'center');
}
