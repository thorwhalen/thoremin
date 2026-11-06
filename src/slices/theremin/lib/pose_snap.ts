/**
 * The pose snap: a codified technique's promise kept by the instrument. In Eyck's system the
 * theremin is tuned so the eight finger positions, the hand held in one place, play the major
 * scale (FP1 to FP8 an octave); in Rockmore's, each position is one step of the scale. A real
 * field keeps that only roughly (here a fist to an open palm is about five semitones, not twelve,
 * `docs/research/theremin-physics.md` §6). The snap pulls the INTERVAL between successive held
 * positions toward the codified one, `strength` 0 (the raw physics) to 1 (exactly the codified
 * interval).
 *
 * How. A position is "held" once the classifier has named it, surely, for `dwellS` (the SDK's
 * commit gate, the same dwell every recognised gesture uses); it is let go the same way, so a
 * frame or two of doubt or of a neighbour changes nothing. Where position 1 would sound (the
 * anchor) is read from what the held position plays. When another position is taken, the snap
 * fixes an OFFSET: the anchor plus the new position's interval, less the pitch it plays then. The
 * output is the pitch plus that offset, so whatever the hand does inside a position (a glide, a
 * vibrato) passes through unchanged; only the step between positions is corrected. The offset
 * applied fades toward `strength` times the offset with a time constant (`fadeS`), so taking or
 * losing a position, or turning the dial, glides rather than jumps.
 *
 * The anchor follows the held position's corrected pitch slowly (`followS`), so a slow slide of
 * the arm moves where position 1 is, while the quick change of shape between two positions does
 * not. A quick move of the arm (the wrist further than `moveFraction` palm lengths) is the player
 * choosing another place: the anchor is taken again at once from what the hand plays there, with
 * no jump in the output.
 *
 * Why its own stage, not the assist chain's correction: the correction pulls toward fixed notes
 * (a scale); the pose snap corrects an interval relative to wherever the hand is. It runs inside
 * the chain as its `centre` hook (after the vibrato split and the smoothing, before the
 * correction), so the chain's correction, when on, still lands the result on the scale.
 *
 * Pure: the classifier's reading and the wrist come in, the pitch goes out.
 */
import { createCommitGate } from '@thoremin/sdk/util/commit_gate';
import { nearestInScale } from './assist';
import type { Pose } from './poses';

export const POSE_SNAP_TUNING = {
  /** A position is taken, or let go, once read this long, s. */
  dwellS: 0.12,
  /** The classifier's confidence a position needs to be taken. Measured on Eyck's videos, each
   *  held out in turn (`scripts/theremin/measure_poses.ts`; per position in
   *  `docs/research/theremin-technique.md` §7): at 0.3, 64% of frames are read and 73% of those
   *  are right; at 0.5, 49% and 80%; at 0.7, 33% and 86%. */
  minConfidence: 0.5,
  /** The measured precision a position needs for the snap to act on it (`Pose.measured.precision`:
   *  of the held-out sure readings naming it, the share that were it). Eyck's FP2, FP3 and FP6 fall
   *  below it (their neighbours are read as them): they are still held and shown, but played
   *  unpulled, and they neither set nor move the anchor; the snap pulls again at the next position
   *  it can trust. A position never measured is trusted. */
  minPrecision: 0.7,
  /** The confidence that keeps a held position held (hysteresis: below `minConfidence`). */
  holdConfidence: 0.3,
  /** Wrist travel that re-anchors at once, in palm lengths. */
  moveFraction: 0.6,
  /** The anchor's time constant toward the held position's corrected pitch, s. */
  followS: 1.5,
  /** The applied offset's time constant toward its goal, s. */
  fadeS: 0.15,
};

/** The major scale's steps, for a scale-step interval when the instrument has no scale. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** The note `steps` scale steps above the scale note nearest `m` (fractional MIDI). */
export function scaleStepsAbove(m: number, steps: number, pitchClasses: readonly number[]): number {
  const pcs = pitchClasses.length ? pitchClasses : MAJOR;
  let note = nearestInScale(m, pcs);
  const dir = Math.sign(steps);
  const inScale = (k: number) => pcs.some((p) => ((((k - p) % 12) + 12) % 12) === 0);
  for (let n = 0; n < Math.abs(steps); n++) {
    do note += dir;
    while (!inScale(note));
  }
  return note;
}

/** Where a position sounds above an anchor (where the system's position 1 sounds). A scale-step
 *  interval keeps the anchor's distance from its scale note: an anchor 0.4 above C puts position 2
 *  0.4 above D, so the interval, not an absolute scale, is what is kept. */
export function positionPitch(anchor: number, pose: Pose, pitchClasses: readonly number[]): number {
  if ('semitones' in pose.interval) return anchor + pose.interval.semitones;
  const home = nearestInScale(anchor, pitchClasses.length ? pitchClasses : MAJOR);
  return scaleStepsAbove(anchor, pose.interval.scaleSteps, pitchClasses) + (anchor - home);
}

/** Where position 1 would sound, from a position's pitch (the inverse of {@link positionPitch}). */
export function anchorFrom(pitch: number, pose: Pose, pitchClasses: readonly number[]): number {
  if ('semitones' in pose.interval) return pitch - pose.interval.semitones;
  const home = nearestInScale(pitch, pitchClasses.length ? pitchClasses : MAJOR);
  return scaleStepsAbove(pitch, -pose.interval.scaleSteps, pitchClasses) + (pitch - home);
}

export interface PoseSnapStep {
  /** The pitch in, fractional MIDI (the field's, smoothed, its vibrato set aside when detected). */
  pitch: number;
  dt: number;
  /** The recognised position and how sure, or null. */
  pose: Pose | null;
  confidence: number;
  /** The pitch hand's wrist and palm length, in the same units (for the arm's movement). */
  wrist: { x: number; y: number } | null;
  palm: number;
  strength: number;
  pitchClasses: readonly number[];
}

export interface PoseSnapReading {
  pitch: number;
  /** The pitch the held position should sound (the anchor plus its interval), or null while no
   *  position is held. */
  target: number | null;
  /** The position held (taken and not let go), or null. */
  pose: Pose | null;
}

export interface PoseSnap {
  step(s: PoseSnapStep): PoseSnapReading;
  reset(): void;
}

const NONE = '';

export function createPoseSnap(t = POSE_SNAP_TUNING): PoseSnap {
  const gate = createCommitGate<string>({ dwellS: t.dwellS, slackS: 1e-9 });
  let now = 0;
  let held: Pose | null = null;
  /** The offset fixed when the held position was taken, semitones (the full correction). */
  let offset = 0;
  /** The offset applied now: fading toward `strength * offset`. */
  let applied = 0;
  let anchor: number | null = null;
  let anchorWrist: { x: number; y: number } | null = null;
  const reset = () => {
    gate.reset();
    now = 0;
    held = null;
    offset = 0;
    applied = 0;
    anchor = null;
    anchorWrist = null;
  };
  const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
  const trusted = (p: Pose) => (p.measured?.precision ?? 1) >= t.minPrecision;
  return {
    reset,
    step({ pitch, dt, pose, confidence, wrist, palm, strength, pitchClasses }) {
      now += dt;
      // Taken surely, kept while still fairly sure (hysteresis); otherwise "no position".
      const sure = pose && (confidence >= t.minConfidence || (pose.id === held?.id && confidence >= t.holdConfidence)) ? pose : null;
      const reading = sure?.id ?? NONE;
      const lasted = gate.push(reading, now);
      if (reading !== (held?.id ?? NONE) && lasted) {
        held = sure;
        // The new position's offset: the anchor plus its interval, less what it plays now. The
        // first position held only sets the anchor.
        if (held && !trusted(held)) offset = 0;
        else if (held) {
          offset = anchor === null ? 0 : positionPitch(anchor, held, pitchClasses) - pitch;
          if (anchor === null) {
            anchor = anchorFrom(pitch, held, pitchClasses);
            anchorWrist = wrist;
          }
        } else offset = 0;
      }
      // The arm moved: another place. While the hand still shows the held position, the anchor
      // is taken again from what it plays now (the output, so nothing jumps). If the shape is
      // changing too (the classifier lags it by the dwell), the pitch belongs to neither shape:
      // the anchor is dropped and the next position taken starts afresh, its offset 0.
      if (anchorWrist && wrist && palm > 0 && Math.hypot(wrist.x - anchorWrist.x, wrist.y - anchorWrist.y) > t.moveFraction * palm) {
        const still = held !== null && trusted(held) && reading === held.id;
        anchor = still ? anchorFrom(pitch + offset, held!, pitchClasses) : null;
        anchorWrist = still ? wrist : null;
      }
      // A slow slide while the position is held moves the anchor with it.
      if (held && trusted(held) && anchor !== null && reading === held.id) anchor += ease(dt, t.followS) * (anchorFrom(pitch + offset, held, pitchClasses) - anchor);
      const k = Math.min(1, Math.max(0, strength));
      applied += ease(dt, t.fadeS) * (k * offset - applied);
      return { pitch: pitch + applied, target: held && trusted(held) && anchor !== null ? positionPitch(anchor, held, pitchClasses) : null, pose: held };
    },
  };
}
