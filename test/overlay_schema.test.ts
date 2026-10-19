/**
 * The overlay's contract module (#600 S6) agrees with its implementation: the element categories
 * the settings panel reads from `canvas_overlay.schema.ts` are exactly the elements' own, in draw
 * order, and the params schema the node uses is the one the module exports.
 */
import { describe, expect, it } from 'vitest';
import { canvasOverlayNode, OVERLAY_ELEMENTS } from '@/nodes/output/canvas_overlay';
import { OVERLAY_ELEMENT_CATEGORIES, OverlayParamsSchema } from '@/nodes/output/canvas_overlay.schema';

describe('canvas_overlay.schema', () => {
  it('lists every core element with its category, in draw order', () => {
    expect(Object.entries(OVERLAY_ELEMENT_CATEGORIES)).toEqual(OVERLAY_ELEMENTS.map((e) => [e.name, e.category]));
  });

  it('is the params schema the node parses with', () => {
    expect(canvasOverlayNode.params).toBe(OverlayParamsSchema);
  });
});
