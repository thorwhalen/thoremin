/**
 * The burned-in annotation (tag) HUD.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import type { TagOverlayFrame } from '@thoremin/taglog/presentation';
import type { OverlayElement, OverlayView } from '../view';

// ---- Live-tagging burned-in corner HUD (#92) ------------------------------------
// A self-contained additive block (first mover; keep it isolated so a concurrent
// OVERLAY_ELEMENTS addition merges cleanly). Draws only when a take is recording.
const TAG_HUD_CHAR_W = 7.6; // approx width of a 13px monospace glyph (no measureText,
//                              so the headless recording-canvas test needs no extra API)
const TAG_HUD_PAD = 8;
const TAG_HUD_ROW = 18;
const TAG_HUD_DOT = 7;

/** Paint the burned-in tag HUD: a REC-dot + timecode header, then one blinking chip
 *  per open tag, anchored to a top corner. Uses only fillRect/arc/fill/fillText so it
 *  matches the elements the settings panel + tests already exercise. */
function drawTagHud(g: CanvasRenderingContext2D, view: OverlayView, frame: TagOverlayFrame): void {
  const rows: { text: string; color: string }[] = [
    { text: `REC ${frame.timecode}`, color: '#ef4444' },
    ...frame.chips.map((c) => ({ text: c.label, color: c.color })),
  ];
  const textW = Math.max(...rows.map((r) => r.text.length)) * TAG_HUD_CHAR_W;
  const boxW = TAG_HUD_PAD + TAG_HUD_DOT + 6 + textW + TAG_HUD_PAD;
  const boxH = TAG_HUD_PAD * 2 + TAG_HUD_ROW * rows.length;
  const x0 = view.params.tagHud.position === 'left' ? 12 : view.W - boxW - 12;
  const y0 = 12;

  g.save();
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0, 0, 0, 0.55)';
  g.fillRect(x0, y0, boxW, boxH);
  g.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  rows.forEach((row, i) => {
    const cy = y0 + TAG_HUD_PAD + TAG_HUD_ROW * i + TAG_HUD_ROW / 2;
    const dx = x0 + TAG_HUD_PAD;
    // The dot pulses with the blink phase (a REC light), so a dropped frame shows.
    g.globalAlpha = frame.blinkOn ? 1 : 0.35;
    g.beginPath();
    g.arc(dx + TAG_HUD_DOT / 2, cy, TAG_HUD_DOT / 2, 0, Math.PI * 2);
    g.fillStyle = row.color;
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.fillText(row.text, dx + TAG_HUD_DOT + 6, cy);
  });
  g.restore();
}

export const tagHud: OverlayElement = {
  name: 'tagHud',
  category: 'output',
  draw(g, view) {
    const frame = view.inputs.tagOverlay;
    if (!frame || !view.params.tagHud.show) return;
    drawTagHud(g, view, frame);
  },
};
