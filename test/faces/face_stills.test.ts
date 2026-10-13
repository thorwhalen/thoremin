/**
 * Stills at capture and supporting frames (#385 E3), the pure parts: the face's crop box from
 * the live vector (nose tip and outer-eye span), clamped into the frame; and each hold's
 * supporting frames, taken from its own dwell window, thinned, the face's keys only.
 */
import { describe, expect, it } from 'vitest';
import { FACE_CROP, faceRegion } from '@thoremin/ext-faces/app/modality';
import { clampBox, holdId } from '@thoremin/ext-faces/app/thumbnails';
import { createFaceTake, FACE_TAKE_DEFAULTS } from '@thoremin/ext-faces/lib/take';
import { SYNTHETIC_TIMELINE, syntheticFaceVector } from '@thoremin/ext-faces/lib/synthetic';

describe('the face crop', () => {
  it('is a square around the nose tip, sized by the outer-eye span, raised a little', () => {
    const box = faceRegion({ vector: { 'face.head.x': 0.5, 'face.head.y': 0.5, 'face.head.scale': 0.1 }, width: 640, height: 480 })!;
    const side = FACE_CROP.sideSpans * 0.1 * 640;
    expect(box.w).toBeCloseTo(side, 9);
    expect(box.h).toBeCloseTo(side, 9);
    expect(box.x + box.w / 2).toBeCloseTo(320, 9);
    expect(box.y + box.h / 2).toBeCloseTo(240 - FACE_CROP.raise * side, 9);
    // Twice as far from the camera: half the span, half the box, same place.
    const far = faceRegion({ vector: { 'face.head.x': 0.5, 'face.head.y': 0.5, 'face.head.scale': 0.05 }, width: 640, height: 480 })!;
    expect(far.w).toBeCloseTo(box.w / 2, 9);
  });

  it('is the whole frame (null) when the vector does not place the face', () => {
    expect(faceRegion({ vector: {}, width: 640, height: 480 })).toBeNull();
    expect(faceRegion({ vector: { 'face.head.x': 0.5, 'face.head.y': 0.5, 'face.head.scale': NaN }, width: 640, height: 480 })).toBeNull();
    expect(faceRegion({ vector: { 'face.head.x': 0.5, 'face.head.y': 0.5, 'face.head.scale': 0.1 }, width: 0, height: 480 })).toBeNull();
    // The synthetic face carries no head position: its stills are the whole canvas.
    expect(faceRegion({ vector: syntheticFaceVector(5000, 150), width: 160, height: 120 })).toBeNull();
  });

  it('is clamped into the frame, or dropped when nothing of it is inside', () => {
    expect(clampBox({ x: -10, y: -10, w: 50, h: 50 }, 100, 100)).toEqual({ x: 0, y: 0, w: 40, h: 40 });
    expect(clampBox({ x: 90, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 });
    expect(clampBox({ x: 200, y: 0, w: 50, h: 50 }, 100, 100)).toBeNull();
  });

  it('keys a still by its hold id', () => {
    expect(holdId('take-abc', 3)).toBe('take-abc:3');
  });
});

describe('a hold\'s supporting frames', () => {
  it('come from its own dwell window, thinned, with the face\'s keys only', () => {
    const take = createFaceTake();
    take.start(0);
    const ms = SYNTHETIC_TIMELINE.restMs + 6 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
    const at: { t: number; n: number }[] = [];
    for (let f = 0, t = 0; t <= ms; f++, t = (f * 1000) / 30) {
      take.push({ ...syntheticFaceVector(t, f), 'hand.right.x': 0.5 }, t);
      at.push({ t, n: take.pointCount() });
    }
    expect(take.stop()).toBe(true);
    const points = take.session().points();
    expect(points.length).toBeGreaterThan(2);
    points.forEach((p, i) => {
      const support = take.support(i);
      expect(support.length).toBeGreaterThan(1);
      expect(support.length).toBeLessThanOrEqual(FACE_TAKE_DEFAULTS.supportFrames);
      for (const frame of support) expect(Object.keys(frame).every((k) => k.startsWith('face.'))).toBe(true);
      // Taken when the point was: no frame from after it (the next hold's).
      const takenAt = at.find((x) => x.n > i)!.t;
      expect(takenAt - p.t).toBeLessThan(FACE_TAKE_DEFAULTS.supportWindowMs);
    });
    expect(take.support(points.length)).toEqual([]);
  });

  it('are none when asked for none', () => {
    const take = createFaceTake({ supportFrames: 0 });
    take.start(0);
    const ms = SYNTHETIC_TIMELINE.restMs + 4 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
    for (let f = 0, t = 0; t <= ms; f++, t = (f * 1000) / 30) take.push(syntheticFaceVector(t, f), t);
    take.stop();
    expect(take.session().points().length).toBeGreaterThan(0);
    expect(take.support(0)).toEqual([]);
  });
});
