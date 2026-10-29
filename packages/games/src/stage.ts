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

/** The canvas the stage draws on. `overlayOnly`: draw no background (a transparent overlay export). */
export interface StageFrame {
  W: number;
  H: number;
  overlayOnly?: boolean;
}

const BG = '#0b1020';
const GRID = 'rgba(255,255,255,0.08)';
const TEXT = '#e5e7eb';
const DIM = 'rgba(229,231,235,0.55)';
const TRAIL = '#22d3ee';
const NOW = 'rgba(255,255,255,0.7)';
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

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = TEXT, align: CanvasTextAlign = 'left') {
  g.fillStyle = color;
  g.font = `600 ${Math.round(size)}px system-ui, sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function bar(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, color: string, alpha = 1) {
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.fillRect(x0, y - h / 2, Math.max(2, x1 - x0), h);
  g.globalAlpha = 1;
}

function drawSing(g: CanvasRenderingContext2D, v: GameView, W: number, H: number) {
  const L = layout(v, W, H);
  for (let m = Math.ceil(v.low); m <= v.high; m++) {
    const y = L.yOfMidi(m);
    g.fillStyle = GRID;
    g.fillRect(0, y, W, 1);
    if (m % 12 === 0 || m === Math.ceil(v.low)) text(g, nameOf(m), 6, y - 7, 11, DIM);
  }
  // A bar a semitone row high, inside a faint band as wide as the tolerance: where the voice
  // counts as on the note.
  const thick = Math.max(6, 0.7 * L.semitone);
  const band = Math.max(thick, ((2 * v.toleranceCents) / 100) * L.semitone);
  for (const n of v.notes) {
    if (n.midi === undefined) continue;
    const y = L.yOfMidi(n.midi);
    const x0 = L.xOf(n.start);
    const x1 = L.xOf(n.end);
    bar(g, x0, x1, y, band, STATE_COLOR.pending, 0.15);
    bar(g, x0, x1, y, thick, STATE_COLOR[n.state === 'hit' ? 'pending' : n.state], 0.55);
    if (n.fill && n.fill > 0) bar(g, x0, x0 + (x1 - x0) * n.fill, y, thick, n.state === 'miss' ? STATE_COLOR.miss : STATE_COLOR.hit, 0.9);
    if (n.state === 'active' || (n.start > v.now && n.start < v.now + 1.5)) text(g, nameOf(n.midi), x0, y - thick / 2 - 9, 12, TEXT);
  }
  g.strokeStyle = TRAIL;
  g.lineWidth = 3;
  g.beginPath();
  let pen = false;
  for (const p of v.trail) {
    if (p.midi === null || p.midi < v.low - 1 || p.midi > v.high + 1) {
      pen = false;
      continue;
    }
    const x = L.xOf(p.t);
    const y = L.yOfMidi(p.midi);
    if (pen) g.lineTo(x, y);
    else g.moveTo(x, y);
    pen = true;
  }
  g.stroke();
  g.fillStyle = NOW;
  g.fillRect(L.nowX - 1, L.top - 10, 2, L.bottom - L.top + 20);
}

function drawLanes(g: CanvasRenderingContext2D, v: GameView, W: number, H: number) {
  const L = layout(v, W, H);
  const pitches = [...new Set(v.notes.map((n) => n.midi).filter((m): m is number => m !== undefined))].sort((a, b) => b - a);
  const lanes = Math.max(1, v.game === 'play-along' && pitches.length > 0 ? v.high - v.low + 1 : 1);
  const laneH = (L.bottom - L.top) / lanes;
  const laneY = (n: ViewNote) => (n.midi === undefined || lanes === 1 ? (L.top + L.bottom) / 2 : L.top + (v.high - n.midi + 0.5) * laneH);
  for (let i = 0; i <= lanes; i++) {
    g.fillStyle = GRID;
    g.fillRect(0, L.top + i * laneH, W, 1);
  }
  g.fillStyle = NOW;
  g.fillRect(L.nowX - 2, L.top, 4, L.bottom - L.top);
  const r = Math.max(8, Math.min(22, laneH * 0.35));
  for (const n of v.notes) {
    const x = L.xOf(n.start);
    const y = laneY(n);
    g.globalAlpha = n.state === 'hit' || n.state === 'miss' ? 0.5 : 1;
    g.fillStyle = n.state === 'hit' ? TIER_COLOR[n.label ?? 'good'] ?? STATE_COLOR.hit : STATE_COLOR[n.state];
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    if (n.midi !== undefined && n.state !== 'hit') text(g, nameOf(n.midi), x, y, Math.max(9, r * 0.7), BG, 'center');
  }
  v.flashes.forEach((f, i) => {
    const age = v.now - f.t;
    const ms = f.offset === undefined ? '' : ` ${f.offset < 0 ? 'early' : 'late'} ${Math.abs(Math.round(f.offset * 1000))} ms`;
    g.globalAlpha = Math.max(0, 1 - age);
    text(g, `${f.label}${Math.abs(f.offset ?? 0) >= 0.01 ? ms : ''}`, L.nowX, L.top - 14 - i * 16 - age * 20, 14, TIER_COLOR[f.label] ?? TEXT, 'center');
    g.globalAlpha = 1;
  });
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
  const r = v.results;
  if (!r) return;
  g.globalAlpha = 0.85;
  g.fillStyle = BG;
  g.fillRect(W * 0.15, H * 0.25, W * 0.7, H * 0.5);
  g.globalAlpha = 1;
  text(g, v.game === 'calibrate' ? 'Timing measured' : `${Math.round(r.accuracy * 100)} %`, W / 2, H * 0.36, Math.min(48, H * 0.09), TEXT, 'center');
  text(g, r.summary, W / 2, H * 0.47, 15, TEXT, 'center');
  const counts = Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join('   ');
  text(g, counts, W / 2, H * 0.55, 13, DIM, 'center');
  if (r.timing) text(g, `${r.timing.verdict}: ${r.timing.meanMs > 0 ? '+' : ''}${r.timing.meanMs} ms on average, spread ${r.timing.sdMs} ms`, W / 2, H * 0.62, 13, DIM, 'center');
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
  if (v.game === 'sing') drawSing(g, v, W, H);
  else if (v.game === 'match') drawMatch(g, v, W, H);
  else drawLanes(g, v, W, H);
  if (v.phase === 'count-in' && v.countdown > 0) text(g, String(v.countdown), W / 2, H / 2, Math.min(120, H * 0.25), TEXT, 'center');
  if (v.phase === 'results') drawResults(g, v, W, H);
  if (v.notice) text(g, v.notice, W / 2, H * 0.5 + 60, 16, '#fbbf24', 'center');
}
