/**
 * `air-drum` node (#233) — strike the air, hear a drum AT the strike.
 *
 * The consumer of the sub-frame impact predictor (`packages/ictus/src/impact.ts`,
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
 * The landing is read along the fall's shape, not at a time (#261). A stick swings on
 * an arc about the hand, so its x is a parabola in its depth near the bottom and a
 * quartic in time (the brake flattens it); a quadratic in time, or a line, extrapolated
 * to the predicted impact lands wide of a hard hit. The depth of a committed stroke is
 * the least certain coordinate of all (one or two falling samples at 30 fps, the brake
 * unseen, the floor learned on another pad), so a pad is picked along the path the
 * stroke is on, and a stroke heading into a pad above the learned floor stops there.
 * And a stick CARRIED down to a lower pad, raised, is not a stroke however fast the arm
 * moves: the tip's descent must come from the stick's own swing ({@link SWING_SHARE});
 * a carried stick's descent is dropped at the predictor, so the stroke the arm was
 * carrying it to is still heard.
 *
 * Each pad has its own floor (#353, `../lib/pad_floors.ts`). The predictor learns one
 * floor per hand, so a stroke after a change of pad was extrapolated to the last pad's
 * depth: where two pads are stacked (the kick under the snare) nearly every snare after a
 * kick read as the kick. Every stroke that stood teaches the pad it TURNED on (read at the
 * predictor's depth of the turn) the depth it stopped at and the top it fell from, and
 * before each sample the predictor is told the floor of the pad the stroke is heading
 * for (`ImpactPredictor.setFloor`): of the pads its way down crosses at their floor, the
 * one whose strokes start nearest where this one did, by where it starts for a stick
 * tip (#533: top and hand) and by the fall's top otherwise. A pad never struck, with no
 * learned pad on the stroke's way, is expected at its centre's depth, moved and topped by
 * the player's strokes on the other pads (#530), until its own first stroke teaches it. With no pad on nothing is named, and the
 * node is what it was.
 *
 * What comes out is a list of {@link DrumHit}s on the `hits` port — each with the
 * time it should SOUND, in engine seconds, possibly in the future — which the
 * `drum-out` node schedules on the audio clock (the two-clock discipline: this node
 * never touches audio). The `time` input is the conductor's `MusicalTime`; with a
 * running follower and a non-zero `magnetism` a predicted hit is pulled toward the
 * nearest expected beat (`packages/ictus/src/magnet.ts`): the actuality ↔ intent dial of the
 * research map, in the player's hands.
 *
 * Honest timing (step 0 of the 2026-10-05 timing plan, #239). A hit says where it
 * really stands against the pipeline: `impactT` is the impact the stroke is heading for
 * (or, for a ghost note, the one it confirmed), `lead` is that intended sounding time
 * minus the decision time BEFORE any clamp (a pull toward a beat already past used to be
 * truncated to "now" first, so `lead` was never negative and every pulled hit reported
 * itself predicted: the artefact behind the 15-of-16 at 100 ms of delay), and `predicted`
 * means the sound can land at its intended time: the lead covers the OUTPUT STAGE, read
 * from the `timing` resource (`@thoremin/sdk/timing/tracker`): the audio output's own
 * latency, which a lead of 10 ms cannot beat. Where that stage is unknown (Safari before
 * the first tap, or under fingerprinting protection) the resource supplies a stated
 * prior and `onTime` says `unknown-output` rather than `yes`; `lateBy` is how far the
 * sound lands after the intended time, 0 when on time.
 *
 * Stamps that cannot carry a sub-frame estimate (#318, timing plan step 9). A `clock`
 * stamp is when the source noticed the frame, not when the camera took it: the sample
 * time is moved back by the timing resource's capture lag (measured from capture-stamped
 * frames, else a stated prior), as an `estimated` stamp already is, so both the impact
 * time and the frame's age (the lead the predictor must leave) count it. And where the
 * clock-derived stamps are noisy (the resource's `stampNoise` over
 * {@link SUBFRAME_MAX_STAMP_NOISE_S}, after the pump's de-jitter), a sub-frame fit is
 * worse than the frame it came from (`subframe-impact-prediction.md` §3.4: 4 ms of stamp
 * noise doubles the known-plane spread and puts the learned-plane one at the
 * frame-snapped detector's): the drum stops predicting and sounds each stroke when the
 * camera shows it, at the deepest sample's own time (the frame-snapped onset), until
 * the noise falls under {@link SUBFRAME_RESUME_STAMP_NOISE_S}. Its status says so.
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
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { clamp01 } from '@thoremin/stats';
import { LAG_MIN_STROKES, LAG_STROKES, createImpactPredictor, lagGate, magnetise, nearestExpectedBeat, type ImpactConfirmation, type ImpactEvent, type ImpactPrediction, type ImpactPredictor, type LagGate, type MusicalTime } from '@thoremin/ictus';
import { createPatternFollower, type PatternFollower, type PatternPlay } from '../lib/pattern_play';
import { DRUM_SOUND } from '../lib/gm_drums';
import type { Hand, HandsFrame } from '@thoremin/sdk/nodes/domain';
import { DEFAULT_STICK_LENGTH, DRUM_ANCHOR_POINTS, STICK_MIN_SPEED_REACH, STICK_MIN_STROKE_REACH, anchorPoint, gatesInGrips, gripHeel, stickReach } from '@thoremin/sdk/nodes/music/drum_anchor';
import { MIN_FLOOR_PADS, learnPadFloor, padFloorFor, type PadFloors } from '../lib/pad_floors';
import { DRUM_SOUNDS, OFF_PAD_MODES, PadsSchema, DEFAULT_PADS_SET, anyPadOn, hitPad, toDisplay, type DrumSound, type PadId } from '@thoremin/sdk/nodes/music/drum_pads';
import { timingFrom, sampleTime, CAPTURE_LAG_PRIOR_S, type TimingView } from '@thoremin/sdk/timing/tracker';
import { APPROACH_WINDOW, CARRY_SWING_FRACTION, deepestSampleTime, fallingSegment, gripAtDeparture, isCarried, type TrackSample } from './air_drum_track';
import { landingAt, velocityOf, type Landing } from './air_drum_landing';
import { DrumHitsSchema, IDLE_STATUS, SUBFRAME_DWELL_FRAMES, magnetStanding, standing, subframeStanding, type AirDrumStatus, type DrumHit, type MagnetOutcome, type PlayerHand, type SubframeStanding } from './air_drum_hit';

export { DRUM_SOUNDS };
export type { DrumSound };
export { APPROACH_WINDOW, CARRY_SWING_FRACTION, deepestSampleTime, fallingSegment, gripAtDeparture, isCarried, swingShare, type TrackSample } from './air_drum_track';
export { ACCENT_WEIGHT, SOFTEST_HIT, landingAt, speedTerm, velocityOf, type Landing, type LandingOptions } from './air_drum_landing';
export { DrumHitSchema, DrumHitsSchema, HIT_ON_TIME, IDLE_STATUS, SUBFRAME_DWELL_FRAMES, SUBFRAME_MAX_STAMP_NOISE_S, SUBFRAME_RESUME_STAMP_NOISE_S, magnetStanding, standing, subframeStanding, type AirDrumStatus, type DrumHit, type HitOnTime, type MagnetStanding, type PlayerHand, type SubframeStanding } from './air_drum_hit';
export const AIR_DRUM_HANDS = ['both', 'right', 'left'] as const;
export type AirDrumHand = (typeof AIR_DRUM_HANDS)[number];
/** The tracked point (#246): the SSOT is `drum_anchor.ts`, shared with the offline scorer. */
export const AIR_DRUM_POINTS = DRUM_ANCHOR_POINTS;
export type AirDrumPoint = (typeof AIR_DRUM_POINTS)[number];
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

/** The status reports the stamp noise to this step (seconds), so it is not rebuilt per frame. */
const STAMP_NOISE_STEP_S = 0.0001;

/** A pull smaller than this is no pull, seconds. */
const NO_PULL = 0.0005;

/** Ghost-note velocity for a stroke sounded on confirmation instead of prediction. */
const GHOST_VELOCITY = 0.6;
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
  /** The impact this stick committed to and the conductor's expected beat nearest it at
   *  the commit (null with no running grid or nothing committed): the confirmation OF
   *  THAT prediction measures the grid's lag (#239). */
  committed: { t: number; grid: number } | null;
  /** The predicted impact this stick last DECIDED on while predicting (sounded, or
   *  skipped as carried or off-pad), or null: a confirmation sounds only when its
   *  prediction was not decided, so a standing that changes mid-stroke (#318) neither
   *  loses the stroke nor plays it twice. */
  handled: number | null;
  /** What this stick's strokes did on each pad (#353): the floor each pad's strokes stop
   *  at, named to the predictor per stroke once two pads have one. Rebuilt with the
   *  predictor (it is in the same units). */
  floors: PadFloors;
  /** The floor last named to the predictor (NaN: none): a prediction taken against it is
   *  read on the pad under its landing point. */
  named: number;
}

/** One tick's reading of the grid, shared by every stroke decided in it. */
interface DrumTick {
  c: Params;
  ctx: NodeContext;
  /** The hits this tick sounds, in the order they were decided. */
  hits: DrumHit[];
  time: MusicalTime | undefined;
  running: boolean;
  /** The magnet is engaged: it would pull this tick's predicted hits. */
  engaged: boolean;
  /** The lag gate as it stood before this tick's confirmations. */
  gate: LagGate;
}

/** A fresh frame's timing, on top of its tick. */
interface FrameTick extends DrumTick {
  outputStage: TimingView['outputStage'];
  aspect: number;
  subframe: SubframeStanding;
  /** The sample's time, and how long before this decision it was captured. */
  t: number;
  age: number;
}

/** One stick fed in one frame: what its strokes are decided with. */
interface StickTick {
  which: PlayerHand;
  stick: Stick;
  predictor: ImpactPredictor;
  /** The tracked point, frame pixels. */
  anchor: { x: number; y: number };
  handSound: DrumSound;
  gates: ReturnType<typeof gatesFor>;
  /** The approach speed a stroke's hardness is taken against at least. */
  hardnessFloor: number;
}

/** What a stroke plays: the pad (or the hand's own sound), where on it, how hard. */
interface Strike {
  silent: boolean;
  sound: DrumSound;
  pad: PadId | null;
  radial: number;
  x: number;
  y: number;
  speed: number;
  hardness: number;
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
    'Strike the air with a hand and hear a drum at the strike: each hand is a stick whose hit is predicted before the frame that shows it (packages/ictus/src/impact.ts). Off by default.',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'air-drum-config' },
    // The conductor's musical time, for the timing magnet. Optional.
    { name: 'time', kind: 'musical-time' },
    // #269: a trained pattern in play. With one, each predicted hit is snapped to the
    // pattern's grid at the player's running tempo with their feel, on the drum whose pad
    // they struck; the magnet is not used.
    { name: 'pattern', kind: 'drum-pattern' },
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
    /** Consecutive frames asking for the other sub-frame standing (#318). */
    let subframeAsks = 0;
    /** #269: the pattern in play and its follower. */
    let playFor: PatternPlay | null = null;
    let follower: PatternFollower | null = null;

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
      committed: null,
      handled: null,
      floors: {},
      named: NaN,
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
        stick.floors = {};
      }
    };
    /** The config fields that shape a stick: a change rebuilds both sticks (a switched
     *  tracked point or hand must not read as a stroke, and the floor belongs to the
     *  old point), so every dial leaf takes effect live. */
    const stickKey = (c: Params) => `${c.point}|${c.stickLength}|${c.hand}|${c.mirrorHandedness}|${c.minStroke}|${c.minSpeed}`;
    let sticksKey = '';
    /** #239: the last strokes' `impact - grid at commit`, both hands (one grid). */
    let lags: number[] = [];
    /** #239: what became of the magnet's pull, per engaged stroke, the last few. */
    let magnetRun: MagnetOutcome[] = [];
    /** Whether the grid was running at the last tick (a restart clears `lags`). */
    let wasRunning = false;
    const noteOutcome = (o: MagnetOutcome) => {
      magnetRun.push(o);
      if (magnetRun.length > LAG_STROKES) magnetRun.shift();
    };

    const reset = () => {
      sticks = null;
      lags = [];
      magnetRun = [];
      lastFrame = undefined;
      status = { ...IDLE_STATUS, ready: { right: false, left: false } };
    };

    /** Rebuild both sticks when the config fields that shape one changed (see
     *  {@link stickKey}), and hand back the live pair. */
    const resolveSticks = (c: Params): Record<PlayerHand, Stick> => {
      if (!sticks || sticksKey !== stickKey(c)) {
        sticks = { right: makeStick(c), left: makeStick(c) };
        sticksKey = stickKey(c);
        // The grid's lag is measured against THIS tracked point (a wrist-tracking
        // conductor sits differently behind a stick tip than behind a wrist).
        lags = [];
        magnetRun = [];
        status = { ...IDLE_STATUS, enabled: true, ready: { right: false, left: false } };
      }
      return sticks;
    };

    /** The frame to play this tick, or null: a frame already seen (by reference or by its
     *  stamp) or with no height is not played again. */
    const freshFrame = (frame: HandsFrame | undefined): HandsFrame | null => {
      const sameStamp = !!frame && !!lastFrame && frame.t !== undefined && frame.t === lastFrame.t;
      const fresh = frame !== lastFrame && !sameStamp;
      lastFrame = frame;
      return frame && fresh && frame.height > 0 ? frame : null;
    };

    /** #269: follow the pattern in play (a new one gets a new follower). */
    const syncPattern = (play: PatternPlay | null) => {
      if (play === playFor) return;
      playFor = play;
      follower = play ? createPatternFollower({ pattern: play.pattern, model: play.model }) : null;
      if (follower && play?.startAt !== undefined) follower.start(play.startAt);
    };

    /** The grid's standing for this tick: running, the magnet engaged, the lag gate. */
    const beginTick = (c: Params, ctx: NodeContext, time: MusicalTime | undefined): DrumTick => {
      const running = !!time && time.state === 'running';
      // A grid that stopped and restarted is a new grid: the lag measured against the
      // old one says nothing about it.
      if (running && !wasRunning) lags = [];
      wasRunning = running;
      const engaged = running && c.magnetism > 0 && !follower;
      if (!engaged) magnetRun = [];
      return { c, ctx, hits: [], time, running, engaged, gate: lagGate(lags) };
    };

    /** The sub-frame standing for this frame (#318; see the header), held for
     *  {@link SUBFRAME_DWELL_FRAMES} before a change is taken. */
    const subframeStep = (timing: TimingView): SubframeStanding => {
      const rawNoise = timing.stampNoise ?? NaN;
      const stampNoise = Number.isFinite(rawNoise) ? Math.round(rawNoise / STAMP_NOISE_STEP_S) * STAMP_NOISE_STEP_S : NaN;
      const asked = subframeStanding(status.subframe, timing.dominantSource ?? null, rawNoise);
      subframeAsks = asked === status.subframe ? 0 : subframeAsks + 1;
      const subframe = subframeAsks >= SUBFRAME_DWELL_FRAMES ? asked : status.subframe;
      if (subframe !== status.subframe) subframeAsks = 0;
      if (subframe !== status.subframe || !Object.is(stampNoise, status.stampNoise)) status = { ...status, subframe, stampNoise };
      return subframe;
    };

    /** A fresh frame's timing: its aspect, the sub-frame standing, the sample time and age. */
    const frameTick = (tick: DrumTick, frame: HandsFrame): FrameTick => {
      const { ctx } = tick;
      // The output stage (how long after the decision the earliest sound can leave the
      // device), from the host's timing resource; a stated prior, flagged, when unknown.
      const timing = timingFrom(ctx.resources);
      const aspect = frame.width / frame.height;
      if (Math.abs(aspect - status.frameAspect) > 1e-3) status = { ...status, frameAspect: aspect };
      const subframe = subframeStep(timing);
      // A `clock` stamp (honoured) is when the source noticed the frame: the camera
      // took it the capture lag earlier (#318). An `estimated` stamp already is. The
      // rule is the timing resource's own, so its frame age is this one (#393).
      const t = sampleTime(frame, ctx, timing.captureLag?.value ?? CAPTURE_LAG_PRIOR_S);
      // The frame's age: the sample was captured `age` seconds before this decision
      // (the camera, inference and the tick), so the lead the predictor must leave
      // from the sample's time is the dial's lead plus that age.
      const age = Math.max(0, ctx.time - t);
      return { ...tick, outputStage: timing.outputStage, aspect, subframe, t, age };
    };

    /** Feed one stick its hand's tracked point in this frame; null when there is nothing
     *  to feed (no such hand, too soon after the last sample, no point, no predictor yet). */
    const trackStick = (f: FrameTick, frame: HandsFrame, which: PlayerHand, stick: Stick): StickTick | null => {
      const { c, t } = f;
      const hand = frame.hands.find((h) => h.handedness === labelFor(which, c.mirrorHandedness));
      if (!hand || t < stick.lastT + MIN_SAMPLE_SPACING) return null;
      const anchor = anchorPoint(hand.keypoints, c.point, { stickLength: c.stickLength });
      if (!anchor) return null;
      stick.lastT = t;
      if (gatesInGrips(c.point)) regate(stick, c, stickReach(hand.keypoints, c.stickLength) / frame.height, t);
      const d = toDisplay(anchor.x, anchor.y, frame.width, frame.height);
      const sample: TrackSample = { t, x: d.x, y: d.y };
      if (gatesInGrips(c.point)) {
        const heel = gripHeel(hand.keypoints);
        sample.grip = toDisplay(heel.x, heel.y, frame.width, frame.height);
      }
      stick.recent.push(sample);
      while (stick.recent.length > 2 && stick.recent[0].t < t - 2 * APPROACH_WINDOW) stick.recent.shift();
      const predictor = stick.predictor;
      if (!predictor) return null;
      predictor.setMinLead(c.minLead + f.age);
      const gates = gatesFor(c, stick.gateScale);
      return {
        which,
        stick,
        predictor,
        anchor,
        handSound: which === 'right' ? c.rightSound : c.leftSound,
        gates,
        // A `minSpeed` dial near 0 must not make every stroke infinitely hard: the
        // speed ratio is taken against at least the default dial's gate.
        hardnessFloor: gatesFor({ ...c, minSpeed: DEFAULT_MIN_SPEED }, stick.gateScale).minApproachSpeed,
      };
    };

    /** What a stroke landing at `at` plays, and how hard (#245): the pad under the
     *  landing point (or the hand's own sound), the centre-to-rim position, and the
     *  stroke's hardness (`velocityOf`) as the velocity before the volume dial. */
    const strike = (c: Params, st: StickTick, landing: Landing, strength: number, { named = false } = {}): Strike => {
      const speed = landing.speed;
      const alongPath = anyPadOn(c.pads) ? hitPad(c.pads, landing, c.offPad, landing.path) : null;
      // A stroke predicted against the floor of the pad it is heading for (#353) lands at
      // that pad's depth. The path walks down from the stroke and takes the first pad it
      // crosses, which is right for a pad no floor describes yet (the stroke may be going
      // there) but not for one with a floor the rule already weighed and passed over (the
      // snare above a kick that does not overlap it): then the pad under the landing point.
      const under = named && alongPath && st.stick.floors[alongPath.id] ? hitPad(c.pads, landing, 'silent') : null;
      const padHit = under ?? alongPath;
      const silent = !padHit && anyPadOn(c.pads) && c.offPad === 'silent';
      return {
        silent,
        sound: padHit ? padHit.pad.sound : st.handSound,
        pad: padHit ? padHit.id : null,
        radial: padHit ? clamp01(padHit.radial) : 0,
        x: padHit ? padHit.at.x : landing.x,
        y: padHit ? padHit.at.y : landing.y,
        speed,
        hardness: velocityOf(speed / Math.max(st.gates.minApproachSpeed, st.hardnessFloor), c.hardHit, strength),
      };
    };

    /** A raised stick carried down by the arm (#261): not a stroke, whatever the
     *  predictor made of its depth. Dropped there too, so the stroke the arm is
     *  carrying it toward starts fresh from where the carry ends. */
    const carried = (st: StickTick, tEnd: number, floor: number) => {
      const seg = fallingSegment(st.stick.recent, tEnd, st.gates.minAmplitude * FALL_JITTER);
      if (seg.length < 2) return false;
      const fallen = seg[seg.length - 1].y - seg[0].y;
      const amplitude = Number.isFinite(floor) ? Math.max(fallen, floor - seg[0].y) : fallen;
      if (!isCarried(seg, { amplitude, minSwing: CARRY_SWING_FRACTION * st.gates.minAmplitude })) return false;
      st.predictor.dropStroke();
      return true;
    };

    /** A confirmation while the stamps cannot carry a sub-frame fit (#318). */
    const onSnapped = (f: FrameTick, st: StickTick, e: ImpactConfirmation, decided: boolean): boolean => {
      const { c, ctx } = f;
      const { stick } = st;
      stick.committed = null;
      stick.handled = null;
      if (decided) return true;
      // The frame-snapped onset (#318): the deepest sample's own time, sounded
      // now. A full hit, not a ghost: every stroke is reactive here, and it is the
      // stamps, not the stroke, that ruled prediction out. No magnet outcome: the
      // magnet can pull nothing it was never offered, and the status says why.
      if (carried(st, e.t, NaN)) return false;
      const snappedT = deepestSampleTime(stick.recent, e.t);
      const s = strike(c, st, landingAt(stick.recent, snappedT, st.gates.minAmplitude * FALL_JITTER, { turned: true, aspect: f.aspect, depth: anyPadOn(c.pads) ? e.depth : NaN }), e.strength);
      if (s.silent) return true;
      // Pattern mode keeps following (its drum names the sound); the time stays now.
      let sound = s.sound;
      if (follower) {
        if (follower.beat(snappedT) === null) follower.start(snappedT);
        const snap = follower.snap(snappedT, { sound: s.sound, pad: s.pad });
        if (snap.event !== null && snap.drum) sound = DRUM_SOUND[snap.drum];
      }
      f.hits.push({
        t: ctx.time,
        impactT: snappedT,
        velocity: s.hardness * c.volume,
        hand: st.which,
        sound,
        pad: s.pad,
        radial: s.radial,
        x: s.x,
        y: s.y,
        speed: s.speed,
        strength: clamp01(e.strength),
        ...standing(snappedT, ctx.time, f.outputStage),
        pull: 0,
      });
      return true;
    };

    /** A predicted impact: sounded ahead of the frame that shows it, pulled toward the
     *  pattern's grid or by the magnet. */
    const onPredict = (f: FrameTick, st: StickTick, e: ImpactPrediction) => {
      const { c, ctx, time, engaged, gate } = f;
      const { stick } = st;
      // The grid this stroke is committed against, before anything can skip it:
      // its confirmation measures the grid's lag (rule a), whether or not the
      // magnet is on, so the gate is warm when the player turns it up.
      stick.committed = f.running ? { t: e.t, grid: nearestExpectedBeat(time!, e.t) } : null;
      stick.handled = e.t;
      if (carried(st, e.t, e.floor)) return;
      const s = strike(c, st, landingAt(stick.recent, e.t, st.gates.minAmplitude * FALL_JITTER, { floor: e.floor, aspect: f.aspect }), e.strength, { named: stick.named === e.floor });
      if (s.silent) return;
      /** The INTENDED sounding time: the impact, pulled toward the grid. */
      let intended = e.t;
      let sound = s.sound;
      /** Whether a snap or the magnet moved the sounding time: only then is the
       *  move a `pull`; the clamp alone (an impact already past at the decision,
       *  a lastChance commit on a slow pipeline) is not one. */
      let pulled = false;
      /** Rule (a): the magnet's pull before the lag gate (to tell a gated
       *  stroke from one the magnet's own window left alone). */
      let wanted = 0;
      if (follower) {
        // Pattern mode: the first hit is the one when no count-in said where it falls.
        if (follower.beat(e.t) === null) follower.start(e.t);
        const snap = follower.snap(e.t, { sound: s.sound, pad: s.pad });
        if (snap.event !== null) {
          intended = snap.at;
          pulled = true;
          if (snap.drum) sound = DRUM_SOUND[snap.drum];
        }
      } else if (engaged) {
        // Rule (a): the pull scaled by the lag gate. A grid sitting measurably
        // off the strokes pulls nothing.
        wanted = magnetise(e.t, time!, c.magnetism).pull;
        intended = e.t + wanted * gate.gate;
        pulled = true;
      }
      // Rule (b): never before the earliest sound, the decision plus the output
      // stage (from the timing resource: never "now", which the device cannot
      // reach). A pull toward a beat already behind that is truncated to it, and
      // `pull` reports the move actually made against where the unpulled impact
      // would have sounded; the lead reports what was intended.
      const earliest = ctx.time + f.outputStage.value;
      const at = pulled ? Math.max(earliest, intended) : Math.max(ctx.time, intended);
      const pull = pulled ? at - Math.max(earliest, e.t) : 0;
      if (engaged) {
        // What stopped a pull, in order: none asked for; the pipeline (even the
        // ungated pull would have been truncated to nothing); the lag gate.
        const ungatedMove = Math.max(earliest, e.t + wanted) - Math.max(earliest, e.t);
        noteOutcome(
          Math.abs(pull) >= NO_PULL ? 'pulled'
          : Math.abs(wanted) < NO_PULL ? 'quiet'
          : Math.abs(ungatedMove) < NO_PULL ? 'pipeline'
          : gate.gate === 0 ? (gate.n < LAG_MIN_STROKES ? 'warming' : 'gated')
          : Math.abs(wanted * gate.gate) < NO_PULL ? 'quiet'
          : 'pipeline',
        );
      }
      f.hits.push({
        t: at,
        impactT: e.t,
        velocity: s.hardness * c.volume,
        hand: st.which,
        sound,
        pad: s.pad,
        radial: s.radial,
        x: s.x,
        y: s.y,
        speed: s.speed,
        strength: clamp01(e.strength),
        ...standing(intended, ctx.time, f.outputStage),
        pull,
      });
    };

    /** Rule (a): a predicted stroke confirmed: how far the impact landed from the
     *  grid used at its commit. The confirmed impact, never what was sounded
     *  (rule c: nothing pulled or truncated is ever fed back). */
    const onConfirm = (stick: Stick, e: ImpactConfirmation) => {
      const committed = stick.committed;
      if (committed && committed.t === e.predicted && Number.isFinite(committed.grid)) {
        lags.push(e.t - committed.grid);
        if (lags.length > LAG_STROKES) lags.shift();
      }
      stick.committed = null;
      stick.handled = null;
    };

    /** Unpredicted (or predicted while prediction was off, #318): a ghost note,
     *  now; its lead is how late that is. It landed where the deepest sample was. */
    const onGhost = (f: FrameTick, st: StickTick, e: ImpactConfirmation): boolean => {
      const { c, ctx } = f;
      const { stick } = st;
      stick.committed = null;
      stick.handled = null;
      if (carried(st, e.t, NaN)) return false;
      const s = strike(c, st, landingAt(stick.recent, e.t, st.gates.minAmplitude * FALL_JITTER, { turned: true, aspect: f.aspect, depth: anyPadOn(c.pads) ? e.depth : NaN }), e.strength);
      if (s.silent) return true;
      // A stroke the pipeline could not predict cannot be pulled.
      if (f.engaged) noteOutcome('pipeline');
      f.hits.push({
        t: ctx.time,
        impactT: e.t,
        velocity: s.hardness * c.volume * GHOST_VELOCITY,
        hand: st.which,
        sound: s.sound,
        pad: s.pad,
        radial: s.radial,
        x: s.x,
        y: s.y,
        speed: s.speed,
        strength: clamp01(e.strength),
        ...standing(e.t, ctx.time, f.outputStage),
        pull: 0,
      });
      return true;
    };

    /** #353: a stroke that stood (not a carry) teaches the floor of the pad it STOPPED on
     *  (its path ends where it turned, so a stroke stopped above a pad is not on it): the
     *  depth it turned at and the top it fell from. Off every pad, nothing. */
    const learnFloor = (f: FrameTick, st: StickTick, e: ImpactConfirmation) => {
      const { c } = f;
      if (!anyPadOn(c.pads)) return;
      const { stick } = st;
      const eps = st.gates.minAmplitude * FALL_JITTER;
      // Where it turned (the predictor's depth of the turn, not the fall's fit read at its
      // time), on the pad under that point.
      const hit = hitPad(c.pads, landingAt(stick.recent, e.t, eps, { turned: true, aspect: f.aspect, depth: e.depth }), 'silent');
      if (hit) stick.floors = learnPadFloor(stick.floors, hit.id, { floor: e.depth, top: e.top, grip: gripAtDeparture(stick.recent, e.t, eps) });
    };

    /** #353: name the predictor the floor of the pad the stroke in progress is heading for
     *  (NaN, its own floor, until a pad has one). */
    const nameFloor = (f: FrameTick, st: StickTick) => {
      const { c } = f;
      const { stick, predictor } = st;
      let floor = NaN;
      if (anyPadOn(c.pads) && Object.keys(stick.floors).length >= MIN_FLOOR_PADS) {
        const top = predictor.top();
        const eps = st.gates.minAmplitude * FALL_JITTER;
        if (Number.isFinite(top)) floor = padFloorFor(stick.floors, c.pads, { top, grip: gripAtDeparture(stick.recent, f.t, eps), xAt: landingAt(stick.recent, f.t, eps, { aspect: f.aspect }).path.xAt });
      }
      predictor.setFloor(floor);
      stick.named = floor;
    };

    /** One predictor event, routed by kind and by the sub-frame standing. */
    const onEvent = (f: FrameTick, st: StickTick, e: ImpactEvent) => {
      if (e.kind === 'predict') {
        // With the stamps unable to carry the fit, no prediction is sounded (the stroke
        // sounds at its confirmation, frame-snapped).
        if (f.subframe === 'off-stamps') st.stick.committed = null;
        else onPredict(f, st, e);
        return;
      }
      /** A confirmation whose prediction was already decided (while predicting). */
      const decided = e.predicted !== null && st.stick.handled === e.predicted;
      let stood = true;
      if (f.subframe === 'off-stamps') stood = onSnapped(f, st, e, decided);
      else if (decided) onConfirm(st.stick, e);
      else stood = onGhost(f, st, e);
      if (stood) learnFloor(f, st, e);
    };

    /** Play one fresh frame: every stick the config names takes its sample and its events. */
    const playFrame = (tick: DrumTick, frame: HandsFrame, live: Record<PlayerHand, Stick>) => {
      const f = frameTick(tick, frame);
      const hands: PlayerHand[] = f.c.hand === 'both' ? ['right', 'left'] : [f.c.hand];
      for (const which of hands) {
        const st = trackStick(f, frame, which, live[which]);
        if (!st) continue;
        const { predictor, anchor } = st;
        nameFloor(f, st);
        for (const e of predictor.push({ t: f.t, x: anchor.x / frame.height, y: anchor.y / frame.height })) onEvent(f, st, e);
        if (!status.ready[which] && Number.isFinite(predictor.level())) status = { ...status, ready: { ...status.ready, [which]: true } };
      }
    };

    /** The status after a tick: the magnet's standing, then this tick's hits counted. */
    const updateStatus = ({ engaged, hits }: DrumTick) => {
      const g = lagGate(lags);
      const magnet = engaged ? magnetStanding(magnetRun) : 'off';
      if (magnet !== status.magnet || !Object.is(g.lag, status.magnetLag) || g.gate !== status.magnetGate) status = { ...status, magnet, magnetLag: g.lag, magnetGate: g.gate };
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
          lastOnTime: last.onTime,
          lastLateBy: last.lateBy,
        };
      }
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        if (!c.enabled) {
          if (sticks) reset();
          return { hits: [], status, enabled: false };
        }
        const live = resolveSticks(c);
        const frame = freshFrame(inputs.hands as HandsFrame | undefined);
        syncPattern((inputs.pattern as PatternPlay | null | undefined) ?? null);
        const tick = beginTick(c, ctx, inputs.time as MusicalTime | undefined);
        if (frame) playFrame(tick, frame, live);
        updateStatus(tick);
        return { hits: tick.hits, status, enabled: true };
      },
      dispose() {
        reset();
      },
    };
  },
});
