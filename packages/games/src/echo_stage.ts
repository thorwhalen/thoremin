/**
 * Echo's stage: the round's bars as one strip of beats, the call's notes as blocks on it, the
 * player's claps as ticks on a second row under them, a playhead, and the phase in words ("Listen",
 * the count's number, "Your turn"). During the answer the blocks take the judge's colours as
 * their windows close; a clap that matched nothing is a red tick. Draws only from an `EchoView`.
 */
import type { EchoView } from './echo';
import { BG, DIM, drawResultsCard, GRID, text, TEXT } from './paint';

const COLORS = { pending: 'rgba(148,163,184,0.55)', hit: '#34d399', miss: '#f87171', call: '#f5d142', clap: '#22d3ee', stray: '#f87171' } as const;

export function drawEcho(g: CanvasRenderingContext2D, W: number, H: number, v: EchoView): void {
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  const pad = Math.max(16, W * 0.06);
  const left = pad;
  const right = W - pad;
  const beats = v.bars * v.beatsPerBar;
  const xOf = (b: number) => left + (b / beats) * (right - left);
  const callY = H * 0.46;
  const answerY = H * 0.64;
  const laneH = Math.min(44, H * 0.1);

  text(g, v.title, W / 2, H * 0.1, 20, TEXT, 'center');
  text(g, `${v.round.label}${v.round.retry ? ' (again)' : ''}   round ${v.round.index + 1} of ${v.round.total}`, W / 2, H * 0.1 + 24, 14, DIM, 'center');
  const word = v.phase === 'listen' ? 'Listen' : v.phase === 'count' ? String(v.count ?? '') : v.phase === 'answer' ? 'Your turn' : v.phase === 'result' ? (v.verdict?.line ?? '') : '';
  text(g, word, W / 2, H * 0.27, v.phase === 'count' ? Math.min(72, H * 0.14) : Math.min(30, H * 0.06), v.phase === 'answer' ? COLORS.clap : TEXT, 'center');

  // The beat grid: a line per beat, a stronger one per bar.
  for (let b = 0; b <= beats; b++) {
    g.strokeStyle = b % v.beatsPerBar === 0 ? 'rgba(255,255,255,0.3)' : GRID;
    g.lineWidth = b % v.beatsPerBar === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(xOf(b), callY - laneH);
    g.lineTo(xOf(b), answerY + laneH);
    g.stroke();
  }
  text(g, 'call', left - 6, callY + 4, 11, DIM, 'right');
  text(g, 'you', left - 6, answerY + 4, 11, DIM, 'right');

  // The call: a block per note, from its onset over its length (a sliver less, so notes touch apart).
  const answering = v.phase === 'answer' || v.phase === 'result';
  for (const t of v.targets) {
    const x0 = xOf(t.beat);
    const x1 = Math.max(x0 + 6, xOf(t.beat + t.beats) - 3);
    const sounded = v.phase === 'listen' && v.playhead !== null && v.playhead >= t.beat;
    g.fillStyle = answering ? COLORS[t.state] : sounded ? COLORS.call : COLORS.pending;
    g.fillRect(x0, callY - laneH / 2, x1 - x0, laneH);
    // The onset itself, which is what is judged: a bright edge.
    g.fillStyle = TEXT;
    g.fillRect(x0, callY - laneH / 2, 3, laneH);
  }

  // The player's claps.
  for (const h of v.heard) {
    if (h.beat < -0.5 || h.beat > beats + 0.5) continue;
    g.strokeStyle = h.stray ? COLORS.stray : COLORS.clap;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(xOf(h.beat), answerY - laneH / 2);
    g.lineTo(xOf(h.beat), answerY + laneH / 2);
    g.stroke();
  }

  if (v.playhead !== null) {
    g.strokeStyle = TEXT;
    g.lineWidth = 2;
    const x = xOf(Math.min(beats, v.playhead));
    const y = v.phase === 'listen' ? callY : answerY;
    g.beginPath();
    g.moveTo(x, y - laneH);
    g.lineTo(x, y + laneH);
    g.stroke();
  }

  // Progress: a dot per round, green passed, red failed, white the one being played.
  for (let i = 0; i < v.round.total; i++) {
    const done = v.outcomes[i];
    g.fillStyle = done === true ? COLORS.hit : done === false ? COLORS.miss : i === v.round.index ? TEXT : 'rgba(255,255,255,0.2)';
    g.beginPath();
    g.arc(W / 2 + (i - (v.round.total - 1) / 2) * 20, H * 0.86, 6, 0, Math.PI * 2);
    g.fill();
  }
  if (v.hint && v.phase !== 'results') text(g, v.hint, W / 2, H * 0.94, 13, DIM, 'center');
  if (v.results) drawResultsCard(g, W, H, v.results, `${Math.round(v.results.accuracy * 100)} %`);
  if (v.notice) text(g, v.notice, W / 2, H * 0.5 + 60, 16, '#fbbf24', 'center');
}
