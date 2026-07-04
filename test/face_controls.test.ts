/**
 * Tests the `face-controls` node (issue #76): a face frame → deliberate control
 * axes (head yaw/pitch/roll, jaw-open, smile↔frown, brow-raise, lip-pucker).
 * Unit cases run with `smoothing: 0` so a single tick reflects the raw mapping;
 * a separate case exercises the EMA easing.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { faceControlsNode } from '@/nodes';
import { ABSENT_FACE_CONTROLS, type FaceControls, type FaceFrame, type HeadPose } from '@/nodes/domain';

const frame = (blendshapes: Record<string, number>, headPose?: HeadPose): FaceFrame => ({
  present: true,
  blendshapes,
  ...(headPose ? { headPose } : {}),
});

async function run(input: FaceFrame, params: Record<string, unknown> = {}): Promise<FaceControls> {
  const p = faceControlsNode.params.parse({ smoothing: 0, ...params });
  const [out] = await replayNode(faceControlsNode.make(p), { face: [input] });
  return out.controls as FaceControls;
}

describe('face-controls node (unit)', () => {
  it('returns absent controls when no face is present', async () => {
    const c = await run({ present: false, blendshapes: {} });
    expect(c).toEqual(ABSENT_FACE_CONTROLS);
  });

  it('maps jaw-open through the deadzone + rescale', async () => {
    const c = await run(frame({ jawOpen: 0.5 })); // default mouthDeadzone 0.08
    expect(c.present).toBe(true);
    expect(c.mouthOpen).toBeCloseTo((0.5 - 0.08) / (1 - 0.08), 5);
  });

  it('rejects rest jitter below the deadzone', async () => {
    const c = await run(frame({ jawOpen: 0.05 }));
    expect(c.mouthOpen).toBe(0);
  });

  it('maps smile as the positive side of the bipolar smile↔frown axis', async () => {
    const c = await run(frame({ mouthSmileLeft: 0.8, mouthSmileRight: 0.6 }));
    // avg 0.7, smileDeadzone 0.06 → (0.7-0.06)/(1-0.06)
    expect(c.smileFrown).toBeCloseTo((0.7 - 0.06) / (1 - 0.06), 5);
  });

  it('maps frown as the negative side', async () => {
    const c = await run(frame({ mouthFrownLeft: 0.5, mouthFrownRight: 0.5 }));
    expect(c.smileFrown).toBeCloseTo(-((0.5 - 0.06) / (1 - 0.06)), 5);
  });

  it('averages both brows for brow-raise', async () => {
    const c = await run(frame({ browInnerUp: 0.6, browOuterUpLeft: 0.6, browOuterUpRight: 0.6 }));
    expect(c.browRaise).toBeCloseTo((0.6 - 0.1) / (1 - 0.1), 5); // browDeadzone 0.1
  });

  it('reads lip-pucker from pucker + funnel', async () => {
    const c = await run(frame({ mouthPucker: 0.7, mouthFunnel: 0.5 })); // avg 0.6
    expect(c.lipPucker).toBeCloseTo((0.6 - 0.12) / (1 - 0.12), 5); // puckerDeadzone 0.12
  });

  it('maps head yaw to a bipolar axis at full scale', async () => {
    const c = await run(frame({}, { yaw: 30, pitch: 0, roll: 0 })); // headRangeDeg 30
    expect(c.headYaw).toBeCloseTo(1, 5);
    expect(c.headPitch).toBe(0);
    expect(c.headRoll).toBe(0);
  });

  it('maps a partial head yaw through the deadzone', async () => {
    const c = await run(frame({}, { yaw: 15, pitch: 0, roll: 0 }));
    // norm 0.5, deadzone 3/30 = 0.1 → (0.5-0.1)/(1-0.1)
    expect(c.headYaw).toBeCloseTo((0.5 - 0.1) / (1 - 0.1), 5);
  });

  it('clamps extreme head angles to ±1', async () => {
    const c = await run(frame({}, { yaw: 90, pitch: -90, roll: 0 }));
    expect(c.headYaw).toBe(1);
    expect(c.headPitch).toBe(-1);
  });

  it('honors a negative per-axis gain to flip direction', async () => {
    const c = await run(frame({}, { yaw: 30, pitch: 0, roll: 0 }), { yawGain: -1 });
    expect(c.headYaw).toBeCloseTo(-1, 5);
  });

  it('applies the neutral zero (recenter) before scaling', async () => {
    // With the zero at 20°, a 20° yaw reads as neutral (0).
    const c = await run(frame({}, { yaw: 20, pitch: 0, roll: 0 }), { yawZeroDeg: 20 });
    expect(c.headYaw).toBe(0);
  });

  it('keeps blendshape axes working when the head pose is absent (present stays true)', async () => {
    const c = await run(frame({ jawOpen: 0.5 })); // no headPose
    expect(c.present).toBe(true);
    expect(c.headYaw).toBe(0);
    expect(c.headPitch).toBe(0);
    expect(c.mouthOpen).toBeGreaterThan(0);
  });

  it('eases toward the target under smoothing (does not jump)', async () => {
    const p = faceControlsNode.params.parse({ smoothing: 0.5 });
    const node = faceControlsNode.make(p);
    const f = frame({ jawOpen: 1 }); // target mouthOpen = (1-0.08)/(1-0.08) = 1
    const outs = await replayNode(node, { face: [f, f, f] });
    // Ticks ease 0 → 0.5 → 0.75 → 0.875: monotonic, never overshooting the target.
    const seq = outs.map((o) => (o.controls as FaceControls).mouthOpen);
    expect(seq[0]).toBeCloseTo(0.5, 5);
    expect(seq[2]).toBeGreaterThan(seq[0]);
    expect(seq[2]).toBeLessThan(1);
  });
});
