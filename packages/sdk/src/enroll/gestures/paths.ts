/**
 * Scripted gesture paths (#752, moved here from the faces extension in #754): the pure shapes a
 * scripted hand traces, so the matcher's goldens (`test/helpers/wave_take.ts`) and the extension's
 * scripted source (`@thoremin/ext-faces/lib/synthetic_gesture`) share one definition without the
 * SDK's own tests importing an extension.
 *
 * Each path starts and ends at rest with no jump: what a segmenter can cut cleanly.
 */

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

/** The share of a `reach` repetition spent getting out (and, symmetrically, back). */
const REACH_TRAVEL = 0.4;

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
  reach: (tau) => [outHoldBack(tau, REACH_TRAVEL), 0],
} satisfies Record<string, GesturePath>;

/** A scripted gesture's name. */
export type GesturePathName = keyof typeof GESTURE_PATHS;
