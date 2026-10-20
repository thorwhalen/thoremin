/**
 * Where the HUD cues go: each on its edge, stacked when several share one.
 *
 * Part of the `canvas-overlay` node (`../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import type { CuePosition } from '../canvas_overlay.schema';
import { OVERLAY_ELEMENTS } from './elements/index';
import { CUE_MARGIN, type OverlayElement, type OverlayView } from './view';

// ---- Cue layout: stack the active cues along their chosen edges ------------------
const CUE_GAP = 10;
const CUE_TOP_INSET = 68; // leave room for the top-left brand / top-right panel
const CUE_BOTTOM_INSET = 68; // and for the tools bar / the object-cover crop band

/** Compute each active cue's top-left origin, auto-stacking cues that share an edge. */
export function layoutCues(view: OverlayView): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = {};
  const active = (view.elements ?? OVERLAY_ELEMENTS).filter((e) => e.cue).map((e) => ({
    e,
    pos: e.positionOf!(view),
    size: e.measure!(view),
  }));
  for (const edge of ['left', 'right', 'top', 'bottom'] as CuePosition[]) {
    const cues = active.filter((c) => c.size && c.pos === edge) as {
      e: OverlayElement;
      size: { w: number; h: number };
    }[];
    let off = edge === 'left' || edge === 'right' ? CUE_TOP_INSET : CUE_MARGIN;
    // A horizontal (top/bottom) edge lays its cues out side by side, centered. A WIDE
    // cue (a banner, wider than half the frame — the trainer's guidance) cannot share
    // that row: it gets its own row, below the top row or above the bottom one, so it
    // never paints over the chord name or a stacked cue.
    const wide = edge === 'top' || edge === 'bottom' ? cues.filter((c) => c.size.w > view.W / 2) : [];
    const rowCues = cues.filter((c) => !wide.includes(c));
    if (edge === 'top' || edge === 'bottom') {
      const totalW = rowCues.reduce((s, c) => s + c.size.w, 0) + Math.max(0, rowCues.length - 1) * CUE_GAP;
      off = Math.max(CUE_MARGIN, (view.W - totalW) / 2);
      const rowH = rowCues.reduce((m, c) => Math.max(m, c.size.h), 0);
      let yBand = edge === 'top' ? CUE_MARGIN + (rowH ? rowH + CUE_GAP : 0) : view.H - CUE_BOTTOM_INSET - (rowH ? rowH + CUE_GAP : 0);
      for (const { e, size } of wide) {
        const x = Math.max(CUE_MARGIN, (view.W - size.w) / 2);
        const y = edge === 'top' ? yBand : yBand - size.h;
        layout[e.name] = { x, y };
        yBand += edge === 'top' ? size.h + CUE_GAP : -(size.h + CUE_GAP);
      }
    }
    for (const { e, size } of rowCues) {
      let x = CUE_MARGIN;
      let y = CUE_MARGIN;
      if (edge === 'left') {
        x = CUE_MARGIN;
        y = off;
        off += size.h + CUE_GAP;
      } else if (edge === 'right') {
        x = view.W - size.w - CUE_MARGIN;
        y = off;
        off += size.h + CUE_GAP;
      } else if (edge === 'top') {
        x = off;
        y = CUE_MARGIN;
        off += size.w + CUE_GAP;
      } else {
        x = off;
        // Mirror the top inset: a 4:3 camera shown object-cover on a 16:9 viewport
        // loses ~60 px top and bottom, and the tools bar sits along the bottom edge.
        y = view.H - size.h - CUE_BOTTOM_INSET;
        off += size.w + CUE_GAP;
      }
      layout[e.name] = { x, y };
    }
  }
  return layout;
}
