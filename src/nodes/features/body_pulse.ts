/**
 * `body-pulse` node (#186 PR F) — the dancer's pulse from the raw body frame:
 * period, phase and confidence of the body's repeating vertical motion, on a
 * `pulse` port. This is the body's **anchor detector + rhythm inference** of the
 * #178 architecture, and the signal the pace controller (PR H) follows.
 *
 * The observed channel is the head's height in torso lengths (the nod / bob) by
 * default, or the hip midpoint's (the bounce) — a POSITION, not a speed, because
 * positions autocorrelate far better than their derivatives (the body research
 * map §4.2, measured by the paces project on real pose data). The head is the
 * default because on the real dancer fixture it stays on a harmonic of the beat
 * 91 % of the time the engine is confident, where the hips manage 48 %: a
 * choreography moves the hips with the steps, the head with the pulse.
 *
 * The engine behind it is the {@link PulseEngine} seam. Today it is the interim
 * causal-ACF + phase-lock engine in `pulse_engine.ts`; the conductor epic's `ictus`
 * core (`src/ictus`, #187 PR 1) is on main and is the intended filler — an adapter
 * that seeds its adaptive oscillator from the ACF period and feeds it this node's
 * anchors — with nothing downstream changing. A host can inject either through
 * `ctx.resources.createPulseEngine`.
 *
 * An absent body resets the engine (a dancer who steps out and back does not
 * carry a stale tempo), and a frame that is the same object as last tick (the
 * engine ticking faster than inference) is not a new sample.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { BLM, type BodyFrame } from '../domain';
import { createInterimPulseEngine, UNKNOWN_PULSE, type PulseEngine, type PulseState } from './pulse_engine';

export const PULSE_CHANNELS = ['hip', 'head'] as const;
export type PulseChannel = (typeof PULSE_CHANNELS)[number];

const Params = z.object({
  /** Which body height to listen to: the head (default; the nod) or the hips (the bounce). */
  channel: z.enum(PULSE_CHANNELS).default('head'),
  /** Seconds of history the period estimate sees. */
  windowS: z.number().min(2).max(10).default(5),
  /** Period search range, seconds (0.25 s = 240 bpm .. 2.5 s = 24 bpm). */
  minPeriodS: z.number().positive().default(0.25),
  maxPeriodS: z.number().positive().default(2.5),
  /** ACF strength below which no pulse is reported. */
  minStrength: z.number().min(0).max(1).default(0.15),
});
type Params = z.infer<typeof Params>;

/** The engine factory seam: a host may inject `ctx.resources.createPulseEngine`. */
export type PulseEngineFactory = (opts: { windowS: number; minPeriodS: number; maxPeriodS: number; minStrength: number }) => PulseEngine;

/** The channel value for a frame: the chosen landmark's height in torso lengths, or NaN. */
export function pulseChannelValue(frame: BodyFrame, channel: PulseChannel): number {
  const L = frame.landmarks;
  const ls = L[BLM.left_shoulder];
  const rs = L[BLM.right_shoulder];
  const lh = L[BLM.left_hip];
  const rh = L[BLM.right_hip];
  if (!ls || !rs || !lh || !rh) return NaN;
  const torso = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  if (!(torso > 1e-9)) return NaN;
  const y = channel === 'hip' ? (lh.y + rh.y) / 2 : L[BLM.nose]?.y;
  return Number.isFinite(y) ? (y as number) / torso : NaN;
}

export const bodyPulseNode = defineNode<Params>({
  type: 'body-pulse',
  roles: ['feature'],
  title: 'Body Pulse',
  description: 'Period, phase and confidence of the body\'s repeating vertical motion (the dance pulse), behind the ictus engine seam.',
  inputs: [{ name: 'body', kind: 'body-frame' }],
  outputs: [{ name: 'pulse', kind: 'pulse-state' }],
  params: Params,
  make(p) {
    let engine: PulseEngine | null = null;
    let lastFrame: BodyFrame | undefined;
    let last: PulseState = UNKNOWN_PULSE;
    const options = { windowS: p.windowS, minPeriodS: p.minPeriodS, maxPeriodS: p.maxPeriodS, minStrength: p.minStrength };
    return {
      init(ctx) {
        const factory = ctx.resources.createPulseEngine as PulseEngineFactory | undefined;
        engine = factory ? factory(options) : createInterimPulseEngine(options);
      },
      process(inputs, ctx) {
        if (!engine) engine = createInterimPulseEngine(options); // headless without init()
        const frame = inputs.body as BodyFrame | undefined;
        if (!frame || !frame.present || frame.landmarks.length < 33) {
          if (lastFrame !== undefined) engine.reset();
          lastFrame = undefined;
          last = UNKNOWN_PULSE;
          return { pulse: last };
        }
        if (frame === lastFrame) return { pulse: last };
        lastFrame = frame;
        const v = pulseChannelValue(frame, p.channel);
        engine.push(ctx.time, v);
        last = engine.state();
        return { pulse: last };
      },
    };
  },
});
