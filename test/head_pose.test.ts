/**
 * Tests `matrixToHeadPose` (issue #76): decoding MediaPipe's facial
 * transformation matrix into head yaw/pitch/roll degrees. We build a
 * column-major rotation matrix from KNOWN angles using the matching intrinsic
 * Y-X-Z composition and assert the decode round-trips them — so the decode is
 * verified against its own convention without a live camera. Sign/feel live
 * tuning is the `face-controls` node's job (per-axis gain), not this decode's.
 */
import { describe, it, expect } from 'vitest';
import { matrixToHeadPose, ZERO_HEAD_POSE } from '@/nodes/domain';

const DEG = Math.PI / 180;

/**
 * A 16-element COLUMN-MAJOR 4x4 rotation matrix from (pitch, yaw, roll) degrees
 * under the intrinsic Y-X-Z order — the exact composition `matrixToHeadPose`
 * inverts (three.js `makeRotationFromEuler` order 'YXZ'). Column-major layout:
 * element (row, col) sits at index `col*4 + row`.
 */
function yxzColumnMajor(pitchDeg: number, yawDeg: number, rollDeg: number): number[] {
  const c1 = Math.cos(pitchDeg * DEG); // x
  const s1 = Math.sin(pitchDeg * DEG);
  const c2 = Math.cos(yawDeg * DEG); // y
  const s2 = Math.sin(yawDeg * DEG);
  const c3 = Math.cos(rollDeg * DEG); // z
  const s3 = Math.sin(rollDeg * DEG);
  const te = new Array(16).fill(0);
  te[0] = c2 * c3 + s1 * s2 * s3; // m11
  te[4] = s1 * s2 * c3 - c2 * s3; // m12
  te[8] = c1 * s2; // m13
  te[1] = c1 * s3; // m21
  te[5] = c1 * c3; // m22
  te[9] = -s1; // m23
  te[2] = c2 * s1 * s3 - s2 * c3; // m31
  te[6] = s2 * s3 + c2 * s1 * c3; // m32
  te[10] = c1 * c2; // m33
  te[15] = 1;
  return te;
}

describe('matrixToHeadPose', () => {
  it('decodes the identity as facing the camera (all zero)', () => {
    expect(matrixToHeadPose(yxzColumnMajor(0, 0, 0))).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });

  it('round-trips a pure yaw', () => {
    const p = matrixToHeadPose(yxzColumnMajor(0, 20, 0));
    expect(p.yaw).toBeCloseTo(20, 4);
    expect(p.pitch).toBeCloseTo(0, 4);
    expect(p.roll).toBeCloseTo(0, 4);
  });

  it('round-trips a pure pitch', () => {
    const p = matrixToHeadPose(yxzColumnMajor(15, 0, 0));
    expect(p.pitch).toBeCloseTo(15, 4);
    expect(p.yaw).toBeCloseTo(0, 4);
    expect(p.roll).toBeCloseTo(0, 4);
  });

  it('round-trips a pure roll', () => {
    const p = matrixToHeadPose(yxzColumnMajor(0, 0, 10));
    expect(p.roll).toBeCloseTo(10, 4);
    expect(p.yaw).toBeCloseTo(0, 4);
    expect(p.pitch).toBeCloseTo(0, 4);
  });

  it('round-trips a combined rotation', () => {
    const p = matrixToHeadPose(yxzColumnMajor(15, 20, 10));
    expect(p.pitch).toBeCloseTo(15, 4);
    expect(p.yaw).toBeCloseTo(20, 4);
    expect(p.roll).toBeCloseTo(10, 4);
  });

  it('round-trips negative angles', () => {
    const p = matrixToHeadPose(yxzColumnMajor(-12, -25, -8));
    expect(p.pitch).toBeCloseTo(-12, 4);
    expect(p.yaw).toBeCloseTo(-25, 4);
    expect(p.roll).toBeCloseTo(-8, 4);
  });

  it('degrades gracefully at the gimbal (pitch ≈ 90°): no NaN, roll folded to 0', () => {
    const p = matrixToHeadPose(yxzColumnMajor(90, 30, 20));
    expect(Number.isNaN(p.yaw)).toBe(false);
    expect(Number.isNaN(p.pitch)).toBe(false);
    expect(p.pitch).toBeCloseTo(90, 2);
    expect(p.roll).toBe(0);
  });

  it('accepts a Float32Array (the live MediaPipe payload type)', () => {
    const p = matrixToHeadPose(Float32Array.from(yxzColumnMajor(0, 18, 0)));
    expect(p.yaw).toBeCloseTo(18, 4);
  });

  it('returns the zero pose for a malformed / too-short matrix', () => {
    expect(matrixToHeadPose(undefined)).toEqual(ZERO_HEAD_POSE);
    expect(matrixToHeadPose([])).toEqual(ZERO_HEAD_POSE);
    expect(matrixToHeadPose([1, 0, 0, 0])).toEqual(ZERO_HEAD_POSE);
    // A fresh object each call (not a shared mutable constant).
    expect(matrixToHeadPose(undefined)).not.toBe(ZERO_HEAD_POSE);
  });
});
