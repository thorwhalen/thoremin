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
import { createPulseFollower, createPulseSelector, PULSE_DEFAULTS, PULSE_TRUSTED_CONFIDENCE, RHYTHM_PRIOR_KINDS, UNKNOWN_PULSE, type PulseFollower, type PulseState } from '@thoremin/ictus';
import { BLM, type BodyFrame } from '@thoremin/sdk/nodes/domain';
import { captureTime } from '@thoremin/sdk/timing/tracker';

export const PULSE_CHANNELS = ['stride', 'head', 'hip', 'sway', 'yaw', 'trunk'] as const;
export type PulseChannel = (typeof PULSE_CHANNELS)[number];

/** What `channel: 'auto'` chooses among (#416, from #373's measurement on two dance
 *  clips): the stride (the bar, when the feet are in frame), the trunk's lateral sway
 *  over the feet (the bar, 0.60 median strength on Que Calor where the stride is 0.76), the
 *  shoulders' yaw and the trunk centroid's height (the channels that need no feet, weak on
 *  both clips: `test/body_pulse.test.ts`). The head and the hips never locked at the beat on either
 *  dancer, so they stay selectable but are not listened to by `auto`. */
export const AUTO_PULSE_CHANNELS = ['stride', 'sway', 'yaw', 'trunk'] as const satisfies readonly PulseChannel[];

const Params = z
  .object({
    /** What to listen to: the stride (default; the ankles' signed distance), the head's
     *  height (the nod), the hips' (the bounce), the trunk's sideways sway over the feet, the
     *  shoulders' yaw, the trunk centroid's height, or `auto`: all of
     *  {@link AUTO_PULSE_CHANNELS} at once, following the strongest (a challenger must
     *  lead for `autoSwitchAfterS` before it takes over; the `channel` output names it). */
    channel: z.enum([...PULSE_CHANNELS, 'auto']).default('stride'),
    /** `auto` only: how long a challenger channel must keep the lead, seconds (the pace
     *  controller's persistence, #339). */
    autoSwitchAfterS: z.number().min(0).max(30).default(3),
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
    /** The tempo-step detector's span, seconds (#339): a second estimate over only the
     *  recent past, so a dancer who changes tempo is followed in about 4 s instead of 10
     *  (it sees levels up to a third of this span: a 1.2 s step, not a 1.9 s bar). 0 =
     *  off, the full window alone. */
    fastWindowS: z.number().min(0).max(8).default(PULSE_DEFAULTS.fastWindowS),
    /** Landmarks below this visibility are treated as unobserved. */
    minVisibility: z.number().min(0).max(1).default(0.5),
  })
  .refine((p) => p.minPeriodS < p.maxPeriodS, { message: 'minPeriodS must be below maxPeriodS' })
  .refine((p) => p.windowS >= 2 * p.maxPeriodS, { message: 'windowS must hold at least two of the longest period' });
type Params = z.infer<typeof Params>;

/** The channel value of a frame, in torso lengths (scale-free; the yaw in degrees,
 *  WRAPPED: the node unwraps it, see {@link createYawUnwrapper}), or NaN when a landmark
 *  it needs is missing or below `minVisibility` (an off-screen ankle gets an
 *  extrapolated coordinate from the tracker, not a usable one). `sway` is the trunk's
 *  sideways offset over the ankles' midpoint (A1's mode for a dancer whose feet are in
 *  view; the trunk's camera x ALONE reached an ACF strength of 0.46 at the beat on Que
 *  Calor and nothing on Budots, under the 0.45 floor's noise margin, so it is not used). */
export function pulseChannelValue(frame: BodyFrame, channel: PulseChannel, minVisibility = 0.5): number {
  const L = frame.landmarks;
  const own: Record<PulseChannel, number[]> = {
    stride: [BLM.left_ankle, BLM.right_ankle],
    head: [BLM.nose],
    hip: [],
    sway: [BLM.left_ankle, BLM.right_ankle],
    yaw: [],
    trunk: [],
  };
  const needed = [BLM.left_shoulder, BLM.right_shoulder, BLM.left_hip, BLM.right_hip, ...own[channel]];
  if (!needed.every((i) => L[i] !== undefined && (frame.visibility[i] ?? 1) >= minVisibility)) return NaN;
  const ls = L[BLM.left_shoulder];
  const rs = L[BLM.right_shoulder];
  const lh = L[BLM.left_hip];
  const rh = L[BLM.right_hip];
  const torso = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  if (!(torso > 1e-9)) return NaN;
  if (channel === 'yaw') {
    // The shoulder line's yaw from the world landmarks (x-z plane).
    const l = frame.world?.[BLM.left_shoulder];
    const r = frame.world?.[BLM.right_shoulder];
    if (!l || !r || l.z === undefined || r.z === undefined) return NaN;
    return (Math.atan2(r.z - l.z, r.x - l.x) * 180) / Math.PI;
  }
  const raw = {
    stride: () => L[BLM.left_ankle].x - L[BLM.right_ankle].x,
    head: () => L[BLM.nose].y,
    hip: () => (lh.y + rh.y) / 2,
    sway: () => (ls.x + rs.x + lh.x + rh.x) / 4 - (L[BLM.left_ankle].x + L[BLM.right_ankle].x) / 2,
    trunk: () => (ls.y + rs.y + lh.y + rh.y) / 4,
  }[channel]();
  return Number.isFinite(raw) ? raw / torso : NaN;
}

/** Unwraps a stream of angles in degrees (atan2 jumps by 360 when a turning line passes
 *  side-on, which a dancer's shoulders do), causally; NaN is skipped and a jump is
 *  measured from the last observed sample. */
export function createYawUnwrapper(): (deg: number) => number {
  let offset = 0;
  let last = NaN;
  return (x) => {
    if (!Number.isFinite(x)) return NaN;
    if (Number.isFinite(last)) {
      const d = x + offset - last;
      if (d > 180) offset -= 360 * Math.round(d / 360);
      else if (d < -180) offset += 360 * Math.round(-d / 360);
    }
    last = x + offset;
    return last;
  };
}

export const bodyPulseNode = defineNode<Params>({
  type: 'body-pulse',
  roles: ['feature'],
  title: 'Body Pulse',
  description: "The dancer's pulse: the period, phase and confidence of the body's repeating movement (the stride by default), from ictus's octave-free pulse follower.",
  inputs: [{ name: 'body', kind: 'body-frame' }],
  outputs: [
    { name: 'pulse', kind: 'pulse-state' },
    // The channel being followed: the configured one, or under `auto` the one leading.
    { name: 'channel', kind: 'string' },
  ],
  params: Params,
  make(p) {
    const opts = { windowS: p.windowS, minPeriodS: p.minPeriodS, maxPeriodS: p.maxPeriodS, prior: p.prior, fastWindowS: p.fastWindowS };
    const channels: readonly PulseChannel[] = p.channel === 'auto' ? AUTO_PULSE_CHANNELS : [p.channel];
    // One follower and one yaw unwrapper per channel; `auto` runs them all, so a
    // challenger that takes over is already warm.
    const followers = new Map<PulseChannel, PulseFollower>(channels.map((c) => [c, createPulseFollower(opts)]));
    const unwrap = new Map<PulseChannel, (deg: number) => number>(channels.map((c) => [c, createYawUnwrapper()]));
    const selector = createPulseSelector<PulseChannel>({ switchAfterS: p.autoSwitchAfterS });
    // What to publish while `auto` has not found a trusted channel yet: the stride's
    // (still warming up), so the output is never a different follower tick to tick.
    const fallback: PulseChannel = channels[0];
    let lastFrame: BodyFrame | undefined;
    let last: PulseState = UNKNOWN_PULSE;
    let lastChannel: PulseChannel = fallback;
    const feedAll = (t: number, value: (c: PulseChannel) => number) => {
      const states = {} as Record<PulseChannel, PulseState>;
      for (const c of channels) states[c] = followers.get(c)!.feed(t, value(c));
      if (channels.length === 1) {
        lastChannel = fallback;
        return states[fallback];
      }
      const scores = {} as Record<PulseChannel, number>;
      for (const c of channels) scores[c] = states[c].confidence >= PULSE_TRUSTED_CONFIDENCE ? states[c].strength : 0;
      lastChannel = selector.update(t, scores) ?? fallback;
      return states[lastChannel];
    };
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
          last = feedAll(ctx.time, () => NaN);
          return { pulse: last, channel: lastChannel };
        }
        if (frame === lastFrame) return { pulse: last, channel: lastChannel };
        lastFrame = frame;
        last = feedAll(captureTime(frame, ctx), (c) => {
          const v = pulseChannelValue(frame, c, p.minVisibility);
          return c === 'yaw' ? unwrap.get(c)!(v) : v;
        });
        return { pulse: last, channel: lastChannel };
      },
    };
  },
});
