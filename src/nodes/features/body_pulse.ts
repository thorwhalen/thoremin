/**
 * `body-pulse` node (#186 PR F): the dancer's pulse, the period, phase and confidence
 * of the body's repeating movement, on a `pulse` port. The pace controller (PR H)
 * follows it; the body vector folds it in as `body.rhythm.*` so the Lab shows it.
 *
 * The inference is ictus's pulse follower (`@thoremin/ictus`, `pulse.ts`): a causal
 * autocorrelation picks the LEVEL the movement repeats at, a least-squares sinusoid at
 * that level gives the phase, and the fitted cycles become anchors for an ictus
 * rhythm prior. This node only chooses what to listen to and feeds it.
 *
 * What it listens to is one body CHANNEL, a position in torso lengths (positions
 * autocorrelate far better than speeds: the body research map §4.2). The default is
 * the **stride**: the signed horizontal distance between the ankles, which swings once
 * per step cycle. Measured on the real dancer (`video_body_que_calor`, 129.2 bpm;
 * `test/body_pulse.test.ts`): the stride repeats once per BAR (1.86 s), with an
 * autocorrelation strength of 0.76 (median), while the head and the hips show only a
 * weak periodicity (around six beats, at the noise floor) and the follower mostly
 * declines to report one. The head (the nod) and the hips (the bounce) stay selectable
 * for a dancer who marks the pulse in place rather than with the feet. No octave is assumed: the period is whatever level the channel
 * repeats at, and the song's grid is related to it downstream.
 *
 * An absent body, or a landmark below `minVisibility`, is fed as NaN (not observed):
 * the follower keeps its lock across a missed detection and starts over by itself after
 * half a window without one, so a dancer who steps out and back does not carry a stale
 * tempo. A frame that is the same object as last tick (the engine ticking faster than
 * inference) is not a new sample. Time is the frame's capture stamp where it shares the engine's base
 * (`frameTime`), else the tick.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { createPulseFollower, RHYTHM_PRIOR_KINDS, UNKNOWN_PULSE, type PulseFollower, type PulseState } from '@thoremin/ictus';
import { BLM, type BodyFrame } from '@thoremin/sdk/nodes/domain';
import { captureTime } from '@thoremin/sdk/timing/tracker';

export const PULSE_CHANNELS = ['stride', 'head', 'hip'] as const;
export type PulseChannel = (typeof PULSE_CHANNELS)[number];

const Params = z
  .object({
    /** What to listen to: the stride (default; the ankles' signed distance), the head's
     *  height (the nod) or the hips' (the bounce). */
    channel: z.enum(PULSE_CHANNELS).default('stride'),
    /** Seconds of history the follower sees. Three cycles of the slowest level is the
     *  least for a precise period. */
    windowS: z.number().min(3).max(16).default(8),
    /** The period search range, seconds (0.3 s .. 3 s: from a fast step to a slow bar). */
    minPeriodS: z.number().positive().default(0.3),
    maxPeriodS: z.number().positive().max(6).default(3),
    /** Which ictus rhythm prior turns the fitted cycles into musical time. The
     *  oscillator, not the package's blend: these anchors are fitted cycle maxima, not
     *  noisy strokes, and on the Que Calor stride the oscillator's period stays on the
     *  bar in 98 % of confident ticks against the blend's 69 % (its trend half chases
     *  the fit's slow drift). */
    prior: z.enum(RHYTHM_PRIOR_KINDS).default('oscillator'),
    /** Landmarks below this visibility are treated as unobserved. */
    minVisibility: z.number().min(0).max(1).default(0.5),
  })
  .refine((p) => p.minPeriodS < p.maxPeriodS, { message: 'minPeriodS must be below maxPeriodS' })
  .refine((p) => p.windowS >= 2 * p.maxPeriodS, { message: 'windowS must hold at least two of the longest period' });
type Params = z.infer<typeof Params>;

/** The channel value of a frame, in torso lengths (scale-free), or NaN when a landmark
 *  it needs is missing or below `minVisibility` (an off-screen ankle gets an
 *  extrapolated coordinate from the tracker, not a usable one). */
export function pulseChannelValue(frame: BodyFrame, channel: PulseChannel, minVisibility = 0.5): number {
  const L = frame.landmarks;
  const own: Record<PulseChannel, number[]> = {
    stride: [BLM.left_ankle, BLM.right_ankle],
    head: [BLM.nose],
    hip: [],
  };
  const needed = [BLM.left_shoulder, BLM.right_shoulder, BLM.left_hip, BLM.right_hip, ...own[channel]];
  if (!needed.every((i) => L[i] !== undefined && (frame.visibility[i] ?? 1) >= minVisibility)) return NaN;
  const ls = L[BLM.left_shoulder];
  const rs = L[BLM.right_shoulder];
  const lh = L[BLM.left_hip];
  const rh = L[BLM.right_hip];
  const torso = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  if (!(torso > 1e-9)) return NaN;
  const raw = channel === 'stride' ? L[BLM.left_ankle].x - L[BLM.right_ankle].x : channel === 'head' ? L[BLM.nose].y : (lh.y + rh.y) / 2;
  return Number.isFinite(raw) ? raw / torso : NaN;
}

export const bodyPulseNode = defineNode<Params>({
  type: 'body-pulse',
  roles: ['feature'],
  title: 'Body Pulse',
  description: "The dancer's pulse: the period, phase and confidence of the body's repeating movement (the stride by default), from ictus's octave-free pulse follower.",
  inputs: [{ name: 'body', kind: 'body-frame' }],
  outputs: [{ name: 'pulse', kind: 'pulse-state' }],
  params: Params,
  make(p) {
    const follower: PulseFollower = createPulseFollower({ windowS: p.windowS, minPeriodS: p.minPeriodS, maxPeriodS: p.maxPeriodS, prior: p.prior });
    let lastFrame: BodyFrame | undefined;
    let last: PulseState = UNKNOWN_PULSE;
    return {
      process(inputs, ctx) {
        const frame = inputs.body as BodyFrame | undefined;
        // An absent body is "not observed" (NaN), not a reset: the model misses a pose
        // for a frame now and then, and the follower starts over by itself only after
        // a gap of half its window. It is fed every tick, at the tick's time, even when
        // it is the same object (the source's shared empty frame while no model is
        // held), or that gap would never be seen and a stale pulse would stay trusted.
        const seen = frame !== undefined && frame.present && frame.landmarks.length >= 33;
        if (!seen) {
          lastFrame = undefined;
          last = follower.feed(ctx.time, NaN);
          return { pulse: last };
        }
        if (frame === lastFrame) return { pulse: last };
        lastFrame = frame;
        last = follower.feed(captureTime(frame, ctx), pulseChannelValue(frame, p.channel, p.minVisibility));
        return { pulse: last };
      },
    };
  },
});
