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
 * The paths ({@link GESTURE_PATHS}) are the scripted gestures the matcher's goldens were measured
 * on (`test/helpers/wave_take.ts` re-exports them): each starts and ends at rest with no jump.
 */
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { handsFrameVector } from '@thoremin/sdk/features/modalities/hand';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { SYNTHETIC_HAND_FRAME, SYNTHETIC_HAND_SHAPES, syntheticHandKeypoints } from './synthetic_hand';

/**
 * A gesture's path: the hand's displacement at `tau` (0..1 through one repetition) in units of the
 * amplitude, `[sideways, down]`, starting and ending at rest. `cycles` swings per repetition.
 */
export type GesturePath = (tau: number, cycles: number) => readonly [number, number];

const hann = (tau: number) => Math.sin(Math.PI * tau) ** 2;
const swing = (tau: number, cycles: number) => hann(tau) * Math.sin(2 * Math.PI * cycles * tau);

/** Out to the side over `[0, a]`, held there until `1 - a`, back over `[1 - a, 1]`; eased (the
 *  Hann window's halves), so it starts and ends at rest with no jump. */
const outHoldBack = (tau: number, a: number) => (tau < a ? hann(tau / (2 * a)) : tau > 1 - a ? hann((1 - tau) / (2 * a)) : 1);

/** The scripted gestures: a wave is a side-to-side swing, a nod the same swing up and down, a
 *  circle a loop, a push one swing out and back, a diagonal the swing at 45 degrees, a reach a
 *  push that pauses at its far end for a fifth of the repetition (#753: a gesture passing through
 *  a held pose). */
export const GESTURE_PATHS = {
  wave: (tau, cycles) => [swing(tau, cycles), 0],
  nod: (tau, cycles) => [0, swing(tau, cycles)],
  circle: (tau, cycles) => [hann(tau) * Math.sin(2 * Math.PI * cycles * tau), hann(tau) * (1 - Math.cos(2 * Math.PI * cycles * tau))],
  push: (tau) => [hann(tau), 0],
  diagonal: (tau, cycles) => [swing(tau, cycles) / Math.SQRT2, swing(tau, cycles) / Math.SQRT2],
  reach: (tau) => [outHoldBack(tau, 0.4), 0],
} satisfies Record<string, GesturePath>;

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

const OPEN = SYNTHETIC_HAND_SHAPES.find((s) => s.name === 'open')!;

/** Whether `ms` falls inside a repetition (and how far through it), or in a rest. */
export function syntheticGesturePhase(ms: number, script: typeof SYNTHETIC_GESTURE = SYNTHETIC_GESTURE): number | null {
  if (ms < script.restMs) return null;
  const into = (ms - script.restMs) % (script.repetitionMs + script.pauseMs);
  return into < script.repetitionMs ? into / script.repetitionMs : null;
}

/** The merged vector (`hand.right.*`) of the hand making `path` at `ms` after the start, read as the
 *  live node reads it; `frame` seeds the jitter. */
export function syntheticGestureVector(path: GesturePath, ms: number, frame: number, script: typeof SYNTHETIC_GESTURE = SYNTHETIC_GESTURE): FeatureVector {
  const L = SYNTHETIC_HAND_FRAME.length;
  const tau = syntheticGesturePhase(ms, script);
  const [px, py] = tau === null ? [0, 0] : path(tau, script.cycles);
  const dx = script.drift * L * Math.sin((2 * Math.PI * ms) / script.driftPeriodMs) + script.amplitude * L * px;
  const dy = script.amplitude * L * py;
  const keypoints = syntheticHandKeypoints(OPEN, frame).map((k) => ({ ...k, x: k.x + dx, y: k.y + dy }));
  const { width, height } = SYNTHETIC_HAND_FRAME;
  const hands = { width, height, hands: [{ handedness: 'Right', keypoints, score: 1 }] } as HandsFrame;
  return handsFrameVector(hands, { mirrorX: true, mirrorHandedness: false });
}
