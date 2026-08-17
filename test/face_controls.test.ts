/**
 * Tests the `face-controls` node (issue #76): a face frame → deliberate control
 * axes (head yaw/pitch/roll, jaw-open, smile↔frown, brow-raise, lip-pucker).
 * Unit cases run with `smoothing: 0` so a single tick reflects the raw mapping;
 * a separate case exercises the EMA easing.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { faceControlsNode } from '@/nodes';
import {
  FaceControlsDialSchema,
  DEFAULT_FACE_CONTROLS_DIAL,
} from '@/nodes/features/face_controls';
import { structuredLeafPaths } from '@/app/commands/paths';
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

/**
 * The LIVE `config` input (#76) — the dial's override of the node's build-time params.
 *
 * Why this block exists at all: the axes shipped in PR #86 with their gains, deadzones and
 * neutral zeros settable only by editing the node's source. That made the one check this
 * repo genuinely cannot do headlessly — whether a real camera's yaw/pitch/roll signs match
 * the intended felt direction — cost a source edit and a rebuild. These cases pin the
 * mechanism that turns it into a knob.
 */
describe('face-controls live config override (#76)', () => {
  /** Replay one frame with an explicit build-time param set AND a live config. */
  async function runLive(
    input: FaceFrame,
    params: Record<string, unknown>,
    config: Record<string, unknown> | undefined,
  ): Promise<FaceControls> {
    const p = faceControlsNode.params.parse({ smoothing: 0, ...params });
    const [out] = await replayNode(faceControlsNode.make(p), {
      face: [input],
      ...(config ? { config: [config] } : {}),
    });
    return out.controls as FaceControls;
  }

  const pose = (yaw: number): HeadPose => ({ yaw, pitch: 0, roll: 0 });

  it('a live gain OVERRIDES the build-time param', async () => {
    const built = await runLive(frame({}, pose(15)), { yawGain: 1 }, undefined);
    const live = await runLive(frame({}, pose(15)), { yawGain: 1 }, { yawGain: 0.5 });
    expect(built.headYaw).toBeGreaterThan(0);
    expect(live.headYaw).toBeCloseTo(built.headYaw * 0.5, 6);
  });

  it('a NEGATIVE live gain flips the felt direction — the axis-sign fix, without a rebuild', async () => {
    const fwd = await runLive(frame({}, pose(15)), { yawGain: 1 }, undefined);
    const flipped = await runLive(frame({}, pose(15)), { yawGain: 1 }, { yawGain: -1 });
    expect(fwd.headYaw).toBeGreaterThan(0);
    expect(flipped.headYaw).toBeCloseTo(-fwd.headYaw, 6);
  });

  it('overrides a BLENDSHAPE axis too, not only the head axes', async () => {
    const built = await runLive(frame({ jawOpen: 0.5 }), {}, undefined);
    const live = await runLive(frame({ jawOpen: 0.5 }), {}, { mouthGain: 0.5 });
    expect(live.mouthOpen).toBeCloseTo(built.mouthOpen * 0.5, 6);
  });

  it('is PARTIAL — an override of one field leaves the others on their build-time values', async () => {
    const c = await runLive(frame({ jawOpen: 0.5 }, pose(15)), { yawGain: 2 }, { mouthGain: 0.5 });
    const baseline = await runLive(frame({ jawOpen: 0.5 }, pose(15)), { yawGain: 2 }, undefined);
    // mouthGain was overridden…
    expect(c.mouthOpen).toBeCloseTo(baseline.mouthOpen * 0.5, 6);
    // …and yawGain: 2 survived it. (A `{...live}` that replaced rather than merged, or a
    // `q` that read the live object alone, would silently reset yaw to the schema default.)
    expect(c.headYaw).toBeCloseTo(baseline.headYaw, 6);
  });

  it('with NO config wired, the build-time params still rule (the headless fixture path)', async () => {
    const c = await runLive(frame({}, pose(15)), { yawGain: -1 }, undefined);
    expect(c.headYaw).toBeLessThan(0);
  });

  it('smoothing is read per-tick, so the live config can change the easing', async () => {
    // Two ticks of a held pose. With smoothing 0 the first tick already lands on target;
    // with the live 0.9 it must still be easing well short of it. If `smoothing` were
    // closed over at make() time (the pre-#76 shape), the override would be ignored.
    const p = faceControlsNode.params.parse({ smoothing: 0 });
    const f = frame({}, pose(20));
    const [, slow] = await replayNode(faceControlsNode.make(p), {
      face: [f, f],
      config: [{ smoothing: 0.9 }, { smoothing: 0.9 }],
    });
    const [, fast] = await replayNode(faceControlsNode.make(p), { face: [f, f] });
    expect((slow.controls as FaceControls).headYaw).toBeLessThan((fast.controls as FaceControls).headYaw);
  });
});

/** The dial SSOT (#76): the `faceControls` dial IS the node's params schema. */
describe('faceControls dial is the node schema, not a copy (#76)', () => {
  it('the dial schema is literally the node params schema', () => {
    expect(FaceControlsDialSchema).toBe(faceControlsNode.params);
  });

  it('every node param is an addressable `dial.setIn` leaf — no knob is unreachable', () => {
    const paths = new Set(structuredLeafPaths());
    for (const key of Object.keys(DEFAULT_FACE_CONTROLS_DIAL)) {
      expect(paths.has(`faceControls.${key}`)).toBe(true);
    }
  });

  it('the shipped default is what the schema parses from nothing (no drifted second copy)', () => {
    expect(DEFAULT_FACE_CONTROLS_DIAL).toEqual(FaceControlsDialSchema.parse({}));
  });

  it('EVERY field carries a default — the invariant the store heal parses raw on', () => {
    // `mergeControls` heals a partial saved blob with a bare `.parse(blob)`, which only
    // completes the missing knobs because each one declares a default. If a field is ever
    // added without one, `parse({})` throws — and that throw is at MODULE LOAD, because
    // DEFAULT_FACE_CONTROLS_DIAL is built from it. This pins the property explicitly so
    // the reason survives even if that construction is refactored.
    for (const key of Object.keys(FaceControlsDialSchema.shape)) {
      expect(FaceControlsDialSchema.parse({})).toHaveProperty(key);
    }
    // …and a partial parse really does fill the rest rather than rejecting it.
    const partial = FaceControlsDialSchema.parse({ yawGain: -1 });
    expect(partial.yawGain).toBe(-1);
    expect(partial.headRangeDeg).toBe(DEFAULT_FACE_CONTROLS_DIAL.headRangeDeg);
  });
});
