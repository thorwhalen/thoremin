/**
 * `face-controls` node — turns a {@link FaceFrame} into a small set of
 * *deliberate, orthogonal* face/head control axes (issue #76): head yaw / pitch
 * / roll (from the decoded {@link HeadPose}), jaw-open, smile↔frown, brow-raise,
 * and a lip-pucker pose. It is the sibling of `face-features` and
 * `face-expression`, and the *control* surface the `controls` face mode plays
 * from — chosen because each axis is (a) easy for a player to produce on purpose
 * and (b) reliably detected, unlike the emotion classifier's low-controllability
 * faces read through low-SNR channels.
 *
 * Pure + Node-safe (no DOM/MediaPipe): the live `webcam-face` node and the
 * offline fixture both feed it `{ present, blendshapes, headPose? }` frames, so
 * it replays headlessly. Head axes read from `frame.headPose` (present only when
 * the live source enables the facial transformation matrix); when it is absent
 * (e.g. the blendshape-only fixture) the head axes rest at 0 while the
 * blendshape-driven axes still work.
 *
 * Each axis is normalized with a per-axis gain (which may be NEGATIVE to flip
 * the felt direction — the honest fix for a camera sign convention we cannot
 * assert headlessly), a deadzone (so a resting face/head reads 0 despite the
 * blendshapes' rest jitter and pose noise), and shared EMA smoothing so the
 * control eases rather than jumps. Head axes additionally take a per-session
 * neutral *zero* (degrees) — the seam a future "look at the camera" calibration
 * fills — and a full-scale *range* (the degrees of rotation that reach ±1).
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { clamp01 } from '@/features/math';
import { ABSENT_FACE_CONTROLS, type FaceControls, type FaceFrame } from '../domain';

const Params = z.object({
  /** Shared EMA smoothing 0..1 per tick (0 = instant, higher = smoother/slower). */
  smoothing: z.number().min(0).max(0.999).default(0.3),

  // --- Head pose (degrees) → bipolar [-1,1] axes ---
  /** Degrees of rotation (from the neutral zero) that reach full-scale ±1. */
  headRangeDeg: z.number().min(1).default(30),
  /** Degrees of deadzone around the neutral zero (pose noise + drift rejection). */
  headDeadzoneDeg: z.number().min(0).default(3),
  /** Neutral "facing the camera" zero per axis (degrees) — a calibration seam. */
  yawZeroDeg: z.number().default(0),
  pitchZeroDeg: z.number().default(0),
  rollZeroDeg: z.number().default(0),
  /** Per-axis gain (negative flips direction), applied after the deadzone. */
  yawGain: z.number().default(1),
  pitchGain: z.number().default(1),
  rollGain: z.number().default(1),

  // --- Blendshape → unipolar [0,1] / bipolar [-1,1] axes ---
  /** Rest deadzone for the jaw/brow/pucker channels (they read slightly active at rest). */
  mouthDeadzone: z.number().min(0).max(0.9).default(0.08),
  browDeadzone: z.number().min(0).max(0.9).default(0.1),
  puckerDeadzone: z.number().min(0).max(0.9).default(0.12),
  /** Deadzone for the bipolar smile↔frown axis. */
  smileDeadzone: z.number().min(0).max(0.9).default(0.06),
  /** Per-axis gain for the blendshape channels. */
  mouthGain: z.number().min(0).default(1),
  browGain: z.number().min(0).default(1),
  puckerGain: z.number().min(0).default(1),
  smileGain: z.number().min(0).default(1),
});
type Params = z.infer<typeof Params>;

const clampSigned = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Unipolar deadzone+rescale on a raw [0,1] channel: below `dz` → 0, then
 *  `[dz, 1]` is stretched to `[0, 1]` before the gain, so the axis starts clean
 *  at the deadzone edge and still reaches full scale. */
function unipolar(raw: number, dz: number, gain: number): number {
  const d = raw <= dz ? 0 : (raw - dz) / (1 - dz);
  return clamp01(d * gain);
}

/** Bipolar deadzone+rescale on a value already in ~[-1,1]: within `±dz` → 0,
 *  then each side is stretched so the axis starts clean at the deadzone edge. */
function bipolar(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * clampSigned((a - dz) / (1 - dz));
}

/** A degrees reading → a bipolar [-1,1] axis: recenter on `zeroDeg`, scale by the
 *  full-scale `rangeDeg`, deadzone, then apply the (possibly negative) gain. The
 *  deadzone ratio is capped below 1 so a (mis)configured deadzone ≥ range can never
 *  invert the axis via `bipolar`'s `1 - dz` divisor. */
function headAxis(deg: number, zeroDeg: number, rangeDeg: number, deadzoneDeg: number, gain: number): number {
  const norm = (deg - zeroDeg) / rangeDeg;
  const dz = Math.min(deadzoneDeg / rangeDeg, 0.9);
  return clampSigned(bipolar(norm, dz) * gain);
}

/** The smoothed, mutable per-axis state (everything but `present`). */
type AxisState = Omit<FaceControls, 'present'>;

const zeroAxes = (): AxisState => ({
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  mouthOpen: 0,
  smileFrown: 0,
  browRaise: 0,
  lipPucker: 0,
});

export const faceControlsNode = defineNode<Params>({
  type: 'face-controls',
  roles: ['feature'],
  title: 'Face Controls',
  description:
    'Face frame → deliberate control axes (head yaw/pitch/roll, jaw-open, smile↔frown, brow-raise, lip-pucker), each with gain/deadzone/smoothing.',
  inputs: [{ name: 'face', kind: 'face-frame' }],
  outputs: [{ name: 'controls', kind: 'face-controls' }],
  params: Params,
  make(p) {
    const prev = zeroAxes();
    const keys = Object.keys(prev) as (keyof AxisState)[];

    /** EMA `prev` toward `target` (target 0 = decay toward rest). */
    const ease = (target: AxisState) => {
      for (const k of keys) prev[k] = prev[k] + (1 - p.smoothing) * (target[k] - prev[k]);
    };

    return {
      process(inputs) {
        const face = inputs.face as FaceFrame | undefined;
        if (!face || !face.present) {
          // Decay toward rest so a lost face relaxes the axes rather than freezing them.
          ease(zeroAxes());
          return { controls: { ...ABSENT_FACE_CONTROLS } };
        }

        const bs = (name: string): number => face.blendshapes[name] ?? 0;
        const avg = (...xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

        // Head axes read the decoded pose when the live source provides it; the
        // blendshape-only fixture has none, so they rest at 0 (present stays true).
        const pose = face.headPose;
        const target: AxisState = {
          headYaw: pose ? headAxis(pose.yaw, p.yawZeroDeg, p.headRangeDeg, p.headDeadzoneDeg, p.yawGain) : 0,
          headPitch: pose ? headAxis(pose.pitch, p.pitchZeroDeg, p.headRangeDeg, p.headDeadzoneDeg, p.pitchGain) : 0,
          headRoll: pose ? headAxis(pose.roll, p.rollZeroDeg, p.headRangeDeg, p.headDeadzoneDeg, p.rollGain) : 0,
          mouthOpen: unipolar(bs('jawOpen'), p.mouthDeadzone, p.mouthGain),
          smileFrown: clampSigned(
            bipolar(
              avg(bs('mouthSmileLeft'), bs('mouthSmileRight')) - avg(bs('mouthFrownLeft'), bs('mouthFrownRight')),
              p.smileDeadzone,
            ) * p.smileGain,
          ),
          browRaise: unipolar(
            avg(bs('browInnerUp'), bs('browOuterUpLeft'), bs('browOuterUpRight')),
            p.browDeadzone,
            p.browGain,
          ),
          lipPucker: unipolar(avg(bs('mouthPucker'), bs('mouthFunnel')), p.puckerDeadzone, p.puckerGain),
        };

        ease(target);
        return { controls: { present: true, ...prev } as FaceControls };
      },
    };
  },
});
