/**
 * Tests the pure `resultToHandsFrame` converter of the `webcam-hands` node — the
 * tasks-vision HandLandmarker result (normalized landmarks) → a HandsFrame with
 * pixel keypoints in MediaPipe's 21-point order. The live inference is
 * browser-only; this verifies the headless conversion (coords + handedness).
 */
import { describe, it, expect } from 'vitest';
import { resultToHandsFrame, type HandLandmarkerResultLike } from '@/nodes/sources/webcam_hands';

describe('resultToHandsFrame', () => {
  it('scales normalized landmarks to pixels and keeps the 21-point order', () => {
    const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: i / 20, y: 0.5, z: 0 }));
    const res: HandLandmarkerResultLike = { landmarks: [landmarks], handedness: [[{ categoryName: 'Left' }]] };
    const frame = resultToHandsFrame(res, 640, 480);
    expect(frame.width).toBe(640);
    expect(frame.hands).toHaveLength(1);
    expect(frame.hands[0].keypoints).toHaveLength(21);
    // index 0 → x 0; index 20 → x = 640 (full width); y always 240.
    expect(frame.hands[0].keypoints[0]).toMatchObject({ x: 0, y: 240 });
    expect(frame.hands[0].keypoints[20].x).toBeCloseTo(640, 5);
    expect(frame.hands[0].handedness).toBe('Left');
  });

  it('maps each detected hand and defaults missing handedness to Right', () => {
    const one = [{ x: 0.5, y: 0.5, z: 0 }];
    const res: HandLandmarkerResultLike = { landmarks: [one, one], handedness: [[{ categoryName: 'Right' }]] };
    const frame = resultToHandsFrame(res, 100, 100);
    expect(frame.hands).toHaveLength(2);
    expect(frame.hands[0].handedness).toBe('Right');
    expect(frame.hands[1].handedness).toBe('Right'); // no handedness entry → default
  });

  it('returns an empty hand list when nothing is detected', () => {
    const frame = resultToHandsFrame({ landmarks: [], handedness: [] }, 640, 480);
    expect(frame.hands).toEqual([]);
  });
});
