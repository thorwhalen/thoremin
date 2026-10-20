/**
 * The chord map's torus on the video (#745): the overlay element that draws `lib/torus.ts`'s view of
 * the seven chords in a box on the frame, turning slowly, the chord in force marked and the cycle
 * of the move just made lit (a second, a third or a fourth; the same three axes as the harmonic
 * map). Display only: it reads the chord map's status and its own dial fields, and remembers the
 * last two chords in the element's memo.
 *
 * Pure apart from the 2-D context it is handed.
 */
import { DEGREE_COLORS } from '../../lib/chord_map';
import { cycleOfMove, drawTorus, torusRotation, torusView } from '../../lib/torus';

/** The box the torus is drawn in: its side as a share of the frame's height, its top-left corner
 *  as shares of the frame (top middle, under the shell's bar and between the map and the ladder). */
const BOX = { side: 0.28, top: 0.1 } as const;

/** The torus's dial fields (`chordMap.torusOnVideo`). */
export interface TorusOnVideo {
  show?: boolean;
  turnsPerMinute?: number;
}

interface TorusMemo {
  current?: number | null;
  lit?: number | null;
}

/** The chord in force's degree from the chord map's status (null: none, or not a seven-chord map). */
function degreeOf(status: unknown): number | null {
  const d = (status as { degree?: unknown } | undefined)?.degree;
  return typeof d === 'number' && d >= 0 ? d : null;
}

/** Fold this frame's chord into the memo: a new chord lights the cycle the move ran along. */
export function updateTorusMemo(memo: TorusMemo, degree: number | null): void {
  const before = memo.current ?? null;
  if (degree !== null && degree !== before) memo.lit = cycleOfMove(before, degree);
  if (degree !== null) memo.current = degree;
}

export function drawTorusElement(g: CanvasRenderingContext2D, frame: { W: number; H: number; t?: number }, inputs: Readonly<Record<string, unknown>>, memo: Record<string, unknown>): void {
  const config = inputs.config as { enabled?: boolean; torusOnVideo?: TorusOnVideo } | undefined;
  if (config?.enabled !== true || config.torusOnVideo?.show !== true) return;
  const m = memo as TorusMemo;
  updateTorusMemo(m, degreeOf(inputs.status));
  const side = BOX.side * frame.H;
  const view = torusView({ rotation: torusRotation(frame.t ?? 0, config.torusOnVideo.turnsPerMinute ?? 0) });
  g.save();
  g.translate((frame.W - side) / 2, BOX.top * frame.H);
  drawTorus(g, side, side, view, { colors: DEGREE_COLORS, lit: m.lit ?? null, current: m.current ?? null });
  g.restore();
}
