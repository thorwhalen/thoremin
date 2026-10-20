/** Caption layout on the cell grid (#805): wrapped, kept on the canvas, never covering each other. */
import { describe, expect, it } from 'vitest';
import { captionLines, layoutCaptions } from '../../packages/sdk/src/nodes/cell_grid_draw';

const overlap = (a: { cx: number; cy: number; w: number; h: number }, b: typeof a) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2;

describe('captionLines', () => {
  it('keeps a short caption on one line and splits a long one at the comma nearest its middle', () => {
    expect(captionLines('4th up')).toEqual(['4th up']);
    expect(captionLines('one held, to diminished, surprising')).toEqual(['one held, to diminished,', 'surprising']);
    expect(captionLines('averyveryverylongwordwithoutcommas')).toHaveLength(1);
  });
});

describe('layoutCaptions', () => {
  it('moves crowded captions apart, keeps them on the canvas and drops empty ones', () => {
    const caps = [
      { x: 0.5, y: 0.5, text: 'one held, to diminished, surprising' },
      { x: 0.5, y: 0.5, text: 'open, darker, surprising' },
      { x: 0.51, y: 0.52, text: 'smooth, darker' },
      { x: 0.99, y: 0.01, text: 'smooth, brighter, expected' },
      { x: 0.2, y: 0.2, text: '' },
    ];
    const boxes = layoutCaptions(caps, 960, 600);
    expect(boxes).toHaveLength(4);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      expect(b.cx - b.w / 2).toBeGreaterThanOrEqual(0);
      expect(b.cx + b.w / 2).toBeLessThanOrEqual(960);
      expect(b.cy - b.h / 2).toBeGreaterThanOrEqual(0);
      expect(b.cy + b.h / 2).toBeLessThanOrEqual(600);
      for (let j = 0; j < i; j++) expect(overlap(b, boxes[j])).toBe(false);
    }
  });

  it('leaves a lone caption where it was put', () => {
    const [b] = layoutCaptions([{ x: 0.3, y: 0.4, text: '4th up' }], 1000, 500);
    expect(b.cx).toBe(300);
    expect(b.cy).toBe(200);
  });
});
