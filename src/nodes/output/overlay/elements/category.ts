/**
 * The generic category readers: the label and the bars of whichever `CategoryScores` stream reads first (`pickCategories`).
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { clamp01 } from '@thoremin/sdk/features/math';
import { BAR_GAP, BAR_W, PAD, drawBarGraph, measureBarGraph, type BarGraphOpts, type BarSpec } from '@thoremin/sdk/overlay/bar_graph';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import { CHORD_COLOR, FACE_COLOR, type OverlayElement, type OverlayView } from '../view';

/** The category label's text, or null when nothing is named. */
function categoryText(view: OverlayView): string | null {
  const c = view.inputs.categories;
  if (!view.params.categoryLabel.show || !c?.present || !c.label) return null;
  return c.text ?? c.label;
}
const CATEGORY_CHAR_W = 0.62; // bold monospace glyph width per px of font size
const categoryLabelPx = (view: OverlayView): number => Math.round(40 + 160 * clamp01(view.params.categoryLabel.size));

/** One category reader's slot on the overlay (#600 S10b): its reading and, for a classifier, the
 *  captions aligned with its labels. */
export interface CategorySlot {
  scores: CategoryScores | null | undefined;
  captions?: readonly string[] | null | undefined;
}

/**
 * The category reading the cues draw (#384; pooled since #600 S10b): the first slot that reads,
 * classifiers before categorizers (each pool in priority order: the composer allocated it so);
 * with none reading, the first categorizer wired, so a player's own categories show at rest
 * rather than a general classifier's, else the first classifier (its captions with it, possibly
 * nothing at all). Captions belong to classifiers only.
 */
export function pickCategories(
  classifiers: readonly CategorySlot[],
  categorizers: readonly CategorySlot[],
): { categories: CategoryScores | null | undefined; categoryCaptions: readonly string[] | null | undefined } {
  const reading = classifiers.find((c) => c.scores?.present) ?? categorizers.find((c) => c.scores?.present);
  const chosen = reading ?? categorizers.find((c) => c.scores) ?? classifiers.find((c) => c.scores) ?? classifiers[0];
  if (!chosen) return { categories: undefined, categoryCaptions: undefined };
  return { categories: chosen.scores, categoryCaptions: classifiers.includes(chosen) ? chosen.captions : null };
}

/** A classifier's named class, written large (the ASL reader's letter or word). */
export const categoryLabelCue: OverlayElement = {
  name: 'categoryLabel',
  category: 'output',
  cue: true,
  positionOf: (view) => view.params.categoryLabel.position,
  measure(view) {
    const text = categoryText(view);
    if (text === null) return null;
    const px = categoryLabelPx(view);
    return { w: Math.ceil(text.length * px * CATEGORY_CHAR_W) + PAD * 2, h: Math.ceil(px * 0.95) + PAD * 2 };
  },
  draw(g, view) {
    const text = categoryText(view);
    const origin = view.layout['categoryLabel'];
    if (text === null || !origin) return;
    const px = categoryLabelPx(view);
    const w = Math.ceil(text.length * px * CATEGORY_CHAR_W) + PAD * 2;
    const h = Math.ceil(px * 0.95) + PAD * 2;
    g.save();
    g.globalAlpha = 0.45;
    g.fillStyle = '#000000';
    g.fillRect(origin.x, origin.y, w, h);
    g.globalAlpha = 1;
    g.fillStyle = CHORD_COLOR;
    g.font = `bold ${px}px monospace`;
    g.textAlign = 'center';
    g.fillText(text, origin.x + w / 2, origin.y + PAD + px * 0.8);
    g.restore();
  },
};

/** Bar geometry for `n` classes, narrowed so the graph fits 90% of the frame width. */
function categoryBarOpts(view: OverlayView, n: number): BarGraphOpts {
  const fit = Math.floor((view.W * 0.9 - PAD * 2) / Math.max(1, n));
  const step = Math.max(6, Math.min(BAR_W + BAR_GAP, fit));
  const gap = Math.max(2, Math.round(step * 0.3));
  return { barW: step - gap, gap, maxH: 48, title: view.inputs.categories?.title, labelColor: '#ffffff' };
}

function categoryBars(view: OverlayView): BarSpec[] | null {
  const c = view.inputs.categories;
  if (!view.params.categoryBars.show || !c?.present || !c.labels.length) return null;
  const captions = view.params.categoryBars.captions ? view.inputs.categoryCaptions : null;
  return c.labels.map((label, i) => {
    const caption = captions?.[i];
    return {
      value: clamp01(c.scores[i] ?? 0),
      color: FACE_COLOR,
      highlight: label === c.label,
      fired: (c.scores[i] ?? 0) >= 0.05,
      labels: caption ? [label, caption] : [label],
    };
  });
}

/** A bar per class of a classifier's reading (the face-expression idiom), winner in gold. */
export const categoryBarsCue: OverlayElement = {
  name: 'categoryBars',
  category: 'output',
  cue: true,
  positionOf: (view) => view.params.categoryBars.position,
  measure(view) {
    const bars = categoryBars(view);
    return bars ? measureBarGraph(bars, categoryBarOpts(view, bars.length)) : null;
  },
  draw(g, view) {
    const bars = categoryBars(view);
    const origin = view.layout['categoryBars'];
    if (!bars || !origin) return;
    drawBarGraph(g, origin.x, origin.y, bars, categoryBarOpts(view, bars.length));
  },
};
