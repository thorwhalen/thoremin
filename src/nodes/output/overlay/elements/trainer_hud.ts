/**
 * The trainer's on-video guidance.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { wrapLines, type TrainerHudSnapshot } from '@/enroll/hud';
import { CUE_MARGIN, type OverlayElement, type OverlayView } from '../view';

// ---- Trainer guidance on the video (#163 §5) --------------------------------------
// A self-contained additive block, like the tag HUD. Draws only while a routine runs.
const TRAINER_HUD_PAD = 16;
const TRAINER_HUD_BIG = 22; // px, the instruction
const TRAINER_HUD_SMALL = 15; // px, the guidance + the cue label
const TRAINER_HUD_BAR = 4; // px, the coverage bar
/** Approximate glyph widths (no measureText: the headless recording-canvas test). */
const TRAINER_HUD_BIG_CHAR_W = 11.5;

/** How many characters fit on one line of the banner at this canvas width. The banner
 *  leaves room at the sides for the left/right cue stacks (and, on the left, for the
 *  Trainer panel's slim strip while a routine runs). */
const TRAINER_HUD_SIDE = 120;
/** The longest the banner may be, in px, and the most lines it shows. */
const TRAINER_HUD_MAX_W = 900;
const TRAINER_HUD_MAX_LINES = 3;

/** The banner's geometry for this snapshot at this width — shared by `measure` (the
 *  layout pass) and `draw`, so what is reserved is what is painted. */
function trainerHudBox(view: OverlayView, hud: TrainerHudSnapshot) {
  const boxW = Math.max(200, Math.min(view.W - 2 * TRAINER_HUD_SIDE, TRAINER_HUD_MAX_W));
  const maxChars = Math.max(12, Math.floor((boxW - 2 * TRAINER_HUD_PAD) / TRAINER_HUD_BIG_CHAR_W));
  const lines = clipLines(wrapLines(hud.say, maxChars), TRAINER_HUD_MAX_LINES, maxChars);
  const smallChars = Math.max(12, Math.floor((boxW - 2 * TRAINER_HUD_PAD) / (TRAINER_HUD_SMALL * 0.55)));
  const label = clipText(`${hud.index}/${hud.total} · ${hud.cueName}`, smallChars);
  const guidance = hud.guidance ? clipText(hud.guidance, smallChars) : null;
  const lineH = TRAINER_HUD_BIG + 8;
  const boxH = TRAINER_HUD_PAD * 2 + TRAINER_HUD_SMALL + 6 + lines.length * lineH + (guidance ? TRAINER_HUD_SMALL + 8 : 0) + TRAINER_HUD_BAR;
  return { boxW, boxH, lines, label, guidance, lineH };
}

/** Keep at most `max` lines; mark a dropped tail with an ellipsis (never silently). */
function clipLines(lines: string[], max: number, maxChars: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = clipText(`${kept[max - 1]} …`, maxChars);
  return kept;
}

function clipText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Paint the guidance banner at its laid-out origin: cue label, the instruction
 *  (wrapped), the latest nudge, and a coverage bar along the bottom edge. fillRect /
 *  fillText only. */
function drawTrainerHud(g: CanvasRenderingContext2D, view: OverlayView, hud: TrainerHudSnapshot): void {
  const { boxW, boxH, lines, label, guidance, lineH } = trainerHudBox(view, hud);
  const origin = view.layout.trainerHud ?? { x: (view.W - boxW) / 2, y: view.H - boxH - CUE_MARGIN };
  const x0 = origin.x;
  const y0 = origin.y;

  g.save();
  g.globalAlpha = 1;
  g.fillStyle = hud.status === 'between' ? 'rgba(16, 185, 129, 0.35)' : 'rgba(0, 0, 0, 0.6)';
  g.fillRect(x0, y0, boxW, boxH);
  g.textBaseline = 'top';
  g.textAlign = 'left';

  // Cue label, small, top-left of the banner.
  g.font = `600 ${TRAINER_HUD_SMALL}px ui-sans-serif, system-ui, sans-serif`;
  g.fillStyle = 'rgba(110, 231, 183, 0.9)';
  g.fillText(label, x0 + TRAINER_HUD_PAD, y0 + TRAINER_HUD_PAD);

  // The instruction (or the end phrase), large.
  g.font = `500 ${TRAINER_HUD_BIG}px ui-sans-serif, system-ui, sans-serif`;
  g.fillStyle = '#ffffff';
  let y = y0 + TRAINER_HUD_PAD + TRAINER_HUD_SMALL + 6;
  for (const line of lines) {
    g.fillText(line, x0 + TRAINER_HUD_PAD, y);
    y += lineH;
  }

  // The latest guidance, beneath, italic.
  if (guidance) {
    g.font = `italic ${TRAINER_HUD_SMALL}px ui-sans-serif, system-ui, sans-serif`;
    g.fillStyle = 'rgba(167, 243, 208, 0.95)';
    g.fillText(guidance, x0 + TRAINER_HUD_PAD, y);
  }

  // Coverage bar along the banner's bottom edge: the cue's own minimum, not a timer.
  const pct = Math.max(0, Math.min(1, hud.coverage));
  g.fillStyle = 'rgba(255, 255, 255, 0.15)';
  g.fillRect(x0, y0 + boxH - TRAINER_HUD_BAR, boxW, TRAINER_HUD_BAR);
  g.fillStyle = pct >= 1 ? '#34d399' : 'rgba(52, 211, 153, 0.7)';
  g.fillRect(x0, y0 + boxH - TRAINER_HUD_BAR, boxW * pct, TRAINER_HUD_BAR);
  g.restore();
}

export const trainerHud: OverlayElement = {
  name: 'trainerHud',
  category: 'guide',
  cue: true,
  positionOf: (view) => view.params.trainerHud.position,
  measure(view) {
    const hud = view.inputs.trainerHud;
    if (!hud || !view.params.trainerHud.show) return null;
    const { boxW, boxH } = trainerHudBox(view, hud);
    return { w: boxW, h: boxH };
  },
  draw(g, view) {
    const hud = view.inputs.trainerHud;
    if (!hud || !view.params.trainerHud.show) return;
    drawTrainerHud(g, view, hud);
  },
};
