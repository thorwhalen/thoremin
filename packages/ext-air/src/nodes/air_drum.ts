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
import { clamp01, median } from '@thoremin/stats';
import { LAG_MIN_STROKES, LAG_STROKES, createImpactPredictor, fitLine, fitQuadratic, lagGate, magnetise, nearestExpectedBeat, type ImpactConfirmation, type ImpactEvent, type ImpactPrediction, type ImpactPredictor, type LagGate, type MusicalTime, type Quadratic } from '@thoremin/ictus';
import { createPatternFollower, type PatternFollower, type PatternPlay } from '../lib/pattern_play';
import { DRUM_SOUND } from '../lib/gm_drums';
import { isClockDerived, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { DEFAULT_STICK_LENGTH, DRUM_ANCHOR_POINTS, STICK_MIN_SPEED_REACH, STICK_MIN_STROKE_REACH, anchorPoint, gatesInGrips, gripHeel, stickReach } from '@thoremin/sdk/nodes/music/drum_anchor';
import { DRUM_SOUNDS, OFF_PAD_MODES, PAD_IDS, PadsSchema, DEFAULT_PADS_SET, anyPadOn, hitPad, toDisplay, type DrumSound, type FallPath, type PadId } from '@thoremin/sdk/nodes/music/drum_pads';
import { timingFrom, sampleTime, CAPTURE_LAG_PRIOR_S, type TimingView } from '@thoremin/sdk/timing/tracker';

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

/** Whether a hit's sound lands at its intended time: `yes` (the lead covers the audio
 *  output stage), `late` (it does not: the sound lands `lateBy` after the intended time),
 *  or `unknown-output` (the lead is not negative, but the output stage of this browser
 *  is not known: Safari before the first tap, fingerprinting protection; whether the
 *  lead covers it cannot be said, so neither `yes` nor `late` is). */
export const HIT_ON_TIME = ['yes', 'late', 'unknown-output'] as const;
export type HitOnTime = (typeof HIT_ON_TIME)[number];

/** One hit to sound. */
export interface DrumHit {
  /** When it should SOUND, engine seconds (in the future for a predicted hit; the
   *  confirming sample's time for a ghost note). Never before the decision. */
  t: number;
  /** The impact itself, engine seconds: the predicted impact for a predicted hit (before
   *  any pull), the confirmed one for a ghost note (whose `t` is the sounding time). What
   *  a beat follower may be fed; never `t`, which carries the pull and the clamp. */
  impactT: number;
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
  /** The sound can land at its intended time: the lead covers the output stage (true),
   *  or it cannot (false: a ghost note, or a prediction whose lead the audio output
   *  eats). Equivalent to `onTime !== 'late'`. */
  predicted: boolean;
  /** The three-valued form of `predicted`: see {@link HitOnTime}. */
  onTime: HitOnTime;
  /** The INTENDED sounding time (the impact, pulled) minus the engine time at which it
   *  was decided, seconds, unclamped: negative when the intended time was already past at
   *  the decision (a ghost note, a pull toward a beat gone by). */
  lead: number;
  /** How far the sound lands after its intended time, seconds: 0 when on time; the
   *  shortfall of `lead` against the output stage otherwise. With an unknown stage
   *  (`unknown-output`, or `late` under the prior) only the certain part: how far the
   *  intended time was already past at the decision. */
  lateBy: number;
  /** The move actually made from the impact to the sounding time, seconds: the magnet's
   *  pull (or the pattern's snap), after the clamp to the decision time (0 without a
   *  running conductor or with magnetism 0). */
  pull: number;
}

export const DrumHitSchema = z.object({
  t: z.number(),
  impactT: z.number(),
  velocity: z.number(),
  hand: z.enum(['right', 'left']),
  sound: z.enum(DRUM_SOUNDS),
  predicted: z.boolean(),
  onTime: z.enum(HIT_ON_TIME),
  lead: z.number(),
  lateBy: z.number(),
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
  /** The last hit's standing against the output stage, and how late its sound lands. */
  lastOnTime: HitOnTime;
  lastLateBy: number;
  /** Where the timing magnet stands (#239): see {@link MagnetStanding}. */
  magnet: MagnetStanding;
  /** The grid's measured offset from the strokes, seconds: the mean `impact - grid` over
   *  the last {@link LAG_STROKES} predicted strokes (positive = the grid runs EARLY, the
   *  strokes land after it; negative = it lags them; NaN before any), and the factor the
   *  lag gate scales a pull by, 0..1. */
  magnetLag: number;
  magnetGate: number;
  /** Whether each hand's floor has been learned (a first stroke has been seen). */
  ready: { right: boolean; left: boolean };
  /** Sub-frame prediction (#318): `on`, or `off-stamps` when the frame stamps are too
   *  noisy to carry it (strokes then sound when the camera shows them). */
  subframe: SubframeStanding;
  /** The stamp noise the standing was decided on, seconds (NaN when unknown). */
  stampNoise: number;
}

export type SubframeStanding = 'on' | 'off-stamps';
/** Clock-derived stamps noisier than this (seconds) switch sub-frame prediction off: the
 *  bench's 4 ms, where the learned-plane prediction is no better than the frame-snapped
 *  detector (`subframe-impact-prediction.md` §3.4). */
export const SUBFRAME_MAX_STAMP_NOISE_S = 0.004;
/** ...and under this, back on (hysteresis, so a noise near the bound does not flap). */
export const SUBFRAME_RESUME_STAMP_NOISE_S = 0.003;
/** A new standing is taken only after this many consecutive frames ask for it. */
export const SUBFRAME_DWELL_FRAMES = 15;
/** The status reports the stamp noise to this step (seconds), so it is not rebuilt per frame. */
const STAMP_NOISE_STEP_S = 0.0001;

/** The sub-frame standing after this frame: `off-stamps` once the dominant stamps are
 *  clock-derived and noisier than the bound, `on` again once they are not, unchanged
 *  while the noise is unknown or between the two bounds. */
export function subframeStanding(prev: SubframeStanding, dominantSource: string | null, stampNoise: number): SubframeStanding {
  const derived = isClockDerived(dominantSource);
  if (!derived) return dominantSource === null ? prev : 'on';
  if (!Number.isFinite(stampNoise)) return prev;
  if (stampNoise > SUBFRAME_MAX_STAMP_NOISE_S) return 'off-stamps';
  if (stampNoise < SUBFRAME_RESUME_STAMP_NOISE_S) return 'on';
  return prev;
}

export const IDLE_STATUS: AirDrumStatus = { enabled: false, hits: 0, predicted: 0, lastHand: null, lastPad: null, frameAspect: 0, lastLead: 0, lastPull: 0, lastOnTime: 'yes', lastLateBy: 0, magnet: 'off', magnetLag: NaN, magnetGate: 0, ready: { right: false, left: false }, subframe: 'on', stampNoise: NaN };

/**
 * Where the timing magnet stands over the last {@link LAG_STROKES} strokes it was engaged
 * for (magnetism above 0, a running conductor, no pattern in play):
 * - `off`: not engaged;
 * - `on`: engaged, and not blocked: some stroke in the run was pulled, the run is not
 *   full yet, or nothing in it asked for a pull (the conductor warming up or unsure, the
 *   grid's lag not yet measured over enough strokes, strokes outside the beat's window);
 * - `too-slow`: no stroke in the run was pulled, and most were lost to the pipeline: ghost notes (a
 *   stroke too fast for the pipeline is never predicted, so never pulled) and pulls
 *   truncated to nothing because the beat was already behind the earliest sound;
 * - `grid-lag`: no stroke in the run was pulled, and most were zeroed by the lag gate: the grid sits further
 *   from the strokes than their own scatter explains (a lagging follower), so pulling
 *   toward it would make the timing worse.
 */
export type MagnetStanding = 'off' | 'on' | 'too-slow' | 'grid-lag';

/** What became of the magnet's pull for one engaged stroke. */
type MagnetOutcome = 'pulled' | 'quiet' | 'warming' | 'gated' | 'pipeline';

/** A pull smaller than this is no pull, seconds. */
const NO_PULL = 0.0005;

/** The magnet's standing over a run of engaged strokes' outcomes: blocked only when a
 *  full run pulled nothing AND most of it was blocked (a warm-up ghost among strokes the
 *  magnet had no reason to pull is not evidence of anything). */
export function magnetStanding(run: readonly MagnetOutcome[]): MagnetStanding {
  if (!run.length) return 'off';
  if (run.length < LAG_STROKES || run.some((o) => o === 'pulled')) return 'on';
  const pipeline = run.filter((o) => o === 'pipeline').length;
  const gated = run.filter((o) => o === 'gated').length;
  if (2 * (pipeline + gated) <= run.length) return 'on';
  return pipeline >= gated ? 'too-slow' : 'grid-lag';
}

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
/** The displayed frame's bottom edge, display fractions: as far as a landing path runs. */
const FRAME_BOTTOM = 1;

/**
 * A hit's standing against the pipeline (step 0b, #239): its lead from the decision
 * (unclamped), whether its sound can land at the intended time, and by how much it
 * cannot. The earliest a sound decided at `decisionT` can leave the device is
 * `decisionT + outputStage.value`, so the lead must cover the stage. When the stage is
 * only the stated prior (its source says so) that comparison is not a measurement: a
 * lead at or above zero is `unknown-output`, never a definite `late` with a `lateBy`
 * read off a guess, and a negative lead is late by at least its own size.
 */
export function standing(intendedT: number, decisionT: number, outputStage: { value: number; source: string }): Pick<DrumHit, 'lead' | 'lateBy' | 'predicted' | 'onTime'> {
  const lead = intendedT - decisionT;
  if (outputStage.source === 'prior') {
    const onTime: HitOnTime = lead >= 0 ? 'unknown-output' : 'late';
    return { lead, lateBy: Math.max(0, -lead), predicted: onTime !== 'late', onTime };
  }
  const lateBy = Math.max(0, outputStage.value - lead);
  const onTime: HitOnTime = lateBy > 0 ? 'late' : 'yes';
  return { lead, lateBy, predicted: onTime !== 'late', onTime };
}

/** MediaPipe's label for the player's hand, given the mirror convention. */
function labelFor(hand: PlayerHand, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}

/** One sample of the tracked point in the displayed frame's fractions. */
export interface TrackSample {
  t: number;
  x: number;
  y: number;
  /** The grip (the heel of the hand, where the stick's butt leaves the palm and near
   *  enough the wrist joint the stick turns about; display fractions) when the point is a
   *  stick tip. The tip is one reach from it by construction (the estimate extends the
   *  heel-to-fulcrum line), so the tip's depth over it is the stick's own swing, a change
   *  in it the hand's rotation, and the tip's path an arc about it. Absent for a point
   *  with no lever (the wrist, a fingertip). */
  grip?: { x: number; y: number };
}

/**
 * The frame-snapped onset of a stroke confirmed at about `near` (#318): the time of the
 * deepest sample (largest display `y`) within one and a half frame periods of it (the
 * period read from the samples' own spacing), so a fast roll's previous, deeper stroke is
 * never taken; `near` itself when no sample is there.
 */
export function deepestSampleTime(recent: readonly TrackSample[], near: number): number {
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) if (recent[i].t > recent[i - 1].t) gaps.push(recent[i].t - recent[i - 1].t);
  // The period: the upper median of the gaps (a real gap), 0 with none.
  const frame = gaps.length ? median(gaps, { even: 'upper' }) : 0;
  const reach = 1.5 * frame + 1e-9;
  let best: TrackSample | null = null;
  for (const s of recent) {
    if (Math.abs(s.t - near) > reach) continue;
    if (!best || s.y > best.y) best = s;
  }
  return best ? best.t : near;
}

/**
 * How much of the tip's descent over its fall is the stick's own swing, the rest the
 * hand carrying it: 1 for a wrist stroke, 0 for a raised stick carried down to a lower
 * pad, in between when the arm takes part (#261). NaN for a point with no grip.
 */
export function swingShare(seg: readonly TrackSample[]): number {
  if (seg.length < 2) return NaN;
  const first = seg[0];
  const last = seg[seg.length - 1];
  if (!first.grip || !last.grip) return NaN;
  const descent = last.y - first.y;
  if (!(descent > 0)) return NaN;
  return (last.y - last.grip.y - (first.y - first.grip.y)) / descent;
}

/**
 * Whether a fall is a carried stick rather than a stroke (#261): a grip was tracked and
 * the stick's OWN swing over the whole fall, `amplitude` deep (the fall so far at a
 * confirmation; at a prediction, the fall the predictor expects, down to its floor), is
 * under `minSwing`. A carried stick swings not at all (the demo take's arm moves) or a
 * little (a stick lowered while carried); a wrist stroke swings its whole amplitude, and
 * an arm carrying the hand on top of a full swing adds depth but takes no swing away, so
 * a stroke stays a stroke however much arm is in it. The swing so far is scaled to the
 * whole fall by its share of the descent ({@link swingShare}): at a prediction only part
 * of the fall has been seen. An absolute swing, not a share: see
 * {@link CARRY_SWING_FRACTION} for how small.
 */
export function isCarried(seg: readonly TrackSample[], { amplitude, minSwing }: { amplitude: number; minSwing: number }): boolean {
  const share = swingShare(seg);
  return Number.isFinite(share) && share * amplitude < minSwing;
}

/** A carried stick's swing, as a fraction of the point's smallest stroke (0.45 reach for
 *  the stick tip): under a quarter, about 6 degrees of the hand. Measured against the
 *  gate itself: the demo take's carries read 0.00 to 0.13 of it (the 0.13 under landmark
 *  noise), its strokes 0.84 to 3.2 (two real strokes under the full gate, at an early
 *  commit under noise), the recorded conducting beats on the stick tip 0.3 to 2.1 (a
 *  conductor's beat is mostly arm, and must stay a beat: `drum_anchor.test.ts`), and
 *  the jittered synthetic strokes 0.7 to 1.8. A quarter is between what a carry reads
 *  and what any stroke reads. */
export const CARRY_SWING_FRACTION = 0.25;

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
  /** The fall as a curve in the frame, latest sample to the depth the fit reaches
   *  (`drum_pads.ts`'s `hitPad` picks a pad along it). */
  path: FallPath;
}

/** The heel's drift is read from the lower part of the fall: the samples within this
 *  fraction of the fall's depth above the latest one (at least the fewest a line needs).
 *  The top of a fall, where the depth has barely started, says little about where the
 *  hand is heading. */
const SHAPE_DEPTH_FRACTION = 0.5;
/** The fewest samples the heel's drift is a line through. */
const SHAPE_MIN_SAMPLES = 2;
/** The stick's reach may vary by this factor (as a log ratio) over the fall and still be
 *  an image-plane swing; beyond it the stick is foreshortening and the arc is not its
 *  path. A 0.7 rad swing in the image plane keeps its reach exactly. */
const REACH_TOLERANCE = Math.log(1.15);

/** The lower part of the fall the shape is read from (at least the last `atLeast`). */
function lowerPart(seg: readonly TrackSample[], last: TrackSample, atLeast: number): TrackSample[] {
  const floor = last.y - SHAPE_DEPTH_FRACTION * (last.y - seg[0].y);
  const from = Math.min(seg.length - atLeast, seg.findIndex((s) => s.y >= floor));
  return seg.slice(Math.max(0, from));
}

/**
 * The fall's shape (#261), x at each depth, free of the fall's timing. A stick tip is one
 * reach from the heel of the hand by construction, so its path is an ARC about the heel:
 * the heel's own drift is a line in the tip's depth over the lower part of the fall, and
 * the tip sits on the circle of the stick's reach about it (`aspect`, the frame's width
 * over its height, makes the display fractions isotropic). Exact for a swung stick,
 * whatever the brake; nothing is fitted that landmark noise could bend. The near-vertical
 * stick (the tip under the heel) is where a depth has no x, and there the tip stays
 * under the heel.
 */
function arcShape(seg: readonly TrackSample[], last: TrackSample, aspect: number): ((y: number) => number) | null {
  if (!last.grip || !seg.every((s) => s.grip)) return null;
  const reachOf = (s: TrackSample) => Math.hypot((s.x - s.grip!.x) * aspect, s.y - s.grip!.y);
  const reach = reachOf(last);
  if (!(reach > 0)) return null;
  const side = Math.sign((last.x - last.grip.x) * aspect) || 1;
  const lower = lowerPart(seg, last, SHAPE_MIN_SAMPLES);
  // A stick turning toward or away from the camera shortens or lengthens in the image:
  // its path is no circle in the frame, and the time line knows better.
  if (lower.some((s) => Math.abs(Math.log(reachOf(s) / reach)) > REACH_TOLERANCE)) return null;
  const ys = lower.map((s) => s.y);
  const heelX = lower.length >= SHAPE_MIN_SAMPLES ? fitLine(ys, lower.map((s) => s.grip!.x * aspect), last.y) : null;
  const heelY = lower.length >= SHAPE_MIN_SAMPLES ? fitLine(ys, lower.map((s) => s.grip!.y), last.y) : null;
  return (y) => {
    const d = y - last.y;
    const hx = heelX ? heelX.a + heelX.b * d : last.grip!.x * aspect;
    const hy = heelY ? heelY.a + heelY.b * d : last.grip!.y;
    const swingY = Math.min(reach, Math.max(-reach, y - hy));
    return (hx + side * Math.sqrt(reach * reach - swingY * swingY)) / aspect;
  };
}

/**
 * The fall's shape for a point with no lever (the wrist, a fingertip), which has no known
 * pivot: x stays the line in time of #245 (the sideways drift), read at the time the fall's
 * depth fit (`fy`, the quadratic in time; a line with two samples) reaches each depth. At
 * the landing point this is exactly #245's x; along the path it is the same curve by depth.
 */
function timeShape(seg: readonly TrackSample[], last: TrackSample, fy: Quadratic | null): (y: number) => number {
  const ts = seg.map((s) => s.t);
  const fx = seg.length >= 2 ? fitLine(ts, seg.map((s) => s.x), last.t) : null;
  if (!fx) return () => last.x;
  const depth = fy ?? (seg.length >= 2 ? fitLine(ts, seg.map((s) => s.y), last.t) : null);
  /** The first time at or after the latest sample the depth fit reaches `y`, or where
   *  it turns if it never does. */
  const tauOf = (y: number): number => {
    if (!depth) return 0;
    const { a, b, c } = depth;
    const d = y - a;
    if (Math.abs(c) < 1e-12) return b > 0 ? Math.max(0, d / b) : 0;
    const disc = b * b + 4 * c * d;
    if (disc < 0) return Math.max(0, -b / (2 * c));
    const r = Math.sqrt(disc);
    const roots = [(-b - r) / (2 * c), (-b + r) / (2 * c)].filter((t) => t >= 0);
    return roots.length ? Math.min(...roots) : 0;
  };
  return (y) => fx.a + fx.b * tauOf(y);
}

export interface LandingOptions {
  /** The learned floor (the impact predictor's plane, display depth): the landing point is
   *  never below it. Default none. */
  floor?: number;
  /** The stroke has already turned (a confirmed or frame-snapped impact): its path ends
   *  where it stopped. Default false. */
  turned?: boolean;
  /** The frame's width over its height, which makes display fractions isotropic for the
   *  stick's arc. Default 1. */
  aspect?: number;
}

/**
 * Where a stroke lands at `t`, and how fast it came down (#245): a quadratic in time
 * through its falling segment ({@link fallingSegment}) gives the depth at `t` (never more
 * than {@link MAX_EXTRAPOLATION} past the last sample), never below the learned `floor`
 * (the impact predictor's plane, where a surface stroke meets it by definition); x is
 * read off the fall's shape at that depth (#261: the arc about the heel for a stick tip,
 * {@link arcShape}; #245's line in time for a point with no lever, {@link timeShape}). The
 * `path` carries the shape from the latest sample on down, past the depth the fit reaches
 * (a pad above the floor is still on the stroke's way), to the frame's bottom, or, once
 * the stroke has `turned`, only to where it stopped. The speed is the fall's mean
 * speed so far, departure to the latest sample, not a fitted derivative extrapolated to
 * the impact: that one is mostly landmark jitter. With a single falling sample, the last
 * sample and no speed.
 */
export function landingAt(samples: readonly TrackSample[], t: number, eps: number, { floor = Infinity, turned = false, aspect = 1 }: LandingOptions = {}): Landing {
  const seg = fallingSegment(samples, t, eps);
  const last = seg[seg.length - 1] ?? samples[samples.length - 1];
  const at = Math.min(t, last.t + MAX_EXTRAPOLATION);
  const tau = at - last.t;
  const ts = seg.map((s) => s.t);
  const fy = seg.length >= 3 ? fitQuadratic(ts, seg.map((s) => s.y), last.t) : null;
  // The depth the fit reaches: at `at` for the landing point; for the path, as far as
  // the fall is heading within MAX_EXTRAPOLATION whatever the predicted time (which
  // aims at a floor learned on another pad). A decelerating fit that turns first has
  // stopped at its vertex.
  const depthBy = (tEnd: number) => {
    if (!fy) return last.y;
    const tv = fy.c < 0 ? -fy.b / (2 * fy.c) : Infinity;
    const te = tv > 0 && tv < tEnd ? tv : tEnd;
    return Math.max(last.y, fy.a + fy.b * te + fy.c * te * te);
  };
  const reach = depthBy(tau);
  const xAt = arcShape(seg, last, aspect) ?? timeShape(seg, last, fy);
  const y = Math.min(reach, Math.max(floor, last.y));
  // How fast the fall came down so far: its mean speed, departure to the latest sample.
  // Not a fitted derivative: differentiating three noisy samples and extrapolating them
  // ahead makes the speed mostly jitter (an adversarial review measured it).
  const span = seg.length >= 2 ? last.t - seg[0].t : 0;
  const speed = span > 0 ? Math.max(0, (last.y - seg[0].y) / span) : 0;
  // The path runs past the fit's horizon: it is consulted only when the landing point is
  // on no pad, and then the pad is wherever the stroke's way meets one (a stroke from a
  // high pad to a low one commits against the high pad's floor, well short of the low
  // pad), so a falling stroke's runs to the frame's bottom. A stroke that turned ends
  // where it stopped (#355): one stopped in the air above a pad does not play it. A
  // predicted stroke cannot be told from one about to stop until it has (both are still
  // falling near a floor learned on another pad); per-pad floors (#353) are its fix.
  const yTo = turned ? Math.max(last.y, y) : FRAME_BOTTOM;
  return { x: xAt(y), y, speed, path: { yFrom: last.y, yTo, xAt } };
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
  /** The impact this stick committed to and the conductor's expected beat nearest it at
   *  the commit (null with no running grid or nothing committed): the confirmation OF
   *  THAT prediction measures the grid's lag (#239). */
  committed: { t: number; grid: number } | null;
  /** The predicted impact this stick last DECIDED on while predicting (sounded, or
   *  skipped as carried or off-pad), or null: a confirmation sounds only when its
   *  prediction was not decided, so a standing that changes mid-stroke (#318) neither
   *  loses the stroke nor plays it twice. */
  handled: number | null;
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
    const strike = (c: Params, st: StickTick, landing: Landing, strength: number): Strike => {
      const speed = landing.speed;
      const padHit = anyPadOn(c.pads) ? hitPad(c.pads, landing, c.offPad, landing.path) : null;
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
    const onSnapped = (f: FrameTick, st: StickTick, e: ImpactConfirmation, decided: boolean) => {
      const { c, ctx } = f;
      const { stick } = st;
      stick.committed = null;
      stick.handled = null;
      if (decided) return;
      // The frame-snapped onset (#318): the deepest sample's own time, sounded
      // now. A full hit, not a ghost: every stroke is reactive here, and it is the
      // stamps, not the stroke, that ruled prediction out. No magnet outcome: the
      // magnet can pull nothing it was never offered, and the status says why.
      if (carried(st, e.t, NaN)) return;
      const snappedT = deepestSampleTime(stick.recent, e.t);
      const s = strike(c, st, landingAt(stick.recent, snappedT, st.gates.minAmplitude * FALL_JITTER, { turned: true, aspect: f.aspect }), e.strength);
      if (s.silent) return;
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
    };

    /** A predicted impact: sounded ahead of the frame that shows it, pulled toward the
     *  pattern's grid or by the magnet. */
    const onPredict = (f: FrameTick, st: StickTick, e: ImpactPrediction) => {
      const { c, ctx, time, engaged, gate } = f;
      const { stick, predictor } = st;
      // The grid this stroke is committed against, before anything can skip it:
      // its confirmation measures the grid's lag (rule a), whether or not the
      // magnet is on, so the gate is warm when the player turns it up.
      stick.committed = f.running ? { t: e.t, grid: nearestExpectedBeat(time!, e.t) } : null;
      stick.handled = e.t;
      if (carried(st, e.t, predictor.level())) return;
      const s = strike(c, st, landingAt(stick.recent, e.t, st.gates.minAmplitude * FALL_JITTER, { floor: predictor.level(), aspect: f.aspect }), e.strength);
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
    const onGhost = (f: FrameTick, st: StickTick, e: ImpactConfirmation) => {
      const { c, ctx } = f;
      const { stick } = st;
      stick.committed = null;
      stick.handled = null;
      if (carried(st, e.t, NaN)) return;
      const s = strike(c, st, landingAt(stick.recent, e.t, st.gates.minAmplitude * FALL_JITTER, { turned: true, aspect: f.aspect }), e.strength);
      if (s.silent) return;
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
      if (f.subframe === 'off-stamps') onSnapped(f, st, e, decided);
      else if (decided) onConfirm(st.stick, e);
      else onGhost(f, st, e);
    };

    /** Play one fresh frame: every stick the config names takes its sample and its events. */
    const playFrame = (tick: DrumTick, frame: HandsFrame, live: Record<PlayerHand, Stick>) => {
      const f = frameTick(tick, frame);
      const hands: PlayerHand[] = f.c.hand === 'both' ? ['right', 'left'] : [f.c.hand];
      for (const which of hands) {
        const st = trackStick(f, frame, which, live[which]);
        if (!st) continue;
        const { predictor, anchor } = st;
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
