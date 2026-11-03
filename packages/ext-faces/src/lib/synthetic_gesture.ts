/**
 * A scripted moving gesture of the articulated synthetic hand (#754): what `?carve.source=synthetic`
 * plays while "Your hand shapes" records a GESTURE, so the Gestures section runs end to end with
 * no camera and no hand model, as the scripted shapes do for the held categories.
 *
 * The open hand (`synthetic_hand.ts`) is held up for `restMs` (the rest the routine asks for
 * first), then makes the gesture over and over: one repetition of `repetitionMs`, a pause of
 * `pauseMs`, and again, so a take asking for any number of repetitions gets them. On top, a slow
 * sideways drift keeps the resting hand from being unnaturally still (a real hand wanders, and so
 * does the tracker).
 *
 * The paths are the SDK's (`@thoremin/sdk/enroll/gestures/paths`, re-exported here): the scripted
 * gestures the matcher's goldens were measured on, each starting and ending at rest with no jump.
 *
 * The scripted BODY makes the same gestures (#954, "Your poses"): the standing body at rest
 * (`./synthetic_body.ts`), its right wrist and hand carried along the path (in torso lengths), on
 * the same timeline, so a body gesture take runs end to end with no camera and no pose model.
 */
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { GesturePath } from '@thoremin/sdk/enroll/gestures/paths';
import { handsFrameVector } from '@thoremin/sdk/features/modalities/hand';
import { SYNTHETIC_HAND_FRAME, SYNTHETIC_HAND_SHAPES, syntheticHandKeypoints } from './synthetic_hand';
import { BLM, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { bodyFrameVector } from '@thoremin/sdk/features/modalities/body';
import { SYNTHETIC_BODY_FRAME, syntheticBodyFrame } from './synthetic_body';

export { GESTURE_PATHS, type GesturePath } from '@thoremin/sdk/enroll/gestures/paths';

/** The script's timing and size (the matcher's goldens' wave: `test/helpers/wave_take.ts`). */
export const SYNTHETIC_GESTURE = {
  /** The opening rest: past the routine's rest cue (90 frames, 3 s at 30 fps), the runner's
   *  check of it and its beat before the prompt (1.5 s), so the first repetition is prompted. */
  restMs: 6000,
  /** One repetition. */
  repetitionMs: 1000,
  /** Rest between two repetitions: past the segmenter's closing quiet. */
  pauseMs: 1000,
  cycles: 2,
  /** Half-width of the gesture, in hand lengths. */
  amplitude: 0.25,
  /** The resting drift's half-width in hand lengths, and its period. */
  drift: 0.02,
  driftPeriodMs: 3000,
} as const;

/** A script's timing and size, any values (the constants above are one such). */
export type GestureScript = Readonly<Record<keyof typeof SYNTHETIC_GESTURE, number>>;

const OPEN = SYNTHETIC_HAND_SHAPES.find((s) => s.name === 'open')!;

/** Whether `ms` falls inside a repetition (and how far through it), or in a rest. */
export function syntheticGesturePhase(ms: number, script: GestureScript = SYNTHETIC_GESTURE): number | null {
  if (ms < script.restMs) return null;
  const into = (ms - script.restMs) % (script.repetitionMs + script.pauseMs);
  return into < script.repetitionMs ? into / script.repetitionMs : null;
}

/** The moving part's displacement at `ms`, in units of its own length (a hand length, a torso):
 *  the resting drift sideways plus the gesture's path. */
export function syntheticGestureOffset(path: GesturePath, ms: number, script: GestureScript = SYNTHETIC_GESTURE): [number, number] {
  const tau = syntheticGesturePhase(ms, script);
  const [px, py] = tau === null ? [0, 0] : path(tau, script.cycles);
  return [script.drift * Math.sin((2 * Math.PI * ms) / script.driftPeriodMs) + script.amplitude * px, script.amplitude * py];
}

/** The merged vector (`hand.right.*`) of the hand making `path` at `ms` after the start, read as the
 *  live node reads it; `frame` seeds the jitter. */
export function syntheticGestureVector(path: GesturePath, ms: number, frame: number, script: GestureScript = SYNTHETIC_GESTURE): FeatureVector {
  const L = SYNTHETIC_HAND_FRAME.length;
  const [ox, oy] = syntheticGestureOffset(path, ms, script);
  const dx = ox * L;
  const dy = oy * L;
  const keypoints = syntheticHandKeypoints(OPEN, frame).map((k) => ({ ...k, x: k.x + dx, y: k.y + dy }));
  const { width, height } = SYNTHETIC_HAND_FRAME;
  const hands = { width, height, hands: [{ handedness: 'Right', keypoints, score: 1 }] } as HandsFrame;
  return handsFrameVector(hands, { mirrorX: true, mirrorHandedness: false });
}

/** The scripted body's gesture: its timeline is {@link SYNTHETIC_GESTURE}'s, its size its own. */
export const SYNTHETIC_BODY_GESTURE = {
  ...SYNTHETIC_GESTURE,
  /** Half-width of the gesture, in torso lengths: an arm's wave. */
  amplitude: 0.5,
} as const;

/** The landmarks a body gesture carries: the right wrist and the hand's points on it. */
const BODY_GESTURE_LANDMARKS: readonly number[] = [BLM.right_wrist, BLM.right_pinky, BLM.right_index, BLM.right_thumb];

/** The merged vector (`body.*`) of the standing body whose right hand makes `path` at `ms` after the
 *  start, read as the live body node reads it; `frame` seeds the jitter. Only the image landmarks
 *  move (the world set, which a pose's directions read, stays at rest): a gesture is a path in the
 *  frame. */
export function syntheticBodyGestureVector(path: GesturePath, ms: number, frame: number, script: GestureScript = SYNTHETIC_BODY_GESTURE): FeatureVector {
  const [ox, oy] = syntheticGestureOffset(path, ms, script);
  const torso = SYNTHETIC_BODY_FRAME.torso;
  const body = syntheticBodyFrame(0, frame);
  const moved = new Set(BODY_GESTURE_LANDMARKS);
  const landmarks = body.landmarks.map((q, i) => (moved.has(i) ? { ...q, x: q.x + ox * torso, y: q.y + oy * torso } : q));
  return bodyFrameVector({ ...body, landmarks });
}
