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

const SYNTHETIC_HANDS = ['right', 'left', 'both'] as const;

const Params = z.object({
  width: z.number().default(640),
  height: z.number().default(480),
  /** Seconds for the index finger to sweep the full width once. */
  sweepPeriod: z.number().default(4),
  /** Seconds for one openness oscillation. */
  opennessPeriod: z.number().default(3),
  /** Seconds for one pinch oscillation. */
  pinchPeriod: z.number().default(2.5),
  /** Which hand(s) to emit. `?synthetic.hands=both` (or `left`) chooses in a browser run, for an
   *  instrument that needs the player's other hand (the physical theremin's pitch rod). */
  hands: z.enum(SYNTHETIC_HANDS).default(() => handsFromUrl()),
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
  /**
   * Beating time instead of the sweep: one hand (the right) stays put mid-frame and drops once per
   * `conductPeriod` seconds, a quick fall to the beat and a slower rebound, the way a conductor's
   * hand marks the ictus, so the conductor has strokes to follow with no camera. Off by default;
   * `?synthetic.conduct=1` turns it on for a browser run (the guide's pictures).
   */
  conduct: z.boolean().default(() => flagFromUrl('synthetic.conduct')),
  /** Seconds between beats (0.75 s: 80 beats a minute). */
  conductPeriod: z.number().default(0.75),
  /** How far a beat drops, as a share of the frame's height. */
  conductDrop: z.number().default(0.12),
});
type Params = z.infer<typeof Params>;

/** `?<name>=1` (a browser only): the switch a smoke or the guide's pictures turn a mode on with. */
function flagFromUrl(name: string): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get(name) === '1';
}

/** `?synthetic.hands=<right|left|both>` (a browser only); `right` otherwise, as always. */
function handsFromUrl(): (typeof SYNTHETIC_HANDS)[number] {
  const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('synthetic.hands') : null;
  return (SYNTHETIC_HANDS as readonly string[]).includes(v ?? '') ? (v as (typeof SYNTHETIC_HANDS)[number]) : 'right';
}

/** `?synthetic.strike=1`: the smoke's switch for the strike mode. */
const strikeFromUrl = (): boolean => flagFromUrl('synthetic.strike');

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

/** The conducting mode's frame at `time`: one hand mid-frame, held open, dropping by the beat's shape
 *  (the strike's quick fall and slow rise). One hand, not two: two identical hands leave which one
 *  the app tracks to chance, frame by frame, and a conductor that switches hands sees no stroke. */
function conductFrame(p: Params, time: number): HandsFrame {
  const drop = strikeShape((time / p.conductPeriod) % 1) * p.conductDrop * p.height;
  const cy = p.yNorm * p.height - (p.conductDrop * p.height) / 2 + drop;
  const hand: Hand = { handedness: 'Right', keypoints: makeHandKeypoints({ cx: p.width / 2, cy, scale: p.scale, spread: 0.6, pinch: 0, handedness: 'Right' }), score: 1 };
  return { width: p.width, height: p.height, hands: [hand] };
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
    if (p.conduct) return { hands: conductFrame(p, ctx.time) };
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
