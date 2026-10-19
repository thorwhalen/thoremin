/**
 * `synthetic-hands` node — a deterministic, camera-free source of
 * {@link HandsFrame}s. The right hand's index finger sweeps left→right while
 * openness and pinch oscillate. Used for demos, headless end-to-end DAG runs,
 * and as a generator of test fixtures (record its downstream once, replay
 * forever).
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { makeHandKeypoints, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { SOURCE_SLOT_OUTPUT } from './source_contract';

const Params = z.object({
  width: z.number().default(640),
  height: z.number().default(480),
  /** Seconds for the index finger to sweep the full width once. */
  sweepPeriod: z.number().default(4),
  /** Seconds for one openness oscillation. */
  opennessPeriod: z.number().default(3),
  /** Seconds for one pinch oscillation. */
  pinchPeriod: z.number().default(2.5),
  /** Which hand(s) to emit. */
  hands: z.enum(['right', 'left', 'both']).default('right'),
  /** Vertical position of the hand, normalized 0 (top) .. 1 (bottom). */
  yNorm: z.number().default(0.5),
  /** Hand size in pixels. */
  scale: z.number().default(80),
  /**
   * Drum strokes instead of the sweep: the hand stays put and its stick (the heel-to-fulcrum
   * line the air drum tracks) swings down once per `strikePeriod` seconds, a quick fall and a
   * slow rise, so the air drum has something to hit. The swing is a ROTATION about the wrist: the
   * air drum reads a hand that merely moves as the arm carrying the stick, not as a stroke.
   * Off by default; `?synthetic.strike=1` turns it on for a browser smoke (no camera).
   */
  strike: z.boolean().default(() => strikeFromUrl()),
  /** Seconds between strokes. */
  strikePeriod: z.number().default(0.9),
});
type Params = z.infer<typeof Params>;

/** `?synthetic.strike=1` (a browser only): the smoke's switch for the strike mode. */
function strikeFromUrl(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('synthetic.strike') === '1';
}

/** The stroke's height as a fraction of its travel: 0 raised, 1 at the surface. A fall in the
 *  first sixth of the period (fast, the way a stick comes down), a slow rise after. */
function strikeShape(u: number): number {
  const FALL = 1 / 6;
  return u < FALL ? Math.sin((u / FALL) * (Math.PI / 2)) : 0.5 + 0.5 * Math.cos(((u - FALL) / (1 - FALL)) * Math.PI);
}

/** The stick's turn from upright at the top of a stroke and at contact, radians: about 0.7 rad
 *  of swing ending with the stick lying to the left of the hand, a little below it. */
const STRIKE_RAISED = 0.97;
const STRIKE_SWING = 0.7;

/** `keypoints` turned by `theta` about `(cx, cy)`, an upright stick going over to the left. */
function turn(keypoints: { x: number; y: number }[], cx: number, cy: number, theta: number): { x: number; y: number }[] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return keypoints.map((k) => ({ ...k, x: cx + c * (k.x - cx) + s * (k.y - cy), y: cy - s * (k.x - cx) + c * (k.y - cy) }));
}

function osc(time: number, period: number, phase = 0): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * time) / period + phase);
}

export const syntheticHandsNode = defineNode<Params>({
  type: 'synthetic-hands',
  roles: ['source'],
  title: 'Synthetic Hands',
  description: 'Camera-free animated hand landmark source for tests & demos.',
  inputs: [],
  outputs: [SOURCE_SLOT_OUTPUT],
  params: Params,
  process(_inputs, p, ctx) {
    const margin = p.scale;
    const phase = (ctx.time / p.sweepPeriod) % 1;
    const cx = p.strike ? p.width / 2 : margin + phase * (p.width - 2 * margin);
    const cy = p.yNorm * p.height;
    const theta = STRIKE_RAISED + STRIKE_SWING * strikeShape((ctx.time / p.strikePeriod) % 1);
    // A striking hand holds its shape: an opening or pinching hand would tilt the stick.
    const spread = p.strike ? 0.5 : osc(ctx.time, p.opennessPeriod);
    const pinch = p.strike ? 0 : osc(ctx.time, p.pinchPeriod, Math.PI / 2);

    const strike = (kp: { x: number; y: number }[], x = cx) => (p.strike ? turn(kp, x, cy, theta) : kp);
    const hands: Hand[] = [];
    if (p.hands === 'right' || p.hands === 'both') {
      hands.push({
        handedness: 'Right',
        keypoints: strike(makeHandKeypoints({ cx, cy, scale: p.scale, spread, pinch, handedness: 'Right' })),
        score: 1,
      });
    }
    if (p.hands === 'left' || p.hands === 'both') {
      // Left hand sweeps in the opposite phase for visual contrast.
      const lcx = p.width - cx;
      hands.push({
        handedness: 'Left',
        keypoints: strike(makeHandKeypoints({ cx: lcx, cy, scale: p.scale, spread: 1 - spread, pinch, handedness: 'Left' }), lcx),
        score: 1,
      });
    }
    const frame: HandsFrame = { width: p.width, height: p.height, hands };
    return { hands: frame };
  },
});
