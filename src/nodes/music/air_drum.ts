/**
 * `air-drum` node (#233) — strike the air, hear a drum AT the strike.
 *
 * The consumer of the sub-frame impact predictor (`src/ictus/impact.ts`,
 * `docs/research/subframe-impact-prediction.md`): the first instrument that sounds
 * an onset *before* the frame that shows it. Each of the player's hands is a stick:
 * the tracked point (by default a stick tip estimated from the grip, #246) is fed to its own predictor
 * as a normalised (frame-height) trajectory, and each stroke yields one hit —
 * committed while the hand is still tens of milliseconds above the (learned) floor,
 * with how hard it was read off the stroke's speed. A stroke too
 * fast or too early to predict is sounded on confirmation, one frame late, as a
 * ghost note. There is no surface to calibrate: the floor is the player's own
 * turning depth, learned from the first stroke on.
 *
 * Pads (#245). The player can put shapes on the screen, each a drum (`drum_pads.ts`):
 * a hit's landing point (fitted from the stroke's fall to the predicted impact) picks
 * the pad under it, where in the pad it landed (centre to rim) travels with the hit so
 * the sound can change with it, and how hard (half the stroke's size against the
 * player's recent strokes, half its speed over the slowest stroke this point counts)
 * sets the velocity, which the drum voice reads for loudness
 * and brightness. With no pad on, each hand plays its own drum, as before.
 *
 * What comes out is a list of {@link DrumHit}s on the `hits` port — each with the
 * time it should SOUND, in engine seconds, possibly in the future — which the
 * `drum-out` node schedules on the audio clock (the two-clock discipline: this node
 * never touches audio). The `time` input is the conductor's `MusicalTime`; with a
 * running follower and a non-zero `magnetism` a predicted hit is pulled toward the
 * nearest expected beat (`src/ictus/magnet.ts`): the actuality ↔ intent dial of the
 * research map, in the player's hands.
 *
 * The dial. {@link AirDrumDialSchema} IS this node's params (the conductor pattern):
 * the `airDrum` dial re-exports it, the `config` input overrides the build-time
 * params live per tick, so the panel, the palette, a keybinding and the assistant can
 * start drumming or change a sound with no graph rebuild. Only a NEW camera frame is
 * an observation (#225), sampled at its capture stamp in real time (#226).
 *
 * Pure and Node-safe: no DOM, no clock (`ctx.time`), so the synthetic impact fixtures
 * (`test/fixtures/subframe_*`) drive it headlessly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { createImpactPredictor, fitLine, fitQuadratic, magnetise, type ImpactPredictor, type MusicalTime } from '@/ictus';
import { frameTime, type Hand, type HandsFrame } from '../domain';
import { DEFAULT_STICK_LENGTH, DRUM_ANCHOR_POINTS, STICK_MIN_SPEED_REACH, STICK_MIN_STROKE_REACH, anchorPoint, gatesInGrips, stickReach } from './drum_anchor';
import { DRUM_SOUNDS, OFF_PAD_MODES, PAD_IDS, PadsSchema, DEFAULT_PADS_SET, anyPadOn, hitPad, toDisplay, type DrumSound, type PadId } from './drum_pads';

export { DRUM_SOUNDS };
export type { DrumSound };
export const AIR_DRUM_HANDS = ['both', 'right', 'left'] as const;
export type AirDrumHand = (typeof AIR_DRUM_HANDS)[number];
/** The tracked point (#246): the SSOT is `drum_anchor.ts`, shared with the offline scorer. */
export const AIR_DRUM_POINTS = DRUM_ANCHOR_POINTS;
export type AirDrumPoint = (typeof AIR_DRUM_POINTS)[number];
export type PlayerHand = 'right' | 'left';

/** The dial defaults the stick tip's reach gates are calibrated at. */
const DEFAULT_MIN_STROKE = 0.03;
const DEFAULT_MIN_SPEED = 0.5;

const Params = z.object({
  /** Off by default: a player who never turns the air drum on (Instruments view, Air
   *  instruments) hears nothing new. */
  enabled: z.boolean().default(false),
  /** Which of the player's hands drum. */
  hand: z.enum(AIR_DRUM_HANDS).default('both'),
  /** The tracked point: the wrist, the index fingertip, or the tip of a (real or virtual)
   *  stick extended from the grip (`drum_anchor.ts`), which sees a wrist or finger stroke
   *  the wrist itself barely makes. The stick tip is the default because it scored best
   *  on real drum footage and on the synthetic strokes (#246,
   *  `docs/research/air-instruments.md` §7.3). */
  point: z.enum(AIR_DRUM_POINTS).default('stickTip'),
  /** How far the stick reaches past the thumb-index fulcrum, in grip lengths (heel of the
   *  hand to the fulcrum). Only for `point: 'stickTip'`. */
  stickLength: z.number().min(0.5).max(8).default(DEFAULT_STICK_LENGTH),
  /** The drum each hand plays (off the pads, or with no pad on). */
  rightSound: z.enum(DRUM_SOUNDS).default('kick'),
  leftSound: z.enum(DRUM_SOUNDS).default('snare'),
  /** The pads (#245): shapes on the screen, each a drum (`drum_pads.ts`). All off by
   *  default, which leaves the per-hand sounds above. */
  pads: PadsSchema.default(DEFAULT_PADS_SET),
  /** A hit that lands on no pad: the hand's own sound, the nearest pad, or nothing. */
  offPad: z.enum(OFF_PAD_MODES).default('hand'),
  /** How fast a full-speed stroke is: the stroke's mean speed as a multiple of the
   *  slowest stroke this point counts (its `minSpeed` gate). Speed is half of how hard a
   *  hit sounds (`velocityOf`; the other half is its size against the player's recent
   *  strokes); a harder hit is louder and brighter. A ratio, so it means the same
   *  for every tracked point and at any distance from the camera. */
  hardHit: z.number().min(1.1).max(20).default(4),
  /** How far ahead of the strike a hit should be committed, seconds, counted from the
   *  moment this node decides (the frame's age — capture to inference to tick — is
   *  added on top, so the lead is real): the audio output latency plus a margin. A
   *  TARGET: a camera pipeline slower than the stroke's fall can defeat it, in which
   *  case the hit sounds as soon as it can and is reported as late, not predicted. */
  minLead: z.number().min(0).max(0.2).default(0.05),
  /** Timing magnetism, 0..1: how far a predicted hit is pulled toward the conductor's
   *  expected beat (nothing when the conductor is off). */
  magnetism: z.number().min(0).max(1).default(0),
  /** The mirrored webcam reports the opposite hand label (the same knob the conductor
   *  carries). Off for a recorded third-person video. */
  mirrorHandedness: z.boolean().default(true),
  /** Hit loudness, 0..1 (how hard the stroke was scales it). */
  volume: z.number().min(0).max(1).default(0.8),
  /** The smallest stroke that counts, as a fraction of the frame height: a still hand's
   *  jitter and the small bounce of hands coming into frame do not drum. Measured at the
   *  wrist or fingertip; the stick tip's gate is in reaches and this dial scales it
   *  in proportion (`drum_anchor.ts`). */
  minStroke: z.number().min(0.005).max(0.2).default(DEFAULT_MIN_STROKE),
  /** The slowest approach that is a stroke, in frame heights per second: a slow
   *  drift down and up (a melodic hand sweeping) spans a stroke's depth but never at a
   *  stroke's speed (a real stroke peaks well above 1). Scaled like `minStroke`. */
  minSpeed: z.number().min(0).max(5).default(DEFAULT_MIN_SPEED),
});
type Params = z.infer<typeof Params>;

/** The node's params, re-exported as the SSOT for the `airDrum` dial. */
export const AirDrumDialSchema = Params;
export type AirDrumDialParams = Params;
export const DEFAULT_AIR_DRUM_DIAL: AirDrumDialParams = AirDrumDialSchema.parse({});

/** One hit to sound. */
export interface DrumHit {
  /** When it should SOUND, engine seconds (in the future for a predicted hit; the
   *  confirming sample's time for a ghost note). */
  t: number;
  /** 0..1: how hard the stroke was (`velocityOf`) times the volume
   *  dial. The sink reads it for loudness AND tone (a harder hit is brighter). */
  velocity: number;
  hand: PlayerHand;
  sound: DrumSound;
  /** The pad struck, or null (no pad on, or a hit off every pad). */
  pad?: PadId | null;
  /** Where in the pad: 0 = the centre, 1 = the rim (0 without a pad). */
  radial?: number;
  /** The landing point in the displayed frame's fractions (`drum_pads.ts`'s space). */
  x?: number;
  y?: number;
  /** The stroke's mean downward speed over its fall, frame heights per second. */
  speed?: number;
  /** The stroke's size relative to the player's recent strokes, 0..1 (the predictor's). */
  strength?: number;
  /** Predicted ahead of the impact (true) or sounded late on confirmation (false). */
  predicted: boolean;
  /** `t` minus the engine time at which it was decided, seconds: the lead a scheduler
   *  really gets (negative = a late ghost note: how far behind the strike it sounds). */
  lead: number;
  /** The magnet's pull, seconds (0 without a running conductor or with magnetism 0). */
  pull: number;
}

export const DrumHitSchema = z.object({
  t: z.number(),
  velocity: z.number(),
  hand: z.enum(['right', 'left']),
  sound: z.enum(DRUM_SOUNDS),
  predicted: z.boolean(),
  lead: z.number(),
  pull: z.number(),
  pad: z.enum(PAD_IDS).nullable().optional(),
  radial: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  speed: z.number().optional(),
  strength: z.number().optional(),
});
export const DrumHitsSchema = z.array(DrumHitSchema);

/** What the panel shows: the last hit and the running counts. */
export interface AirDrumStatus {
  enabled: boolean;
  /** Hits sounded since enabling. */
  hits: number;
  /** Of them, predicted ahead of the impact. */
  predicted: number;
  lastHand: PlayerHand | null;
  /** The pad the last hit struck, or null. */
  lastPad: PadId | null;
  /** The camera frame's width over its height (0 before a frame): the pad editor draws
   *  its stage in the same shape. */
  frameAspect: number;
  /** The last hit's lead in seconds (negative = a late ghost note). */
  lastLead: number;
  lastPull: number;
  /** Whether each hand's floor has been learned (a first stroke has been seen). */
  ready: { right: boolean; left: boolean };
}

export const IDLE_STATUS: AirDrumStatus = { enabled: false, hits: 0, predicted: 0, lastHand: null, lastPad: null, frameAspect: 0, lastLead: 0, lastPull: 0, ready: { right: false, left: false } };

/** Ghost-note velocity for a stroke sounded on confirmation instead of prediction. */
const GHOST_VELOCITY = 0.6;
/** The softest a counted stroke sounds, as a fraction of full velocity: a stroke that
 *  passed the amplitude and speed gates is a hit, and a hit is never inaudible. */
export const SOFTEST_HIT = 0.15;
/** How far back a stroke's approach is read, seconds (the impact predictor's own
 *  approach window plus a frame). */
export const APPROACH_WINDOW = 0.2;
/** A landing point is never extrapolated further than this past the last sample, seconds. */
const MAX_EXTRAPOLATION = 0.12;
/** A falling stroke may rise this fraction of the smallest stroke between two samples
 *  (landmark jitter) and still be one fall. */
const FALL_JITTER = 0.25;
/** Two samples closer than this are not two camera frames (the conductor's rule). */
const MIN_SAMPLE_SPACING = 0.004;

/** MediaPipe's label for the player's hand, given the mirror convention. */
function labelFor(hand: PlayerHand, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One sample of the tracked point in the displayed frame's fractions. */
export interface TrackSample {
  t: number;
  x: number;
  y: number;
}

/**
 * The stroke's fall so far: the samples up to `tEnd`, walked back from the latest while
 * the point was still descending (y grows, down positive), tolerating `eps` of jitter, at
 * most {@link APPROACH_WINDOW} long, starting at the departure from the top. The top of
 * the swing, where the stick turns or waits, is not part of it, so a quadratic through
 * it is the stroke's own approach.
 */
export function fallingSegment(samples: readonly TrackSample[], tEnd: number, eps: number): TrackSample[] {
  let i = samples.length - 1;
  while (i > 0 && samples[i].t > tEnd + 1e-9) i--;
  if (i < 0) return [];
  let j = i;
  while (j > 0 && samples[j - 1].y < samples[j].y + eps && samples[i].t - samples[j - 1].t <= APPROACH_WINDOW) j--;
  // A stick held at the top (within the jitter of its highest point) has not started to
  // fall: keep only the last of those samples, the departure. The hand may move sideways
  // to the next pad while it waits there, and that is not the stroke's path.
  while (j < i - 2 && samples[j + 1].y <= samples[j].y + eps) j++;
  return samples.slice(j, i + 1);
}

export interface Landing {
  /** Where the stroke lands, display fractions. */
  x: number;
  y: number;
  /** How fast: the fall's mean downward speed so far, frame heights per second. */
  speed: number;
}

/**
 * Where a stroke lands at `t`, and how fast it came down (#245): a quadratic through its
 * falling segment ({@link fallingSegment}) evaluated at `t` (never more than
 * {@link MAX_EXTRAPOLATION} past the last sample), never below the learned `floor` (the
 * impact predictor's plane, where a surface stroke meets it by definition), with x on a
 * line (the sideways drift; a quadratic overshoots on the stick's arc). The speed is the
 * fall's mean speed so far, departure to the latest sample, not a fitted derivative
 * extrapolated to the impact: that one is mostly landmark jitter. With a single falling
 * sample, the last sample and no speed.
 */
export function landingAt(samples: readonly TrackSample[], t: number, eps: number, floor = Infinity): Landing {
  const seg = fallingSegment(samples, t, eps);
  const last = seg[seg.length - 1] ?? samples[samples.length - 1];
  const at = Math.min(t, last.t + MAX_EXTRAPOLATION);
  const tau = at - last.t;
  const ts = seg.map((s) => s.t);
  const fy = seg.length >= 3 ? fitQuadratic(ts, seg.map((s) => s.y), last.t) : null;
  const fx = seg.length >= 2 ? fitLine(ts, seg.map((s) => s.x), last.t) : null;
  // How fast the fall came down so far: its mean speed, departure to the latest sample.
  // Not a fitted derivative: differentiating three noisy samples and extrapolating them
  // ahead makes the speed mostly jitter (an adversarial review measured it).
  const span = seg.length >= 2 ? last.t - seg[0].t : 0;
  const speed = span > 0 ? Math.max(0, (last.y - seg[0].y) / span) : 0;
  return {
    x: fx ? fx.a + fx.b * tau : last.x,
    y: Math.min(fy ? fy.a + fy.b * tau + fy.c * tau * tau : last.y, Math.max(floor, last.y)),
    speed,
  };
}

/** How fast, 0..1: `ratio` is the stroke's speed over the slowest stroke's, `hardHit`
 *  the ratio that counts as a full-speed stroke. */
export function speedTerm(ratio: number, hardHit: number): number {
  return clamp01((ratio - 1) / (hardHit - 1));
}

/** How much of "how hard" is the stroke's size against the player's recent strokes (the
 *  accent), the rest its absolute speed. The accent ranks strokes robustly under
 *  landmark jitter (rank correlation with the true accent 0.78 to 0.85 on the synthetic
 *  stick clips at 0 to 0.05 grip lengths of noise, against 0.62 to 0.80 for the speed
 *  alone), but it is relative: a player who only ever plays softly would sound loud on
 *  it alone. Half and half keeps 0.75 to 0.84 and lets absolute speed set the level. */
export const ACCENT_WEIGHT = 0.5;

/** How hard, as a velocity before the volume dial, from the stroke's relative size
 *  (`strength`, 0..1) and its speed ratio over the slowest stroke. */
export function velocityOf(ratio: number, hardHit: number, strength: number = 1 - ACCENT_WEIGHT): number {
  const h = ACCENT_WEIGHT * clamp01(strength) + (1 - ACCENT_WEIGHT) * speedTerm(ratio, hardHit);
  return SOFTEST_HIT + (1 - SOFTEST_HIT) * clamp01(h);
}

/**
 * A point's stroke gates in frame heights (the predictor's units): the dials themselves
 * for the wrist and the fingertip; for the stick tip the reach gates of `drum_anchor.ts`,
 * scaled by the dials in proportion, times `scale`, one reach in frame heights.
 */
export function gatesFor(c: Pick<Params, 'point' | 'minStroke' | 'minSpeed'>, scale: number): { minAmplitude: number; minApproachSpeed: number } {
  if (!gatesInGrips(c.point)) return { minAmplitude: c.minStroke, minApproachSpeed: c.minSpeed };
  return {
    minAmplitude: STICK_MIN_STROKE_REACH * (c.minStroke / DEFAULT_MIN_STROKE) * scale,
    minApproachSpeed: STICK_MIN_SPEED_REACH * (c.minSpeed / DEFAULT_MIN_SPEED) * scale,
  };
}

interface Stick {
  /** Null until the first sample for a point gated in reaches (its gates need the hand's
   *  size). */
  predictor: ImpactPredictor | null;
  lastT: number;
  /** The frame-height size of one reach the predictor's gates were set for (1 for a point
   *  gated in frame heights), and the smoothed current one. */
  gateScale: number;
  grip: number;
  lastGripT: number;
  /** The tracked point's recent samples, display fractions (the last {@link APPROACH_WINDOW} and a bit). */
  recent: TrackSample[];
}

/** The reach is smoothed over this long (seconds): a stroke's own foreshortening
 *  passes, a player stepping back registers. */
const GRIP_SMOOTHING = 1;
/** A frame's reach is trusted within this factor of the smoothed one (a landmark
 *  glitch is not the player moving). */
const GRIP_GLITCH = 1.25;
/** When the smoothed reach has drifted this factor from the one the gates were set for,
 *  the predictor is rebuilt for the new size (its learned floor with it: one ghost note). */
const GRIP_REGATE = 1.5;
export const airDrumNode = defineNode<Params>({
  type: 'air-drum',
  roles: ['feature', 'mapping'],
  title: 'Air drum',
  description:
    'Strike the air with a hand and hear a drum at the strike: each hand is a stick whose hit is predicted before the frame that shows it (src/ictus/impact.ts). Off by default.',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'air-drum-config' },
    // The conductor's musical time, for the timing magnet. Optional.
    { name: 'time', kind: 'musical-time' },
  ],
  outputs: [
    { name: 'hits', kind: 'drum-hits', schema: DrumHitsSchema },
    { name: 'status', kind: 'air-drum-status' },
    { name: 'enabled', kind: 'boolean' },
  ],
  params: Params,
  make(p) {
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let sticks: Record<PlayerHand, Stick> | null = null;
    let lastFrame: HandsFrame | undefined;
    let status: AirDrumStatus = { ...IDLE_STATUS, ready: { right: false, left: false } };

    const resolveConfig = (raw: unknown): Params => {
      if (raw === lastConfigRef) return cfg;
      lastConfigRef = raw;
      if (raw && typeof raw === 'object') {
        // The override is merged over the build-time params and the WHOLE is validated:
        // `Params.partial()` would fill every field the override leaves out with its
        // schema default, silently resetting the node's own params (and an explicitly
        // undefined key is no override).
        const overrides = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => v !== undefined));
        const parsed = Params.safeParse({ ...p, ...overrides });
        if (parsed.success) {
          cfg = parsed.data;
          return cfg;
        }
      }
      cfg = p;
      return cfg;
    };

    /** A predictor whose gates are in frame heights; `scale` is the frame-height size of
     *  one reach for a stick tip (its gates are in reaches, `drum_anchor.ts`), 1 otherwise. */
    const makePredictor = (c: Params, scale: number): ImpactPredictor => createImpactPredictor({ minLead: c.minLead, ...gatesFor(c, scale) });
    const makeStick = (c: Params): Stick => ({
      predictor: gatesInGrips(c.point) ? null : makePredictor(c, 1),
      lastT: -Infinity,
      gateScale: 1,
      grip: NaN,
      lastGripT: -Infinity,
      recent: [],
    });
    /** Keep a grip-gated stick's predictor set for the hand's current size. */
    const regate = (stick: Stick, c: Params, gripFh: number, t: number) => {
      if (!(gripFh > 0)) return;
      if (!Number.isFinite(stick.grip)) stick.grip = gripFh;
      else {
        const clamped = Math.min(stick.grip * GRIP_GLITCH, Math.max(stick.grip / GRIP_GLITCH, gripFh));
        const a = 1 - Math.exp(-Math.max(0, t - stick.lastGripT) / GRIP_SMOOTHING);
        stick.grip = Math.exp((1 - a) * Math.log(stick.grip) + a * Math.log(clamped));
      }
      stick.lastGripT = t;
      if (!stick.predictor || Math.abs(Math.log(stick.grip / stick.gateScale)) > Math.log(GRIP_REGATE)) {
        stick.predictor = makePredictor(c, stick.grip);
        stick.gateScale = stick.grip;
      }
    };
    /** The config fields that shape a stick: a change rebuilds both sticks (a switched
     *  tracked point or hand must not read as a stroke, and the floor belongs to the
     *  old point), so every dial leaf takes effect live. */
    const stickKey = (c: Params) => `${c.point}|${c.stickLength}|${c.hand}|${c.mirrorHandedness}|${c.minStroke}|${c.minSpeed}`;
    let sticksKey = '';

    const reset = () => {
      sticks = null;
      lastFrame = undefined;
      status = { ...IDLE_STATUS, ready: { right: false, left: false } };
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        if (!c.enabled) {
          if (sticks) reset();
          return { hits: [], status, enabled: false };
        }
        if (!sticks || sticksKey !== stickKey(c)) {
          sticks = { right: makeStick(c), left: makeStick(c) };
          sticksKey = stickKey(c);
          status = { ...IDLE_STATUS, enabled: true, ready: { right: false, left: false } };
        }
        const hits: DrumHit[] = [];
        const frame = inputs.hands as HandsFrame | undefined;
        const sameStamp = !!frame && !!lastFrame && frame.t !== undefined && frame.t === lastFrame.t;
        const fresh = frame !== lastFrame && !sameStamp;
        lastFrame = frame;
        const time = inputs.time as MusicalTime | undefined;
        if (frame && fresh && frame.height > 0) {
          const aspect = frame.width / frame.height;
          if (Math.abs(aspect - status.frameAspect) > 1e-3) status = { ...status, frameAspect: aspect };
          const t = frameTime(frame, ctx);
          // The frame's age: the sample was captured `age` seconds before this decision
          // (the camera, inference and the tick), so the lead the predictor must leave
          // from the sample's time is the dial's lead plus that age.
          const age = Math.max(0, ctx.time - t);
          const hands: PlayerHand[] = c.hand === 'both' ? ['right', 'left'] : [c.hand];
          for (const which of hands) {
            const stick = sticks[which];
            const hand = frame.hands.find((h) => h.handedness === labelFor(which, c.mirrorHandedness));
            if (!hand || t < stick.lastT + MIN_SAMPLE_SPACING) continue;
            const anchor = anchorPoint(hand.keypoints, c.point, { stickLength: c.stickLength });
            if (!anchor) continue;
            stick.lastT = t;
            if (gatesInGrips(c.point)) regate(stick, c, stickReach(hand.keypoints, c.stickLength) / frame.height, t);
            const d = toDisplay(anchor.x, anchor.y, frame.width, frame.height);
            stick.recent.push({ t, x: d.x, y: d.y });
            while (stick.recent.length > 2 && stick.recent[0].t < t - 2 * APPROACH_WINDOW) stick.recent.shift();
            const predictor = stick.predictor;
            if (!predictor) continue;
            predictor.setMinLead(c.minLead + age);
            const handSound = which === 'right' ? c.rightSound : c.leftSound;
            const gates = gatesFor(c, stick.gateScale);
            // A `minSpeed` dial near 0 must not make every stroke infinitely hard: the
            // speed ratio is taken against at least the default dial's gate.
            const hardnessFloor = gatesFor({ ...c, minSpeed: DEFAULT_MIN_SPEED }, stick.gateScale).minApproachSpeed;
            /** What a stroke landing at `at` plays, and how hard (#245): the pad under the
             *  landing point (or the hand's own sound), the centre-to-rim position, and the
             *  stroke's hardness (`velocityOf`) as the velocity before the volume dial. */
            const strike = (landing: Landing, strength: number) => {
              const speed = landing.speed;
              const padHit = anyPadOn(c.pads) ? hitPad(c.pads, landing, c.offPad) : null;
              const silent = !padHit && anyPadOn(c.pads) && c.offPad === 'silent';
              return {
                silent,
                sound: padHit ? padHit.pad.sound : handSound,
                pad: padHit ? padHit.id : null,
                radial: padHit ? clamp01(padHit.radial) : 0,
                x: landing.x,
                y: landing.y,
                speed,
                hardness: velocityOf(speed / Math.max(gates.minApproachSpeed, hardnessFloor), c.hardHit, strength),
              };
            };
            for (const e of predictor.push({ t, x: anchor.x / frame.height, y: anchor.y / frame.height })) {
              if (e.kind === 'predict') {
                const s = strike(landingAt(stick.recent, e.t, gates.minAmplitude * FALL_JITTER, predictor.level()), e.strength);
                if (s.silent) continue;
                let at = e.t;
                let pull = 0;
                if (time && c.magnetism > 0) {
                  const m = magnetise(e.t, time, c.magnetism);
                  // Never behind the decision: a pull toward a beat already past is
                  // truncated to "now", and reported as what it really moved.
                  at = Math.max(ctx.time, m.t);
                  pull = at - e.t;
                }
                // The lead a scheduler really gets: from NOW, not from the sample. A camera
                // pipeline older than the stroke's fall leaves none: that hit is honest
                // about being late (it is not "predicted"), and sounds as soon as it can.
                const lead = at - ctx.time;
                hits.push({
                  t: Math.max(at, ctx.time),
                  velocity: s.hardness * c.volume,
                  hand: which,
                  sound: s.sound,
                  pad: s.pad,
                  radial: s.radial,
                  x: s.x,
                  y: s.y,
                  speed: s.speed,
                  strength: clamp01(e.strength),
                  predicted: lead >= 0,
                  lead,
                  pull,
                });
              } else if (e.predicted === null) {
                // Unpredicted: a ghost note, now; its lead is how late that is. It landed
                // where the deepest sample was.
                const s = strike(landingAt(stick.recent, e.t, gates.minAmplitude * FALL_JITTER), e.strength);
                if (s.silent) continue;
                hits.push({
                  t: ctx.time,
                  velocity: s.hardness * c.volume * GHOST_VELOCITY,
                  hand: which,
                  sound: s.sound,
                  pad: s.pad,
                  radial: s.radial,
                  x: s.x,
                  y: s.y,
                  speed: s.speed,
                  strength: clamp01(e.strength),
                  predicted: false,
                  lead: e.t - ctx.time,
                  pull: 0,
                });
              }
            }
            if (!status.ready[which] && Number.isFinite(predictor.level())) status = { ...status, ready: { ...status.ready, [which]: true } };
          }
        }
        if (hits.length) {
          const last = hits[hits.length - 1];
          status = {
            ...status,
            hits: status.hits + hits.length,
            predicted: status.predicted + hits.filter((h) => h.predicted).length,
            lastHand: last.hand,
            lastPad: last.pad ?? null,
            lastLead: last.lead,
            lastPull: last.pull,
          };
        }
        return { hits, status, enabled: true };
      },
      dispose() {
        reset();
      },
    };
  },
});
