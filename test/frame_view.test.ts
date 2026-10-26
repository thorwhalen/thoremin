/**
 * The frame-to-display transform (#817): stretch reproduces the hand-written expressions bit for
 * bit, cover and contain keep the aspect ratio, the mirror is applied once, and the inverse
 * round-trips. Landmarks come from a recorded fixture, not made-up numbers.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FITS, displayedUnit, drawFrame, fitRect, frameToDisplay, makeFrameView, type Fit } from '@thoremin/sdk/view/frame_view';
import { toDisplay } from '@thoremin/sdk/nodes/music/drum_pads';

const legacyMirrorX = (xPx: number, frameW: number, W: number): number => W - (xPx / frameW) * W;

interface Row {
  value: { width: number; height: number; hands: { keypoints: { x: number; y: number }[] }[] };
}
const rows: Row[] = readFileSync('test/fixtures/video_hand_sweep/src.hands.ndjson', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const keypoints = rows.flatMap((r) => r.value.hands.flatMap((h) => h.keypoints.map((k) => ({ ...k, w: r.value.width, h: r.value.height }))));

const CANVAS_4_3 = { width: 640, height: 480 };
const FRAME_16_9 = { width: 1280, height: 720 };

describe('stretch is the old math, bit for bit', () => {
  it('has real keypoints to test against', () => {
    expect(keypoints.length).toBeGreaterThan(100);
  });

  it('mirrored px equals mirrorX and (y/h)*H for every recorded keypoint', () => {
    for (const k of keypoints) {
      const v = makeFrameView({ width: 640, height: 480 }, { width: k.w, height: k.h });
      const p = v.px(k.x, k.y, { width: k.w, height: k.h });
      expect(p.x).toBe(legacyMirrorX(k.x, k.w, 640));
      expect(p.y).toBe((k.y / k.h) * 480);
    }
  });

  it('shown equals x*W, y*H', () => {
    const v = makeFrameView({ width: 800, height: 600 }, undefined);
    expect(v.shown(0.3, 0.7)).toEqual({ x: 0.3 * 800, y: 0.7 * 600 });
  });

  it('displayedUnit and the drum pads toDisplay agree', () => {
    expect(displayedUnit(160, 90, { width: 640, height: 360 })).toEqual(toDisplay(160, 90, 640, 360));
  });
});

describe('fit rectangles', () => {
  it('stretch fills the canvas', () => {
    expect(fitRect(FRAME_16_9, CANVAS_4_3, 'stretch')).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });

  it('cover keeps the aspect ratio, contains the canvas and is centred', () => {
    const r = fitRect(FRAME_16_9, CANVAS_4_3, 'cover');
    expect(r.w / r.h).toBeCloseTo(16 / 9, 10);
    expect(r.h).toBe(480);
    expect(r.x).toBeLessThan(0);
    expect(r.x + r.w).toBeCloseTo(640 - r.x, 10);
    expect(r.w).toBeGreaterThanOrEqual(640);
  });

  it('contain keeps the aspect ratio and sits inside the canvas', () => {
    const r = fitRect(FRAME_16_9, CANVAS_4_3, 'contain');
    expect(r.w / r.h).toBeCloseTo(16 / 9, 10);
    expect(r.w).toBe(640);
    expect(r.y).toBeGreaterThan(0);
    expect(r.y + r.h).toBeCloseTo(480 - r.y, 10);
  });

  it('a frame of the canvas aspect is placed identically by all three fits', () => {
    const same = { width: 320, height: 240 };
    for (const fit of FITS) expect(fitRect(same, CANVAS_4_3, fit)).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });
});

describe.each(FITS)('fit %s', (fit: Fit) => {
  const view = makeFrameView(CANVAS_4_3, FRAME_16_9, { fit });

  it('round-trips a displayed point through the canvas', () => {
    for (const [d, e] of [[0, 0], [0.25, 0.8], [1, 1], [0.5, 0.5]] as const) {
      const c = view.shown(d, e);
      const back = view.toShown(c.x, c.y);
      expect(back.x).toBeCloseTo(d, 10);
      expect(back.y).toBeCloseTo(e, 10);
    }
  });

  it('a keypoint lands where the drawn video puts the same frame pixel (matrix derived from the recorded canvas calls)', () => {
    // Independent of view.px: replay scale/translate/drawImage as a canvas would and map each frame pixel through it.
    const calls: [string, ...number[]][] = [];
    drawFrame(
      {
        scale: (...a) => void calls.push(['scale', ...a]),
        translate: (...a) => void calls.push(['translate', ...a]),
        drawImage: (_i, ...a) => void calls.push(['drawImage', ...(a as number[])]),
      },
      {} as unknown as CanvasImageSource,
      view,
    );
    const [sc, tr, di] = [calls[0]!, calls[1]!, calls[2]!];
    const onCanvas = (x: number, y: number) => {
      const imgX = (x / 1280) * di[3]!; // image space: drawImage(0, 0, dw, dh)
      const imgY = (y / 720) * di[4]!;
      return { x: sc[1]! * (imgX + tr[1]!), y: sc[2]! * (imgY + tr[2]!) };
    };
    for (const k of keypoints.slice(0, 50)) {
      const want = onCanvas(k.x, k.y);
      const got = view.px(k.x, k.y, FRAME_16_9);
      expect(got.x).toBeCloseTo(want.x, 8);
      expect(got.y).toBeCloseTo(want.y, 8);
    }
  });

  it('the mirror is applied exactly once: unmirrored px is the mirror image about the rect centre', () => {
    const plain = makeFrameView(CANVAS_4_3, FRAME_16_9, { fit, mirror: false });
    const a = view.px(300, 200, FRAME_16_9);
    const b = plain.px(300, 200, FRAME_16_9);
    expect(a.x + b.x).toBeCloseTo(2 * view.rect.x + view.rect.w, 8);
    expect(a.y).toBe(b.y);
  });

  it('the visible part is the whole frame unless cover crops it', () => {
    const v = view.visibleShown();
    if (fit === 'cover') {
      expect(v.w).toBeLessThan(1);
      expect(v.h).toBe(1);
      expect(v.x).toBeCloseTo((1 - v.w) / 2, 10);
    } else {
      expect(v).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    }
  });
});

describe('degenerate frames', () => {
  it('no frame, zero or non-finite size: the canvas itself (identity placement)', () => {
    for (const frame of [undefined, { width: 0, height: 0 }, { width: NaN, height: 480 }]) {
      expect(makeFrameView(CANVAS_4_3, frame, { fit: 'cover' }).rect).toEqual({ x: 0, y: 0, w: 640, h: 480 });
    }
  });
});

describe('drawFrame', () => {
  const record = (fit: Fit, mirror = true) => {
    const calls: unknown[][] = [];
    const g = {
      scale: (...a: number[]) => void calls.push(['scale', ...a]),
      translate: (...a: number[]) => void calls.push(['translate', ...a]),
      drawImage: (_i: unknown, ...a: number[]) => void calls.push(['drawImage', ...a]),
    };
    drawFrame(g, {} as unknown as CanvasImageSource, makeFrameView(CANVAS_4_3, FRAME_16_9, { fit, mirror }));
    return calls;
  };

  it('stretch emits the old backdrop calls exactly', () => {
    expect(record('stretch')).toEqual([['scale', -1, 1], ['translate', -640, 0], ['drawImage', 0, 0, 640, 480]]);
  });

  it('contain draws the full frame inside bars; cover overhangs', () => {
    const contain = record('contain');
    expect(contain[2]).toEqual(['drawImage', 0, 0, 640, 360]);
    expect(contain[1]).toEqual(['translate', -640, 60]);
    const cover = record('cover');
    expect((cover[2] as number[])[4]).toBe(480);
    expect((cover[2] as number[])[3]).toBeGreaterThan(640);
  });

  it('unmirrored translates to the rect origin without a flip', () => {
    expect(record('stretch', false)).toEqual([['translate', 0, 0], ['drawImage', 0, 0, 640, 480]]);
  });
});

describe('a zero-size canvas', () => {
  it('keeps the inverse and the visible part finite', () => {
    const v = makeFrameView({ width: 0, height: 0 }, FRAME_16_9);
    expect(v.toShown(5, 5)).toEqual({ x: 0, y: 0 });
    expect(v.visibleShown()).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('frameToDisplay', () => {
  it('is the per-call form of px', () => {
    expect(frameToDisplay(320, 180, 1280, 720, 640, 480, { fit: 'contain' })).toEqual(makeFrameView(CANVAS_4_3, FRAME_16_9, { fit: 'contain' }).px(320, 180, FRAME_16_9));
  });
});
