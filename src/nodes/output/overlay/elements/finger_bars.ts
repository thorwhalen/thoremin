/**
 * The finger bar graph cue.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { clamp01 } from '@thoremin/sdk/features/math';
import { drawBarGraph, measureBarGraph, type BarSpec } from '@thoremin/sdk/overlay/bar_graph';
import { EFFECT_SHORT } from '../../../mapping/hand_map';
import { FINGER_NAMES, type FingerName } from '@thoremin/sdk/nodes/domain';
import { LEFT_COLOR, type OverlayElement, type OverlayView, RIGHT_COLOR } from '../view';

export const fingerBarsCue: OverlayElement = {
  name: 'fingerBars',
  category: 'output',
  cue: true,
  positionOf: (view) => view.params.fingerBars.position,
  measure(view) {
    if (!view.params.fingerBars.show) return null;
    const { items } = routedFingers(view);
    if (!items.length) return null;
    return measureBarGraph(
      items.map(() => ({ value: 0, labels: ['x'] })),
      { title: 'fingers' },
    );
  },
  draw(g, view) {
    const origin = view.layout['fingerBars'];
    if (!origin) return;
    const { side, items } = routedFingers(view);
    if (!items.length) return;
    // Colour by the hand actually being read (right preferred), not always emerald.
    const color = side === 'left' ? LEFT_COLOR : RIGHT_COLOR;
    const bars: BarSpec[] = items.map(({ name, target, value }) => ({
      value: clamp01(value),
      color,
      labels: [`${name[0]}·${EFFECT_SHORT[target]}`],
    }));
    drawBarGraph(g, origin.x, origin.y, bars, { title: 'fingers', labelColor: color });
  },
};

/** The routed fingers + the closeness of the present hand (right preferred), plus which
 *  hand was read (so the bar graph can colour-match it). */
function routedFingers(view: OverlayView): {
  side: 'right' | 'left' | null;
  items: { name: FingerName; target: keyof typeof EFFECT_SHORT; value: number }[];
} {
  const routes = view.inputs.handMap?.fingers;
  const feats = view.inputs.features;
  if (!routes || !feats) return { side: null, items: [] };
  const side: 'right' | 'left' | null = feats.right.present ? 'right' : feats.left.present ? 'left' : null;
  const hand = side === 'right' ? feats.right : side === 'left' ? feats.left : null;
  if (!hand) return { side: null, items: [] };
  const items: { name: FingerName; target: keyof typeof EFFECT_SHORT; value: number }[] = [];
  for (const name of FINGER_NAMES) {
    const r = routes[name];
    if (!r || r.target === 'none') continue;
    items.push({ name, target: r.target, value: hand.fingers[name] });
  }
  return { side, items };
}

// ---- Chord overlays (#89): a chord-name cue + a keyboard strip ------------------
