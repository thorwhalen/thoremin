/**
 * The #76 axis-sign check, run headlessly against a real recording (#146 §1).
 *
 * The yaw/pitch/roll axes in `face_controls.ts` were tuned with no camera. Their
 * MAGNITUDES were plausible; their SIGNS were a coin-flip, because they depend on
 * MediaPipe's camera convention, which `src/nodes/domain.ts` explicitly declines to
 * assert. Until now the only way to settle that was a live webcam session — which
 * recurs every time anyone touches face mapping, and which no agent can perform.
 *
 * `test/fixtures/video_head_pose/` is a decoded 13.5 s clip with a written ground truth
 * (see its README). This suite pins the signs against it, at two levels:
 *
 *  1. **The decoder** — what `matrixToHeadPose` reports for a known head position.
 *  2. **The mapped output** — what `face-controls` actually emits, which is what the
 *     instrument hears. A test that only checked (1) would stay green if someone
 *     "fixed" a sign by flipping a gain and a convention at once.
 *
 * ## What this suite deliberately does NOT assert
 *
 * - **Roll.** The clip's largest roll is 7.1°, an incidental tilt rather than a
 *   deliberate ear-to-shoulder move. Asserting a sign off 7° against a 30°
 *   `headRangeDeg` would be pinning noise.
 * - **Yaw/roll in BODY terms.** Assertions are written in IMAGE terms (the head turns
 *   toward image-left / image-right) because that is what is measurable from a file.
 *   Mapping that to the person's own left/right needs to know whether the recording is
 *   mirrored (iOS *Mirror Front Camera*, off by default, not recorded in metadata).
 *   Pitch, smile and brow are immune to horizontal mirroring, which is why they carry
 *   the load here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { replayNode } from '@/dag';
import { matrixToHeadPose, type FaceControls, type FaceFrame } from '@/nodes/domain';
import { faceControlsNode } from '@/nodes/features/face_controls';
import { loadStream } from './helpers/fixtures';

const SC = 'video_head_pose';
/** The decoder reports 29.3 fps effective over the 405-frame clip. */
const FPS = 29.3;

interface PoseRecord {
  present: boolean;
  blendshapes: Record<string, number>;
  transformMatrix: number[];
}

const frames = loadStream(SC, 'face.pose') as PoseRecord[];

/** The fixture frame nearest a wall-clock second, as a live-shaped `FaceFrame`. */
function frameAt(t: number): FaceFrame {
  const r = frames[Math.min(frames.length - 1, Math.round(t * FPS))];
  return { present: r.present, blendshapes: r.blendshapes, headPose: matrixToHeadPose(r.transformMatrix) };
}

/** Mean of a field over a time window — a window, not a single frame, so one noisy
 *  frame cannot decide a sign. */
function meanOver(from: number, to: number, pick: (f: FaceFrame) => number): number {
  const a = Math.round(from * FPS);
  const b = Math.round(to * FPS);
  let sum = 0;
  for (let i = a; i <= b; i++) sum += pick(frameAt(i / FPS));
  return sum / (b - a + 1);
}

/**
 * `face-controls` driven over the WHOLE clip once with its shipped defaults, so every
 * window assertion reads a settled, correctly-smoothed value. Replaying the whole stream
 * (rather than a per-window instance) is what makes the node's EMA meaningful — a window
 * started cold would measure the smoother's warm-up, not the pose.
 */
let controls: FaceControls[] = [];

beforeAll(async () => {
  const stream = frames.map((_, i) => frameAt(i / FPS));
  const out = await replayNode(faceControlsNode.make(faceControlsNode.params.parse({})), { face: stream });
  controls = out.map((o) => o.controls as FaceControls);
});

/** Average one axis of the node OUTPUT over a window — what the instrument hears. */
function controlsMeanOver(from: number, to: number, axis: keyof FaceControls): number {
  const a = Math.round(from * FPS);
  const b = Math.round(to * FPS);
  let sum = 0;
  for (let i = a; i <= b; i++) sum += controls[i][axis] as number;
  return sum / (b - a + 1);
}

describe('the fixture is intact', () => {
  it('loads 405 frames with a face present in every one', () => {
    expect(frames).toHaveLength(405);
    expect(frames.every((f) => f.present)).toBe(true);
    expect(frames.every((f) => f.transformMatrix?.length === 16)).toBe(true);
  });
});

describe('#76 pitch — SETTLED (mirroring cannot affect it)', () => {
  it('chin UP (0.3–1.4 s, looking at the ceiling) decodes as NEGATIVE pitch', () => {
    expect(meanOver(0.5, 1.2, (f) => f.headPose!.pitch)).toBeLessThan(-20);
    expect(frameAt(0.96).headPose!.pitch).toBeCloseTo(-36.7, 0);
  });

  it('chin DOWN (1.7–3.3 s) decodes as POSITIVE pitch', () => {
    expect(meanOver(2.4, 3.1, (f) => f.headPose!.pitch)).toBeGreaterThan(15);
  });

  it('the two are opposite in sign — the axis is real, not an offset', () => {
    const up = meanOver(0.5, 1.2, (f) => f.headPose!.pitch);
    const down = meanOver(2.4, 3.1, (f) => f.headPose!.pitch);
    expect(Math.sign(up)).toBe(-Math.sign(down));
    expect(Math.abs(up - down)).toBeGreaterThan(40);
  });

  it('MAPPED: chin UP drives headPitch POSITIVE (an octave UP, per #146 check 2)', () => {
    // This is the assertion that the shipped default has to satisfy. MediaPipe reports
    // chin-up as NEGATIVE pitch, so `pitchGain` must be negative for "look up = up".
    // Before this was measured, `pitchGain` defaulted to +1 and the axis was inverted.
    expect(controlsMeanOver(0.5, 1.2, 'headPitch')).toBeGreaterThan(0.3);
  });

  it('MAPPED: chin DOWN drives headPitch NEGATIVE', () => {
    expect(controlsMeanOver(2.4, 3.1, 'headPitch')).toBeLessThan(-0.2);
  });
});

describe('#76 yaw — measured, but stated in IMAGE terms', () => {
  it('head toward image-RIGHT (6.0–7.0 s) decodes as POSITIVE yaw', () => {
    expect(meanOver(6.3, 6.9, (f) => f.headPose!.yaw)).toBeGreaterThan(25);
  });

  it('head toward image-LEFT (3.9–4.6 s) decodes as NEGATIVE yaw', () => {
    expect(meanOver(4.1, 4.5, (f) => f.headPose!.yaw)).toBeLessThan(-15);
  });

  it('MAPPED: the yaw axis tracks the decoder sign under the shipped gain', () => {
    // Deliberately NOT asserting "turning right raises the scale degree": that sentence
    // is about the player's body, and the body↔image mapping is unknown until the
    // recording's mirror state is. What IS pinned is that the mapping does not silently
    // invert the decoder.
    expect(controlsMeanOver(6.3, 6.9, 'headYaw')).toBeGreaterThan(0.3);
    expect(controlsMeanOver(4.1, 4.5, 'headYaw')).toBeLessThan(-0.1);
  });
});

describe('#146 check 3 — the smile↔frown axis is one-sided in practice', () => {
  it('a wide smile (4.7–5.9 s) drives smileFrown strongly POSITIVE', () => {
    expect(controlsMeanOver(5.0, 5.8, 'smileFrown')).toBeGreaterThan(0.7);
  });

  it('a visible FROWN barely moves mouthFrown* — the negative half is near-unreachable', () => {
    // At 7.2–7.6 s the face is unmistakably frowning (see the fixture README), yet
    // `mouthFrownLeft/Right` peak around 0.05 while `browDown*` reaches 0.79. The
    // smileFrown axis is built from mouthSmile − mouthFrown, so the "darker timbre"
    // half of #146 check 3 is not reachable by frowning. This is a SIGNAL problem, not
    // a sign problem — flipping `smileGain` would not fix it (and cannot: it is
    // `.min(0)`). Recorded as a characterisation test so the day the axis is rebuilt
    // on `browDown`, this goes red and someone re-reads the reasoning.
    const frown = meanOver(7.2, 7.6, (f) =>
      ((f.blendshapes.mouthFrownLeft ?? 0) + (f.blendshapes.mouthFrownRight ?? 0)) / 2,
    );
    const browDown = meanOver(7.2, 7.6, (f) =>
      ((f.blendshapes.browDownLeft ?? 0) + (f.blendshapes.browDownRight ?? 0)) / 2,
    );
    expect(frown).toBeLessThan(0.15);
    expect(browDown).toBeGreaterThan(0.4);
    // …and the mapped axis therefore sits at rest rather than going negative.
    expect(controlsMeanOver(7.2, 7.6, 'smileFrown')).toBeGreaterThan(-0.1);
  });
});

describe('brow raise is CONFOUNDED BY CAMERA DISTANCE (#131 / #160)', () => {
  /** The transform matrix's translation-z is the distance signal; it correlates r=0.98
   *  with inter-ocular distance over this window (see the fixture README). */
  const tz = (t: number): number => frames[Math.round(t * FPS)].transformMatrix[14];

  it('the dolly window really is a 2x distance change with the expression held', () => {
    expect(Math.abs(tz(11.0) / tz(12.1))).toBeGreaterThan(1.6);
    // The smile is held throughout, so any brow movement is not an expression change.
    expect(controlsMeanOver(11.0, 12.2, 'smileFrown')).toBeGreaterThan(0.5);
  });

  it('browRaise swings by more than a third of full scale from leaning in ALONE', () => {
    // The player never raises an eyebrow here — they lean toward the camera. #146 check 4
    // is "raise both eyebrows -> a diatonic 7th is added"; with `browGain` 1 and
    // `browDeadzone` 0.1 this swing adds and removes the 7th with no eyebrow movement at
    // all. That is the concrete case for the invariance work in #160: `browRaise` needs
    // `residual()` against a scale proxy, or a scale-invariant replacement.
    const far = controlsMeanOver(10.9, 11.1, 'browRaise');
    const near = controlsMeanOver(11.9, 12.2, 'browRaise');
    expect(near - far).toBeGreaterThan(0.33);
  });
});
