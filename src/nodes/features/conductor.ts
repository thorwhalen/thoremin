/**
 * `conductor` node — the conductor's beating hand, or body, becomes musical time (#187, #375).
 *
 * Wraps `packages/ictus/src` (the pure core: ictus detector → rhythm prior →
 * `MusicalTime`) as a DAG node over the hands frame the rest of the graph already
 * reads, and emits what the score player needs: a continuous `beat`, the `bpm` it is
 * advancing at, and a `velocityScale` from the size of the strokes — the two ports
 * `score` consumes — plus the whole `MusicalTime` on `time` for the overlay, the
 * scheduler (PR 4) and the pacer (#186).
 *
 * Why the beat is integrated HERE and not by `transport`. The research map (§6.3, §7.2)
 * settled two things: the score must read ONE beat from ONE node (the engine rejects
 * fan-in), and a follower needs a beat-agnostic fallback because non-experts' beats
 * are often not synchronous with anything (You're the Conductor's finding). So this
 * node owns a running `beatOut` and advances it every tick at a tempo blended, by the
 * oscillator's confidence, between the inferred tempo and a speed-based fallback (hand
 * speed relative to the player's own recent speed → bpm, what `performance` computes
 * from height), and — while confident — converges its phase onto the inferred beat
 * through a servo with an explicit horizon (`servoBeats`, Personal Orchestra's Δt): the
 * score does not jump to the ictus, it catches up over about a beat, which is what
 * filters a novice's jitter without making the orchestra feel deaf. Two rules keep
 * that honest: the beat never goes backwards (a late ictus is absorbed by slowing,
 * never by rewinding, because a rewind across a note's onset would retrigger it), and
 * nothing plays until the follower has seen a first stroke (every shipped system gates
 * the start on a preparatory gesture, §6.3): enabling the dial with no hand in frame
 * starts nothing. In `hold` (the conductor stopped, a fermata, a lost hand) the beat
 * freezes: `bpm` reads 0 and the score sustains whatever is sounding. Disabling resets
 * the beat to 0, so re-enabling starts the piece from the top on a clean downbeat.
 *
 * The score (PR 3/4): the loaded `ScoreDoc` on the `doc` input supplies the meter
 * (beats per bar from its time signature, so `beatInBar` counts the way the piece is
 * written) and its **fermatas**: when the beat would cross a fermata, it stops exactly
 * there and holds — `bpm` 0, the note sustains, the HUD says "holding" — until the
 * conductor's next stroke, the preparatory beat that releases a fermata in every
 * shipped system (§6.3). Without a document the dial's `beatsPerBar` is used and there
 * are no fermatas.
 *
 * The body (#375, body-movement A3). With `source` = `body` the anchors come from the pose
 * stream on the `body` input instead of the hands: the body's impact detector (A2,
 * `createImpactDetector`) over the channels `conductor_body.ts` builds (the beating arm
 * and the trunk centroid by default, or one point: wrist, head, hips, com), behind the
 * same `AnchorDetector` seam, so the prior, the integrated beat, the servo, the fermatas,
 * the score, the orchestra and `recordingTime` are the hand conductor's, unchanged. The
 * speed fallback reads the body's quantity of motion where the hand reads its point's
 * speed. Which law follows is the conductor's (strict); which level the body marks is
 * the beat by default (`markLevel`, below): the follower starts at the score's marked
 * tempo at that level where a score is loaded (A2's note 5 on #386), though the priors
 * re-estimate from the first stroke interval. The pose branch is composed only while
 * the source is `body` (`src/instruments/derive.ts`).
 *
 * The level (#376, body-movement A4). A stroke need not be a beat: a body conductor may
 * bounce every other beat, a player may mark only the bars. `markLevel` says which, as
 * the piece's beats per mark `k`: `beat` (1, the default, strict like the hand), `half`
 * (2), `bar` (the meter's beats per bar at the position) or `auto`, ictus's level
 * relation (`relateLevel`, the conductor's ratio set {1/2, 1, 2, beats per bar}) against
 * the score's marked tempo at the position: the beat, kept while the strokes' tempo is
 * within 50 % of the marked one (a slow beat is not a fast half-time), and another ratio
 * followed only once it has persisted 3 s (the red-noise guard of #339); a level held
 * survives a change of source or side. `k` is applied at the
 * one seam between the follower's state and the integrated beat: the tempo is `k` times
 * the strokes' and the phase servo lands a stroke on a multiple of `k` beats (counted
 * from the current time signature's start), so the score, the orchestra and
 * `recordingTime` all inherit it. Leading a recording, `auto` has no marked tempo to
 * relate to and stays at the beat: the song's pace controller relates the conducted beat
 * to the song's tracked one ({1/2, 1, 2}, the servo's level). The `level` output is `k`.
 *
 * A dancer (#380, body-movement A8, "Dance the orchestra"). With `source` = `dancer` the
 * beat is not integrated from strokes at all: ictus's dance lead (`createDanceLead`)
 * owns it, fed the dancer's `PulseState` on the `pulse` input (`body-pulse`, composed
 * with the body source while the source is `dancer`). Its law is the dancer's loose one,
 * not a conductor's: the dancer's cycle is related to the score's MARKED tempo at the
 * position by ictus's level relation over the dancer's integer ratios (a stride that
 * repeats once a bar is four beats in 4/4), the piece starts on the dancer's next cycle
 * once that relation has persisted, the tempo follows inside `dancer.range` of the marked
 * one, the cycle start is kept on the grid modulo the ratio (so bars stay on the dancer's
 * cycles), and an untrusted pulse HOLDS the tempo: the piece never stops because the
 * dancer paused. No transport rules; a written fermata holds for one dancer cycle (a dancer
 * has no release gesture, and one cycle keeps the bars on the dancer), and past its end the
 * piece loops to the top on a cycle start while the dancer is followed, else ends (#463);
 * `markLevel` unused (the relation finds the level). Expression `same` is the body's
 * motion and reach, read once per pulse cycle, its articulation the body's flow (a fitted
 * cycle has no braking sharpness). The `dance` output is the lead's mode. One leader per
 * consumer (#387 B2): this dial picks the score's; a dancer "conducting the recording" is
 * the song's pace law on the pulse (the derivation's `songDanced`), so `recordingTime`
 * stays empty.
 *
 * The dial. {@link ConductorDialSchema} IS this node's params (the `faceControls`
 * pattern): the `conductor` dial re-exports it, the `config` input overrides the
 * build-time params live per tick, and `commands/paths.ts` derives a `dial.setIn`
 * leaf for every field here, so the panel, the palette, a keybinding and the AI
 * assistant can all turn the conductor on or retune it with no graph rebuild. Three
 * fields are build-time only because they shape the prior itself: `prior` (which
 * rhythm prior follows the beat, #232: the `blend` by default, the oscillator while
 * the beat holds its tempo and the trend prior once the oscillator's grid is biased,
 * which is what keeps the grid from running 65 to 75 ms late under an accelerando;
 * `oscillator` is the pre-#232 follower, `trend` the tempo trend alone) and the
 * oscillator's gains (`phaseGain`, `periodGain`); a live change to them takes effect
 * at the next enable (the node re-creates its core when it is switched off and on).
 *
 * Expression (#378, body-movement A6). `dynamics` and `articulation` (hence
 * `velocityScale`, the orchestra's CC11/CC74, and its note lengths) come from the beat's
 * own source by default (`expression: same`), or from the other one: `hands` lets a hand
 * keep the dynamics while the body beats (a bounce of the trunk with a hand shaping, the
 * conducting literature's split role), `body` the reverse. The other source gets a
 * follower of its own whose strokes only shape (its tempo goes nowhere; until it shows a
 * stroke, the beat's own expression stands); while an arm beats on a named side, the
 * OTHER hand shapes. Reading the body, the strokes' excursion is blended with the body's
 * quantity of motion and the beating arm's extension, each read against the player's
 * own last 20 s and once per stroke (ictus `createExpressionBlend`); articulation is the
 * strokes' braking sharpness, or Laban flow (the beating wrist's jerk) with
 * `articulationFrom: flow`.
 *
 * The shaping hand's gesture (#457). `expressionHand` names the hand that shapes (`auto`:
 * the free hand while an arm beats on a named side); naming the hand a hand conductor
 * does not beat with splits the role with the hands alone. While the shaping hand makes
 * no stroke (two strokes in a row, each within `handGesture.quietS`, are stroking; a
 * stroke is at least `minStroke` frame heights, so a still hand's tremor is none), its
 * height and its palm say the loudness, continuously (ictus `createHandGesture`,
 * `conductor_gesture.ts`; each channel's range is learned while the hand MOVES, so a
 * posture held up stays loud, and a channel that never moved says nothing); its strokes'
 * articulation, or the beat's, stands. A change between the two readings crossfades over
 * `handGesture.fadeS`. The split with the hands alone reads two hands at once, which the
 * host's hand count is told (`conductorReadsTwoHands`).
 *
 * Pure and Node-safe: no DOM, no clock (it reads `ctx.time` / `ctx.dt`), and the
 * recorded conducting fixtures drive it headlessly.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { beatAt, conductorRatios, createDanceLead, createExpressionBlend, createHandGesture, createIctus, createImpactDetector, createLeadCorrector, createLevelHold, createTransport, wrapPhase, ARTICULATION_SOURCES, DANCE_LEAD_DEFAULTS, DEFAULT_RHYTHM_PRIOR, HAND_GESTURE_DEFAULTS, RHYTHM_PRIOR_KINDS, TRANSPORT_DEFAULTS, UNKNOWN_PULSE, type Anchor, type DanceLead, type DynamicsEstimate, type ExpressionBlend, type HandGesture, type Ictus, type IctusState, type LeadOffsets, type LevelHold, type MusicalTime, type PulseState, type Transport, type TransportPhase, type TransportPose } from '@thoremin/ictus';
import { LM, type BodyFrame, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { captureTime } from '@thoremin/sdk/timing/tracker';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { handGestureFrame } from './conductor_gesture';
import { bodyChannelFrame, bodyQuantityOfMotion, conductorBodyJoints, createBodyExpressionMeter, createBodyMotionMeter, CONDUCTOR_BODY_POINTS, type BodyExpressionMeter, type BodyMotionMeter } from './conductor_body';
import { barStartAt, beatsPerBarAt, timeSignatureAt } from '@thoremin/sdk/score/schema';
import { readScoreDoc } from '@thoremin/sdk/score/prepare';
import { clamp01 } from '@thoremin/sdk/features/math';

export const CONDUCTOR_HANDS = ['auto', 'right', 'left'] as const;
export type ConductorHand = (typeof CONDUCTOR_HANDS)[number];
export const CONDUCTOR_POINTS = ['wrist', 'indexTip'] as const;
export type ConductorPoint = (typeof CONDUCTOR_POINTS)[number];
/** What the conductor leads (#187 PR 7): the score (and the orchestra), or the song
 *  loaded in the Song tool ("Conduct a recording"). */
export const CONDUCTOR_TARGETS = ['score', 'recording'] as const;
export type ConductorTarget = (typeof CONDUCTOR_TARGETS)[number];
/** Who leads (#375, #380): the beating hand (the hand model), the body conducting (the pose
 *  model, a second camera branch the derivation composes while this is `body`), or a
 *  DANCER (the same pose branch, read as the dancer's pulse by the dancer's loose law). */
export const CONDUCTOR_SOURCES = ['hands', 'body', 'dancer'] as const;
export type ConductorSource = (typeof CONDUCTOR_SOURCES)[number];
export { CONDUCTOR_BODY_POINTS, type ConductorBodyPoint } from './conductor_body';
/** Which level a stroke marks (#376): every beat, every other beat, every bar, or found
 *  by relating the strokes to the score's marked tempo. */
export const CONDUCTOR_MARK_LEVELS = ['beat', 'half', 'bar', 'auto'] as const;
export type ConductorMarkLevel = (typeof CONDUCTOR_MARK_LEVELS)[number];
/** Where the dynamics and the articulation come from (#378): the same source as the beat
 *  (the default), or the other one (the split role: the body beats, a hand shapes). */
export const CONDUCTOR_EXPRESSION_SOURCES = ['same', 'hands', 'body'] as const;
export type ConductorExpressionSource = (typeof CONDUCTOR_EXPRESSION_SOURCES)[number];
export { ARTICULATION_SOURCES, type ArticulationSource } from '@thoremin/ictus';
/** `markLevel: auto`: how far (a fraction, in log terms) the player's tempo may be from
 *  the marked tempo at the level followed before another level is tried, and how long a
 *  different level must persist before it is followed. */
export const MARK_LEVEL_CAPTURE = 0.5;
export const MARK_LEVEL_PERSIST_S = 3;

/** The body's transport rules (#377, body-movement A5; see the header and
 *  `packages/ictus/src/transport.ts`). Heights are on the torso (0 at the hips, 1 at the
 *  shoulders); motion is in noise units (the arms' displacement over the tracker's own
 *  jitter: a still body reads about 1); durations are in stroke periods, the ready pose's
 *  in seconds (no period is known before the start). */
export const ConductorTransportSchema = z.object({
  /** Reading the body with an arm (`bodyPoint` impact or wrist), start, hold and stop
   *  follow the pose (on), or the hand's transport (off: the first stroke starts, the
   *  prior's own hold, no stop). A bounce point (head, hips, com) always has the latter. */
  rules: z.boolean().default(true),
  /** The beating arm counts as raised (ready, holding) above this height. */
  raisedAbove: z.number().min(-0.5).max(1.5).default(TRANSPORT_DEFAULTS.raisedAbove),
  /** The arm counts as dropped (a cut-off) below this height. */
  droppedBelow: z.number().min(-0.5).max(1.5).default(TRANSPORT_DEFAULTS.droppedBelow),
  /** Still below this motion, noise units. */
  stillBelow: z.number().min(1).max(50).default(TRANSPORT_DEFAULTS.stillBelow),
  /** The upbeat after the ready pose: motion above this, noise units. */
  moveAbove: z.number().min(1).max(100).default(TRANSPORT_DEFAULTS.moveAbove),
  /** The ready pose (raised and still) must last this long, seconds. */
  readyS: z.number().min(0).max(5).default(TRANSPORT_DEFAULTS.readyS),
  /** No stroke for this many stroke periods, raised and still: hold (a fermata). */
  holdAfterPeriods: z.number().min(0.5).max(8).default(TRANSPORT_DEFAULTS.holdAfterPeriods),
  /** Dropped and still for this many stroke periods: stop (a cut-off). */
  stopAfterPeriods: z.number().min(0.25).max(8).default(TRANSPORT_DEFAULTS.stopAfterPeriods),
});
export type ConductorTransport = z.infer<typeof ConductorTransportSchema>;

/** The dancer leading the score (#380, body-movement A8; ictus `createDanceLead`). */
export const ConductorDancerSchema = z.object({
  /** The score's tempo stays within this fraction of its marked tempo (0.1 = +-10 %). */
  range: z.number().min(0.02).max(0.3).default(DANCE_LEAD_DEFAULTS.range),
  /** Where the dancer's cycle start lands, in beats after a bar's (or the cycle's) start. */
  phaseOffset: z.number().min(-4).max(4).default(DANCE_LEAD_DEFAULTS.phaseOffset),
  /** The marked tempo, bpm, where the piece marks none (the built-in demo scale). */
  bpm: z.number().min(30).max(240).default(120),
});
export type ConductorDancer = z.infer<typeof ConductorDancerSchema>;
export const DEFAULT_CONDUCTOR_DANCER: ConductorDancer = ConductorDancerSchema.parse({});

/** The shaping hand's gesture (#457; ictus `createHandGesture`): while the hand that shapes
 *  the dynamics makes no stroke, how high it is held and which way its palm faces say the
 *  loudness, each against the player's own last 20 s. */
export const ConductorHandGestureSchema = z.object({
  /** The share of the hand's height (on the torso when the body is seen). */
  height: z.number().min(0).max(1).default(HAND_GESTURE_DEFAULTS.weights.height),
  /** The share of the palm's direction (up to rise, down to hush). */
  palm: z.number().min(0).max(1).default(HAND_GESTURE_DEFAULTS.weights.palm),
  /** The hand counts as stroking (its strokes shape, as before) until it has made no
   *  stroke for this many seconds. */
  quietS: z.number().min(0.25).max(10).default(2),
  /** The smallest stroke of the shaping hand, in frame heights: below it a movement is
   *  the hand's tremor or a slow lift, not a stroke. */
  minStroke: z.number().min(0).max(0.2).default(0.02),
  /** A change between the strokes' reading and the gesture's (the hand starts or stops
   *  stroking, its gesture is first taught) crossfades over this many seconds. */
  fadeS: z.number().min(0).max(3).default(0.5),
});
export type ConductorHandGesture = z.infer<typeof ConductorHandGestureSchema>;
export const DEFAULT_CONDUCTOR_HAND_GESTURE: ConductorHandGesture = ConductorHandGestureSchema.parse({});
export const DEFAULT_CONDUCTOR_TRANSPORT: ConductorTransport = ConductorTransportSchema.parse({});
/** What the `transport` output reads: the body transport's phase, `stopped` on the frame a
 *  cut-off lands, or `off` (reading the hands, or the rules off). */
export type ConductorTransportReading = TransportPhase | 'stopped' | 'off';

const Params = z.object({
  /** Off by default: conducting replaces the score's fixed tempo, and a player who
   *  never opens the Conductor panel should never have the score play. */
  enabled: z.boolean().default(false),
  /** What the beat leads: the score (and the orchestra), or the loaded recording, whose
   *  tempo then follows the beat through the song's pacer (#187 PR 7). While it leads the
   *  recording the score and the orchestra stay silent. */
  conducts: z.enum(CONDUCTOR_TARGETS).default('score'),
  /** Who leads (#375, #380; #387 B2: one leader per instrument, by this dial): the hand
   *  (the hand model's wrist or fingertip), the body conducting (the pose model: an arm,
   *  the trunk, the head, the hips), or a `dancer` (the dancer's pulse, by the loose law
   *  of `dancer`). Everything after the beat (the score, the orchestra) is the same; a
   *  dancer "conducting the recording" is the song following the dancer (the pace law). */
  source: z.enum(CONDUCTOR_SOURCES).default('hands'),
  /** Which of the player's hands (or, reading the body, arms) beats time. `auto` takes
   *  whichever hand is in frame, preferring the right; reading the body, whichever arm
   *  shows a rhythm. */
  hand: z.enum(CONDUCTOR_HANDS).default('auto'),
  /** The tracked point: the wrist (steady) or the index fingertip (livelier, like a
   *  baton tip). Reading the hands only. */
  point: z.enum(CONDUCTOR_POINTS).default('wrist'),
  /** What the body conductor follows (#375): `impact`, the multi-joint detector over the
   *  beating arm and the trunk (A1's measured set: the arm while it beats, the trunk's
   *  bounce otherwise), or one point: the beating `wrist`, the `head`, the `hips`
   *  (bounce) or the trunk centroid `com`. Reading the body only. */
  bodyPoint: z.enum(CONDUCTOR_BODY_POINTS).default('impact'),
  /** Selfie mirror: the webcam view is mirrored, so lateral direction is flipped to the
   *  player's frame. Off for a recorded third-person video. */
  mirrorX: z.boolean().default(true),
  /** The mirrored webcam reports the opposite hand label (the same knob `hand-features`
   *  carries). Off for a recorded third-person video. */
  mirrorHandedness: z.boolean().default(true),
  /** Which level a stroke marks (#376): `beat` (default), `half` (every other beat),
   *  `bar`, or `auto` (related to the score's marked tempo, held once chosen). */
  markLevel: z.enum(CONDUCTOR_MARK_LEVELS).default('beat'),
  /** Where the dynamics and the articulation come from (#378): `same` as the beat (the
   *  default), `hands` (a hand shapes while the body beats) or `body` (the body shapes:
   *  its strokes blended with its motion and its arm's reach, per player). */
  expression: z.enum(CONDUCTOR_EXPRESSION_SOURCES).default('same'),
  /** Which hand shapes while the hands shape the dynamics (#457): `auto` (the other hand
   *  while an arm beats on a named side, else the conductor's hand) or a named one. Naming
   *  the hand that does not beat (the left, while the right beats) is the classic split
   *  with the hands alone. */
  expressionHand: z.enum(CONDUCTOR_HANDS).default('auto'),
  /** The shaping hand's gesture, read while it is not stroking (#457). */
  handGesture: ConductorHandGestureSchema.default(() => ({ ...DEFAULT_CONDUCTOR_HAND_GESTURE })),
  /** Reading the body's expression: articulation from each stroke's braking `sharpness`
   *  (the default, as for the hand), or from Laban `flow` (the beating wrist's jerk). */
  articulationFrom: z.enum(ARTICULATION_SOURCES).default('sharpness'),
  /** Reading the body: start, hold and stop from the pose (#377). */
  transport: ConductorTransportSchema.default(() => ({ ...DEFAULT_CONDUCTOR_TRANSPORT })),
  /** A dancer leading the score (#380): the clamp, the phase offset, the tempo a piece
   *  that marks none is played at. */
  dancer: ConductorDancerSchema.default(() => ({ ...DEFAULT_CONDUCTOR_DANCER })),
  /** Beats per bar, for `beatInBar` (the meter recogniser is a later PR). */
  beatsPerBar: z.number().int().min(1).max(12).default(4),
  /** The phase servo's convergence horizon in beats: how long the score takes to catch
   *  up with an ictus that arrived early or late. Small = tight (for a conductor),
   *  large = forgiving (for a novice; filters jitter). */
  servoBeats: z.number().min(0.25).max(4).default(1),
  /** Below this oscillator confidence the tempo blends toward the speed-based
   *  fallback (0 = never fall back, 1 = always). */
  fallbackBelowConfidence: z.number().min(0).max(1).default(0.3),
  /** The speed-based fallback's tempo range (hand nearly still → min, at the player's
   *  own peak speed → max). */
  fallbackBpmMin: z.number().min(20).max(300).default(50),
  fallbackBpmMax: z.number().min(20).max(300).default(160),
  /** Stroke size → `velocityScale` range: the smallest strokes play at `dynMin`, the
   *  biggest at `dynMax`. */
  dynMin: z.number().min(0).max(1).default(0.35),
  dynMax: z.number().min(0).max(1).default(1),
  /** Which rhythm prior follows the beat (build-time; see the header). */
  prior: z.enum(RHYTHM_PRIOR_KINDS).default(DEFAULT_RHYTHM_PRIOR),
  /** Oscillator gains (build-time; see the header). */
  phaseGain: z.number().min(0).max(1).default(0.5),
  periodGain: z.number().min(0).max(1).default(0.4),
});
type Params = z.infer<typeof Params>;

/** The node's params, re-exported as the SSOT for the `conductor` dial. */
export const ConductorDialSchema = Params;
export type ConductorDialParams = Params;
/** The shipped defaults, as a plain value — the dial/store/schema default. */
export const DEFAULT_CONDUCTOR_DIAL: ConductorDialParams = ConductorDialSchema.parse({});

/** Runtime shape of the `time` port (`PortSpec.schema`): a follower that emits nothing
 *  would otherwise be a silent score rather than an error. Mirrors `MusicalTime`. */
/** A number that may be `Infinity` (`z.number()` is finite-only): the period while
 *  idle and the next-beat time while holding are genuinely infinite. */
const numberOrInfinity = z.custom<number>((v) => typeof v === 'number' && !Number.isNaN(v), 'expected a number or Infinity');

export const MusicalTimeSchema = z.object({
  t: z.number(),
  beat: z.number(),
  phase: z.number(),
  tempo: z.number(),
  period: numberOrInfinity,
  confidence: z.number(),
  nextBeatAt: numberOrInfinity,
  beatsPerBar: z.number(),
  beatInBar: z.number(),
  state: z.enum(['ready', 'running', 'hold']),
  anchors: z.number(),
  lastAnchorAt: z.number().optional(),
  leadOffset: z.number().optional(),
});

/** The live `config` port: a partial override of the params (the dial's value). */
const ConfigOverride = Params.partial();

/** Whether the conductor reads two hands at once (#457): a hand conductor whose named
 *  shaping hand is not the beating one. The host counts it in the hand model's hands. */
export function conductorReadsTwoHands(c: Partial<Params> | undefined): boolean {
  if (!c || c.enabled !== true || (c.source ?? 'hands') !== 'hands') return false;
  const shaping = c.expressionHand ?? 'auto';
  const beating = (c.hand ?? 'auto') === 'auto' ? 'right' : c.hand;
  const handsShape = (c.expression ?? 'same') !== 'body';
  return handsShape && shaping !== 'auto' && shaping !== beating;
}

/** MediaPipe's label for the player's hand, given the mirror convention. */
function labelFor(hand: Exclude<ConductorHand, 'auto'>, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}

/** The hand that shapes the expression (#378): the one `expressionHand` names (#457);
 *  with `auto`, while an ARM of the body beats on a named side, the other hand (the
 *  conducting literature's expressive hand), otherwise the conductor's hand choice. */
function shapingHand(frame: HandsFrame, cfg: Params): Hand | undefined {
  if (cfg.expressionHand !== 'auto') {
    const label = labelFor(cfg.expressionHand, cfg.mirrorHandedness);
    return frame.hands.find((h) => h.handedness === label);
  }
  if (cfg.source === 'body' && (cfg.bodyPoint === 'impact' || cfg.bodyPoint === 'wrist') && cfg.hand !== 'auto') {
    const label = labelFor(cfg.hand === 'right' ? 'left' : 'right', cfg.mirrorHandedness);
    return frame.hands.find((h) => h.handedness === label);
  }
  return pickHand(frame, cfg);
}

function pickHand(frame: HandsFrame, cfg: Params): Hand | undefined {
  if (!frame.hands.length) return undefined;
  if (cfg.hand === 'auto') {
    const preferred = labelFor('right', cfg.mirrorHandedness);
    return frame.hands.find((h) => h.handedness === preferred) ?? frame.hands[0];
  }
  const label = labelFor(cfg.hand, cfg.mirrorHandedness);
  return frame.hands.find((h) => h.handedness === label);
}

/** The release of a fermata is a stroke at least this many periods after it was reached. */
const FERMATA_RELEASE_PERIODS = 0.5;

/** The body's start (#377): the tempo before the second stroke when the score marks none
 *  (the priors' initial tempo), and how far short of a whole beat the start waits. */
const START_BPM = 100;
const START_EPS = 1e-3;

/** The body points the transport rules read (#377): those an ARM beats. A player who
 *  bounces (the trunk, the hips, the head) may hang the arms still, which is the cut-off
 *  pose, so those points keep the hand's transport (the first stroke starts). */
const TRANSPORT_POINTS: ReadonlySet<string> = new Set(['impact', 'wrist']);

/** The transport phases in which the score sounds (#377). */
/** What one tick's output is built from (`emit`): the time, the tempo it advanced at, the
 *  expression, and the few facts that decide `leadsScore` / `recordingTime` / `level`. */
interface EmitArgs {
  time: MusicalTime;
  bpm: number;
  dynamics: number;
  articulation: number;
  enabled: boolean;
  c: Params;
  /** The piece's beats per stroke (a dancer's: its cycle ratio). */
  level?: number;
  /** False before a dancer's piece has started: the score stays silent. */
  sounding?: boolean;
}

/** What feeding the follower one tick produced: its state, and what the body's transport
 *  called (a cut-off, a start, the release of a hold). */
interface Fed {
  s: IctusState;
  stopped: boolean;
  started: boolean;
  released: boolean;
}

/** The beat a stroke lands on at or near `b`, given a rounding (`placeStart`, `runBeat`). */
type Grid = (b: number, snap: (x: number) => number) => number;

const TRANSPORT_SOUNDING: ReadonlySet<TransportPhase> = new Set(['running', 'holding']);

/**
 * The body conductor's per-player lead offsets (#427): per joint (the impact detector's
 * channel: `wrist`, `trunk`, `elbow`, ...), the seconds that joint's anchors land after
 * the beat the player means, learned against a click (`createLeadCalibration`) and kept
 * per device, never with an instrument (the lag is the player's body, not a sound). An
 * offset is bounded to half a second either way; anything else on the port is no offset.
 */
export const LeadOffsetsSchema = z.record(z.string(), z.number().finite().min(-0.5).max(0.5));

/** The `leadOffsets` input as {@link LeadOffsets}: the valid entries only. */
export function readLeadOffsets(raw: unknown): LeadOffsets | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 0.5) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** The `transportPose` input as a {@link TransportPose}: booleans only, anything else unstated. */
function readTransportPose(raw: unknown): TransportPose | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const pose: TransportPose = {};
  for (const k of ['ready', 'hold', 'cutoff'] as const) if (typeof r[k] === 'boolean') pose[k] = r[k] as boolean;
  return pose;
}

/** The score's first marked tempo (bpm), if it marks one. */
export function firstTempo(doc: ScoreDoc): number | null {
  let first: { beat: number; bpm: number } | null = null;
  for (const m of doc.tempoMap) if (!first || m.beat < first.beat) first = m;
  return first ? first.bpm : null;
}

/** The score's marked tempo (bpm) at a beat: the last mark at or before it, else the
 *  first. Null when it marks none. */
function tempoAt(doc: ScoreDoc, beat: number): number | null {
  let at: { beat: number; bpm: number } | null = null;
  let first: { beat: number; bpm: number } | null = null;
  for (const m of doc.tempoMap) {
    if (!first || m.beat < first.beat) first = m;
    if (m.beat <= beat && (!at || m.beat >= at.beat)) at = m;
  }
  return (at ?? first)?.bpm ?? null;
}

/** Two samples closer than this (seconds) are not two camera frames: a stamp-source
 *  switch (a clock stamp followed by an estimated one, pushed forward to stay
 *  increasing) can put them a millisecond apart, and a backward difference over that
 *  would latch the speed fallback. No camera this app meets exceeds 240 fps. */
const MIN_SAMPLE_SPACING = 0.004;

/** Whether a frame is a new observation: the same object again, or a distinct copy
 *  carrying the same stamp (a replayed recording stores every tick, so a camera frame
 *  comes back as two parsed copies), is not. */
const isFresh = (f: { t?: number } | undefined, prev: { t?: number } | undefined): boolean =>
  f !== prev && !(!!f && !!prev && f.t !== undefined && f.t === prev.t);

/** The tracked point of a hand, in frame heights (the hand detector's unit). */
function handPoint(hand: Hand, frame: HandsFrame, c: Params, t: number): { t: number; x: number; y: number } {
  const kp = hand.keypoints[c.point === 'wrist' ? LM.wrist : LM.index_tip];
  return { t, x: kp.x / frame.height, y: kp.y / frame.height };
}

export const conductorNode = defineNode<Params>({
  type: 'conductor',
  roles: ['feature', 'mapping'],
  title: 'Conductor',
  description:
    'The beating hand (or, with source = body, the body) becomes musical time: ictus detection + a rhythm prior (packages/ictus/src; the oscillator-trend blend by default) → beat, bpm, dynamics for the score. Off by default.',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    // The pose stream (#375): read while `source` is `body`; composed (the body source
    // branch) only then, so an unconnected port is the hand conductor's normal case.
    { name: 'body', kind: 'body-frame' },
    { name: 'config', kind: 'conductor-config' },
    // The loaded piece (#187 PR 3/4): its time signature and fermatas. Optional.
    { name: 'doc', kind: 'score-doc' },
    // The override seam of the body's transport (#377; B4 later): a pose category stating
    // `ready` / `hold` / `cutoff` replaces that rule's geometry. Unconnected = the rules.
    { name: 'transportPose', kind: 'transport-pose' },
    // The dancer's pulse (#380): read while `source` is `dancer`; composed (the body source
    // branch's `body-pulse`) only then.
    { name: 'pulse', kind: 'pulse-state' },
    // The player's lead offsets per joint (#427), a per-device pref: subtracted from the
    // body detector's anchors by the joint each came from. Unconnected = none.
    { name: 'leadOffsets', kind: 'lead-offsets' },
  ],
  outputs: [
    { name: 'time', kind: 'musical-time', schema: MusicalTimeSchema },
    { name: 'beat', kind: 'number', schema: z.number() },
    { name: 'bpm', kind: 'number', schema: z.number() },
    { name: 'velocityScale', kind: 'number', schema: z.number() },
    { name: 'phase', kind: 'number' },
    { name: 'dynamics', kind: 'number' },
    { name: 'articulation', kind: 'number' },
    { name: 'confidence', kind: 'number' },
    { name: 'enabled', kind: 'boolean' },
    { name: 'leadsScore', kind: 'boolean', description: 'Conducting the score (enabled, and not leading a recording): what the score and the orchestra play on' },
    { name: 'recordingTime', kind: 'musical-time', description: "`time`, only while the conductor leads the recording (#187 PR 7): the song's pace controller follows it" },
    { name: 'level', kind: 'number', description: "The piece's beats per stroke (#376): 1 marking beats, 2 every other beat, the bar's beats marking bars" },
    { name: 'transport', kind: 'transport-phase', description: "The body's transport (#377): idle, armed, prepared, running, holding, stopped on a cut-off's frame, or off (reading the hands, or the rules off)" },
    { name: 'dance', kind: 'dance-mode', description: 'A dancer leading (#380): waiting, locking, armed, following, switching or holding (absent otherwise)' },
  ],
  params: Params,
  make(p) {
    let ictus: Ictus | null = null;
    let lastConfigRef: unknown = undefined;
    let cfg: Params = p;
    /** The beat the score reads: integrated here, phase-servoed onto the ictus. */
    let beatOut = 0;
    let wasEnabled = false;
    // The document's fermatas (sorted beats) and meter, re-read when the doc object changes.
    let docRef: unknown = null;
    let fermatas: number[] = [];
    let docMeter: ((beat: number) => number) | null = null;
    /** The document's marked tempo at a beat, and where the time signature in force at a
     *  beat starts (the reference a bar or half-bar mark is counted from). */
    let docTempo: ((beat: number) => number | null) | null = null;
    let docSigStart: ((beat: number) => number) | null = null;
    /** Where the bar line in force at a beat sits (the signature's start, or the pickup's
     *  virtual bar start, #438): what `beatInBar` and the bar-level strokes count from. */
    let docBarStart: ((beat: number) => number) | null = null;
    /** `markLevel: auto`: the level held (its ratio set has this beats-per-bar). */
    let levelHold: LevelHold | null = null;
    let levelBpb = 0;
    /** The document's first tempo mark (bpm), seeding the body detector's period. */
    let docBpm: number | null = null;
    /** Fermata hold: the beat we stopped at, and the anchor count when we stopped (a
     *  NEW stroke — one more anchor — releases it). */
    let fermataAt: number | null = null;
    let fermataAnchors = 0;
    /** When the fermata was reached, and the stroke period then: the release is a stroke
     *  whose own time is at least half a period later. The stroke that LANDS on the fermata
     *  is often confirmed after the beat got there (a stroke that ends in a stop is
     *  confirmed late, #377); counting it as the release would play straight through. */
    let fermataT = -Infinity;
    let fermataPeriod = 0;
    /** The fermata last released: the beat still sits on it, and must not stop there again. */
    let fermataReleased: number | null = null;
    /** The hands frame seen on the previous tick: the same object again is not a new
     *  observation (#225). */
    let lastFrame: HandsFrame | undefined;
    /** The body frame seen on the previous tick, and the last one fed (with its time). */
    let lastBodyFrame: BodyFrame | undefined;
    let lastBody: { t: number; frame: BodyFrame } | null = null;
    /** The player's lead offsets applied to the body detector's anchors (#427): a joint
     *  that lags the beat has its anchor moved earlier; one that leads it is held until
     *  its corrected time comes. */
    const lead = createLeadCorrector();
    /** What the follower was built for: a change re-creates it (the body's joints are
     *  fixed at construction), keeping the beat where it is. */
    let coreKey = '';
    /** The score tempo (bpm) the body follower was built at (null: the priors' default). */
    let seededBpm: number | null = null;
    /** The body's transport (#377): present while reading the body with the rules on. The
     *  meter measures the arms' height and motion from the pose stream; it lives as long
     *  as the stream (a rebuild of the follower does not reset it: its jitter estimate is
     *  the camera's). */
    let transport: Transport | null = null;
    let transportCfg: unknown = null;
    let meter: BodyMotionMeter | null = null;
    let transportReading: ConductorTransportReading = 'off';
    /** The last note onset of the loaded piece (null without one): a cut-off at or past it
     *  ends the piece, and the next start is from the top. */
    let docLastOnset: number | null = null;
    /** The document's length in beats (its last note-off): where a dancer's piece loops (#463). */
    let docLength: number | null = null;
    /** The beat the body's transport started on (its downbeat), until the prior has a
     *  period: meanwhile the beat moves at the marked tempo and waits just short of the
     *  next stroke's beat for the second stroke (see `process`). */
    let startBeat: number | null = null;
    /** The tempo of that interval when it is a release (the tempo before the hold); null at
     *  a start (the marked tempo then). */
    let startBpm: number | null = null;
    /** A cut-off left the beat where it stopped (not at the top): the next start moves on. */
    let afterStop = false;
    /** The beat at the last stroke the body's transport accepted, and whether the
     *  transport says the next stroke is overdue with the body still (`waiting`). */
    let strokeBeat: number | null = null;
    let waiting = false;
    /** The tempo the beat last advanced at: the body's hold runs up to its stop at it, and
     *  the release moves at it until the next stroke. */
    let holdBpm = 0;
    /** Expression (#378). A follower of the OTHER source when the expression is not the
     *  beat's (only its strokes' dynamics and articulation are read), the body's
     *  per-frame channels, and their per-player blend while the body shapes. */
    let exprIctus: Ictus | null = null;
    let exprKey = '';
    let exprMeter: BodyExpressionMeter | null = null;
    let blend: ExpressionBlend | null = null;
    let lastExprBody: BodyFrame | undefined;
    let lastExprBodyT = -Infinity;
    let lastExprHands: HandsFrame | undefined;
    let lastExprPtT = -Infinity;
    /** The shaping hand's gesture (#457) and the time of its last stroke: while it makes
     *  none, the gesture shapes. */
    let gesture: HandGesture | null = null;
    let lastShapeStrokeT = -Infinity;
    let prevShapeStrokeT = -Infinity;
    /** The crossfade between the strokes' reading and the gesture's (`handGesture.fadeS`). */
    let shapeMode: 'strokes' | 'gesture' | null = null;
    let fadeFrom = NaN;
    let fadeT0 = -Infinity;
    let lastShapedDyn = NaN;
    const resetFade = (): void => {
      shapeMode = null;
      fadeFrom = NaN;
      fadeT0 = -Infinity;
      lastShapedDyn = NaN;
    };
    const resetExpression = (): void => {
      exprIctus = null;
      exprKey = '';
      exprMeter = null;
      blend = null;
      gesture = null;
      resetFade();
      lastExprBodyT = -Infinity;
      lastExprPtT = -Infinity;
      lastShapeStrokeT = -Infinity;
      prevShapeStrokeT = -Infinity;
    };
    // Speed-based fallback: EW speed of the tracked point (or the body's quantity of
    // motion) and a decaying envelope of it.
    let lastPt: { t: number; x: number; y: number } | null = null;
    let speedEw = 0;
    let speedEnv = 0;
    const noteSpeed = (speed: number, dtS: number): void => {
      speedEw += 0.3 * (speed - speedEw);
      speedEnv = Math.max(speedEnv * Math.pow(0.85, dtS), speedEw);
    };
    const resetFollower = (): void => {
      ictus = null;
      // The expression's own frame clocks restart with the follower's (a replay from the top).
      lastExprBodyT = -Infinity;
      lastExprPtT = -Infinity;
      lastShapeStrokeT = -Infinity;
      prevShapeStrokeT = -Infinity;
      resetFade();
      lastPt = null;
      lastBody = null;
      lead.reset();
      seededBpm = null;
      speedEw = 0;
      speedEnv = 0;
    };

    const resolveDoc = (raw: unknown): void => {
      if (raw === docRef) return;
      docRef = raw;
      fermatas = [];
      docMeter = null;
      docTempo = null;
      docSigStart = null;
      docBarStart = null;
      docBpm = null;
      docLastOnset = null;
      docLength = null;
      fermataAt = null;
      fermataReleased = null;
      const doc = readScoreDoc(raw);
      if (!doc) return;
      fermatas = [...doc.fermatas].sort((a, b) => a - b);
      docMeter = (beat) => beatsPerBarAt(doc, beat);
      docTempo = (beat) => tempoAt(doc, beat);
      docSigStart = (beat) => timeSignatureAt(doc, beat).beat;
      docBarStart = (beat) => barStartAt(doc, beat);
      docBpm = firstTempo(doc);
      let last = -Infinity;
      for (const part of doc.parts) for (const n of part.notes) last = Math.max(last, n.start);
      docLastOnset = Number.isFinite(last) ? last : null;
      docLength = doc.lengthBeats > 0 ? doc.lengthBeats : null;
    };

    const resolveConfig = (raw: unknown): Params => {
      if (raw === lastConfigRef) return cfg;
      lastConfigRef = raw;
      if (raw && typeof raw === 'object') {
        const parsed = ConfigOverride.safeParse(raw);
        if (parsed.success) {
          const overrides = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
          cfg = { ...p, ...overrides } as Params;
          return cfg;
        }
      }
      cfg = p;
      return cfg;
    };

    const idleTime = (t: number, beatsPerBar: number): MusicalTime => ({
      t,
      beat: beatOut,
      phase: 0,
      tempo: 0,
      period: Infinity,
      confidence: 0,
      nextBeatAt: Infinity,
      beatsPerBar,
      beatInBar: 0,
      state: 'ready',
      anchors: 0,
    });

    const emit = ({ time, bpm, dynamics, articulation, enabled, c, level = 1, sounding = true }: EmitArgs) => ({
      time,
      beat: beatOut,
      bpm,
      velocityScale: enabled ? c.dynMin + (c.dynMax - c.dynMin) * clamp01(dynamics) : 0,
      phase: time.phase,
      dynamics,
      articulation,
      confidence: time.confidence,
      enabled,
      // Before the body's transport has started, and after a cut-off, the score is silent.
      // A dancer's piece is silent until it starts (#380).
      leadsScore: enabled && sounding && c.conducts === 'score' && !(transport && (!TRANSPORT_SOUNDING.has(transport.phase()) || time.anchors === 0)),
      // A dancer leading the recording is the song following the dancer's pulse (the pace
      // law, `song-pace`), not the beat servo on a time derived from it.
      recordingTime: enabled && c.conducts === 'recording' && c.source !== 'dancer' ? time : undefined,
      level,
      transport: enabled ? transportReading : 'off',
    });

    /** The piece's beats per stroke `k` (see the header). `auto` relates the strokes to
     *  the marked tempo at the position, conducting the score only. */
    const markRatio = (c: Params, s: IctusState | null, t: number, bpb: number): number => {
      if (c.markLevel === 'beat') return 1;
      if (c.markLevel === 'half') return 2;
      if (c.markLevel === 'bar') return bpb;
      if (c.conducts !== 'score') {
        levelHold = null;
        return 1;
      }
      if (!levelHold || levelBpb !== bpb) {
        // A new meter: a held bar stays a bar, a held beat stays a beat.
        // A conductor beats the beat until a different level persists.
        const held = levelHold?.ratio() ?? 1;
        levelHold = createLevelHold({ ratios: conductorRatios(bpb), captureRange: MARK_LEVEL_CAPTURE, persistS: MARK_LEVEL_PERSIST_S, sticky: true });
        levelHold.set(held === levelBpb && held > 2 ? bpb : held);
        levelBpb = bpb;
      }
      const marked = docTempo ? docTempo(beatOut) : null;
      if (s && marked !== null && marked > 0) {
        const trusted = s.state === 'running' && s.confidence >= c.fallbackBelowConfidence && Number.isFinite(s.period) && s.period > 0;
        levelHold.step(t, trusted ? s.period : NaN, 60 / marked);
      }
      return levelHold.ratio() ?? 1;
    };
    /** The whole beat within the bar at `beat` (#438): counted from the bar line in force,
     *  so after a meter change or a pickup it agrees with the bar-level strokes, and a
     *  fractional bar (5/8 = 2.5 quarter beats) still reads a whole beat. */
    const barBeat = (beat: number, bpb: number): number => {
      const into = beat - (docBarStart ? docBarStart(beat) : 0);
      return Math.floor((((into % bpb) + bpb) % bpb) + 1e-9);
    };
    /** The tempo the body follower is seeded at: the score's first mark, at the stated
     *  level (null without a score, or reading the hands). */
    const bodySeed = (c: Params): number | null => {
      // With the transport rules the start is the ready pose and the upbeat, and the beat
      // moves at the marked tempo until the second stroke (`startBeat`); seeding the prior
      // too would hand the detector the marked period at the downbeat, and a piece marked
      // at twice the conductor's tempo then has it take each stroke's rebound for a stroke
      // (measured on A1's fixture against a score at 160 bpm).
      if (c.source !== 'body' || docBpm === null || c.transport.rules) return null;
      const k = c.markLevel === 'half' ? 2 : c.markLevel === 'bar' ? (docMeter ? docMeter(0) : c.beatsPerBar) : 1;
      return docBpm / k;
    };

    /** The dynamics and articulation for this tick (#378; see `expression`). A dancer's own
     *  expression is the body's (#380): its motion and reach, read once per pulse cycle
     *  (`s.anchor` is the cycle), with no stroke excursion. */
    const shapeExpression = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params, s: Pick<IctusState, 'dynamics' | 'articulation' | 'anchor'>): DynamicsEstimate => {
      const source = c.expression === 'same' ? (c.source === 'dancer' ? 'body' : c.source) : c.expression;
      const beat: DynamicsEstimate = { dynamics: s.dynamics, articulation: s.articulation };
      const ownBody = c.source === 'dancer' && source === 'body';
      // The hand conductor's other hand, named to shape (#457): the hands alone split the role.
      const beatingHand = c.hand === 'auto' ? 'right' : c.hand;
      const otherHand = source === 'hands' && c.source === 'hands' && c.expressionHand !== 'auto' && c.expressionHand !== beatingHand;
      const now = followOtherSource(inputs, ctx, c, source, (source === c.source && !otherHand) || ownBody);
      // The shaping source's strokes, once it has shown one; until then (the pose model
      // loading, nobody's other hand in frame) the beat's own.
      const shaped = (): DynamicsEstimate => {
        const e = exprIctus?.state();
        return e && e.anchors > 0 ? e : beat;
      };
      return source !== 'body' ? shapeFromHands(c, shaped(), now) : shapeFromBody(inputs, ctx, c, s, ownBody, shaped);
    };

    /** The follower of the OTHER source (`own`: the beat's own source shapes, so there is
     *  none): built when the source or its settings change, fed the hands' frame here (the
     *  body's is fed by {@link shapeFromBody}). Returns the time the shaping reads at. */
    const followOtherSource = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params, source: string, own: boolean): number => {
      let now = ctx.time;
      if (own) {
        exprIctus = null;
        return now;
      }
      // The other source's follower: its prior only paces its detector.
      const key = source === 'body' ? `body:${c.bodyPoint}:${c.hand}:${c.mirrorX}` : `hands:${c.source}:${c.bodyPoint}:${c.hand}:${c.expressionHand}:${c.handGesture.minStroke}:${c.mirrorX}:${c.mirrorHandedness}`;
      if (!exprIctus || key !== exprKey) {
        exprIctus = createIctus({
          // A shaping hand's stroke is at least `minStroke` frame heights: a hand held
          // still is quiet (its tremor is no stroke), so its gesture shapes (#457).
          detector: source === 'body' ? createImpactDetector({ joints: conductorBodyJoints(c.bodyPoint, c.hand), mirrorX: c.mirrorX }) : { mirrorX: c.mirrorX, minAmplitude: c.handGesture.minStroke },
          prior: c.prior,
        });
        exprKey = key;
        lastExprPtT = -Infinity;
        lastShapeStrokeT = -Infinity;
        prevShapeStrokeT = -Infinity;
        gesture = null;
        resetFade();
      }
      if (source === 'hands') {
        const frame = inputs.hands as HandsFrame | undefined;
        const fresh = isFresh(frame, lastExprHands);
        lastExprHands = frame;
        const hand = frame && fresh ? shapingHand(frame, c) : undefined;
        const t = captureTime(frame, ctx);
        now = t;
        if (hand && frame && frame.height > 0 && t >= lastExprPtT + MIN_SAMPLE_SPACING) {
          if (exprIctus.feed(handPoint(hand, frame, c, t)).anchor) {
            prevShapeStrokeT = lastShapeStrokeT;
            lastShapeStrokeT = t;
          }
          gesture ??= createHandGesture();
          gesture.push(handGestureFrame(hand, frame, inputs.body as BodyFrame | undefined, t));
          lastExprPtT = t;
        }
      }
      return now;
    };

    /** Shaping read from the hands (#457): the shaping source's strokes, or, while its hand
     *  makes no stroke, the gesture (its height and palm), continuously; a change of reading
     *  crossfades from where the dynamics were (no step in CC11). `shapedNow` is the
     *  strokes the shaping source has shown (the beat's own until it shows one). */
    const shapeFromHands = (c: Params, shapedNow: DynamicsEstimate, now: number): DynamicsEstimate => {
      exprMeter = null;
      blend = null;
      let strokes = shapedNow;
      // A shaping hand that makes no stroke (#457): its height and palm say the loudness,
      // continuously; its strokes' articulation (or the beat's) stands. A hand not seen for
      // a moment reads as before.
      // Stroking is two strokes in a row, each within `quietS` of the next (and of now):
      // one turn, a hand lowered to hush and stopping, is not a beat.
      const stroking = lastShapeStrokeT - prevShapeStrokeT <= c.handGesture.quietS && now - lastShapeStrokeT <= c.handGesture.quietS;
      if (exprIctus) {
        let mode: 'strokes' | 'gesture' = 'strokes';
        if (gesture && !stroking) {
          gesture.setWeights({ height: c.handGesture.height, palm: c.handGesture.palm });
          const g = gesture.read(now);
          if (Number.isFinite(g)) {
            strokes = { dynamics: g, articulation: strokes.articulation };
            mode = 'gesture';
          }
        }
        // A change of reading crossfades from where the dynamics were (no step in CC11).
        if (shapeMode !== null && mode !== shapeMode) {
          fadeFrom = lastShapedDyn;
          fadeT0 = now;
        }
        shapeMode = mode;
        const u = c.handGesture.fadeS > 0 ? Math.min(1, Math.max(0, (now - fadeT0) / c.handGesture.fadeS)) : 1;
        if (Number.isFinite(fadeFrom) && u < 1) strokes = { dynamics: fadeFrom + (strokes.dynamics - fadeFrom) * u, articulation: strokes.articulation };
        lastShapedDyn = strokes.dynamics;
      }
      return strokes;
    };

    /** Shaping read from the body: the strokes' dynamics blended with its motion and its
     *  arm's reach, each per player (`shaped` is read at the end, after this tick's frame). */
    const shapeFromBody = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params, s: Pick<IctusState, 'anchor'>, ownBody: boolean, shaped: () => DynamicsEstimate): DynamicsEstimate => {
      exprMeter ??= createBodyExpressionMeter();
      // A dancer's cycle has no braking sharpness: its articulation is the body's flow.
      const articulation = ownBody ? 'flow' : c.articulationFrom;
      blend ??= createExpressionBlend({ articulation });
      blend.setArticulation(articulation);
      const body = inputs.body as BodyFrame | undefined;
      const fresh = isFresh(body, lastExprBody);
      lastExprBody = body;
      const t = captureTime(body, ctx);
      if (body && fresh && t >= lastExprBodyT + MIN_SAMPLE_SPACING) {
        lastExprBodyT = t;
        // The channels are read per stroke (a hold or a fermata changes nothing).
        blend.push(exprMeter.push(body, t, c.hand));
        if (exprIctus) {
          const a = exprIctus.feedFrame(bodyChannelFrame(body, t, c.hand)).anchor;
          if (a) blend.pushStroke(a);
        }
      }
      // The beat's own stroke this tick, when the body both beats and shapes.
      if (!exprIctus && s.anchor) blend.pushStroke(s.anchor);
      return blend.read(ownBody ? null : shaped());
    };

    /** A dancer leads (#380): ictus's dance lead owns the beat (the loose law: it starts on
     *  a cycle, follows inside the clamp, holds and never stops while the dancer dances).
     *  A written fermata holds for one dancer cycle and the piece loops at its end (#463;
     *  the expression keeps reading the dancer's cycles through a hold, so a dancer's
     *  movement can swell a held chord); the transport rules are a conductor's. The beat
     *  goes on from where the last leader left it. */
    let dance: DanceLead | null = null;
    /** The relation the last dance lead FOLLOWED (never a candidate still persisting),
     *  kept across a switch of leader so that the dancer, chosen again and related the same
     *  way, re-starts on its next cycle (#506). Checked against the marked tempo in force on
     *  return (a new piece relates afresh); forgotten when the conductor is switched off. */
    let danceRatio: number | null = null;
    const leaveDance = (): void => {
      const r = dance?.followed();
      if (r !== undefined && r !== null && Number.isFinite(r) && r > 0) danceRatio = r;
      dance = null;
    };
    let lastCycleAt: number | undefined;
    const danceTick = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params) => {
      transport = null;
      transportReading = 'off';
      levelHold = null;
      startBeat = null;
      fermataAt = null;
      // The hand's or the body's follower is not kept across a dancer: back to it, it
      // starts fresh and waits for a first stroke.
      if (ictus) resetFollower();
      if (!dance) {
        dance = createDanceLead();
        dance.reset(beatOut, danceRatio !== null ? { ratio: danceRatio } : undefined);
        lastCycleAt = undefined;
      }
      wasEnabled = true;
      const raw = inputs.pulse as PulseState | undefined;
      const pulse = raw && typeof raw === 'object' && typeof raw.period === 'number' ? raw : UNKNOWN_PULSE;
      const marked = docTempo?.(beatOut) ?? c.dancer.bpm;
      // The piece's written fermatas hold for one dancer cycle, and its end loops to the top
      // on a cycle start (#463): the dance lead's rules 6 and 7.
      const d = dance.step({ t: ctx.time, pulse, marked, ref: docBarStart ? docBarStart(beatOut) : 0, range: c.dancer.range, phaseOffset: c.dancer.phaseOffset, fermatas, top: docSigStart ? docSigStart(0) : 0, ...(docLength !== null ? { end: docLength } : {}) });
      beatOut = d.beat;
      // A cycle the follower fitted is the dancer's "stroke" for the expression (A6's note).
      let cycle: Anchor | null = null;
      if (pulse.lastAnchorAt !== undefined && pulse.lastAnchorAt !== lastCycleAt) {
        lastCycleAt = pulse.lastAnchorAt;
        cycle = { t: pulse.lastAnchorAt, confidence: pulse.confidence, strength: 1, sharpness: NaN, lateral: 0 };
      }
      const expression = shapeExpression(inputs, ctx, c, { dynamics: 0.5, articulation: 0.5, anchor: cycle });
      const bpm = d.started ? d.tempo : 0;
      const wholeBeat = Math.floor(beatOut);
      const bpb = docMeter ? docMeter(beatOut) : c.beatsPerBar;
      const time: MusicalTime = {
        t: ctx.time,
        beat: beatOut,
        phase: beatOut - wholeBeat,
        tempo: bpm,
        period: bpm > 0 ? 60 / bpm : Infinity,
        confidence: d.started ? pulse.confidence : 0,
        nextBeatAt: bpm > 0 ? ctx.time + ((1 - (beatOut - wholeBeat)) * 60) / bpm : Infinity,
        beatsPerBar: bpb,
        beatInBar: barBeat(beatOut, bpb),
        // A held fermata reads as a hold to every consumer, as the conductor's does.
        state: d.mode === 'fermata' || d.mode === 'ended' ? 'hold' : d.started ? 'running' : 'ready',
        anchors: d.cycles,
        ...(pulse.lastAnchorAt !== undefined ? { lastAnchorAt: pulse.lastAnchorAt } : {}),
        // The piece's next loop, so a scheduler commits the top's first notes ahead (#508).
        ...(d.started && dance.wrap() ? { wrap: dance.wrap()! } : {}),
      };
      return { ...emit({ time, bpm, dynamics: expression.dynamics, articulation: expression.articulation, enabled: true, c, level: Number.isFinite(d.ratio) ? d.ratio : 1, sounding: d.started }), dance: d.mode };
    };

    /** The conductor is off: the follower, the transport and the dancer's lead are let go,
     *  and the output is the idle time (a frozen beat, a silent score). */
    const idleTick = (ctx: NodeContext, c: Params, beatsPerBar: number) => {
      if (wasEnabled) {
        resetFollower();
        beatOut = 0;
        fermataAt = null;
        fermataReleased = null;
        wasEnabled = false;
      }
      levelHold = null;
      transport = null;
      meter = null;
      dance = null;
      danceRatio = null;
      resetExpression();
      transportReading = 'off';
      afterStop = false;
      startBeat = null;
      return emit({ time: idleTime(ctx.time, beatsPerBar), bpm: 0, dynamics: 0, articulation: 0.5, enabled: false, c });
    };

    /** The body's transport: made when the body is read with the rules on. A live change
     *  (from the hands to the body, or the rules turned on) while the music runs keeps it
     *  running (the next stroke is taken as the next one); otherwise it starts idle and
     *  waits for the ready pose. */
    const prepareTransport = (c: Params, ctx: NodeContext): void => {
      const rulesOn = c.source === 'body' && c.transport.rules && TRANSPORT_POINTS.has(c.bodyPoint);
      if (!rulesOn) {
        transport = null;
        transportReading = 'off';
        return;
      }
      if (!transport) {
        transport = createTransport(c.transport);
        transportCfg = c.transport;
        transportReading = 'idle';
        // The music is running (on the hands, or on the body with the rules off): the
        // prior is following strokes now, not holding after the last one.
        if (ictus && ictus.state().state === 'running') {
          transport.run(ctx.time);
          transportReading = 'running';
        }
      } else if (c.transport !== transportCfg) {
        transport.configure(c.transport);
        transportCfg = c.transport;
      }
      meter ??= createBodyMotionMeter();
    };

    /** The follower for this tick, re-created when the source, the point or the side
     *  changed (the body's detector fixes its joints when built) and made on first use. The
     *  beat stays where it is: a new follower waits for its first stroke. */
    const prepareFollower = (c: Params, ctx: NodeContext): Ictus => {
      const key = c.source === 'body' ? `body:${c.bodyPoint}:${c.hand}:${c.mirrorX}` : 'hands';
      // The level confirms itself from the first joint followed (A2, note 5 on #386), so
      // the body follower starts at the score's marked tempo: the detector's period and
      // both priors'. The piece loads only once conducting is on, so it usually arrives
      // after the follower was built; until the first stroke, a new tempo rebuilds it.
      if (ictus && c.source === 'body' && bodySeed(c) !== seededBpm && ictus.state().anchors === 0) resetFollower();
      prepareTransport(c, ctx);
      if (ictus && key !== coreKey) {
        resetFollower();
        // A held fermata stays held, and the new follower's first stroke releases it
        // (its anchor count starts again from 0).
        fermataAnchors = 0;
      }
      if (!wasEnabled || !ictus) {
        coreKey = key;
        const seed = bodySeed(c);
        seededBpm = seed;
        const tempo = seed !== null ? { initialTempo: seed } : {};
        ictus = createIctus({
          detector:
            c.source === 'body'
              ? createImpactDetector({ joints: conductorBodyJoints(c.bodyPoint, c.hand), mirrorX: c.mirrorX, ...(seed !== null ? { initialPeriod: 60 / seed } : {}) })
              : { mirrorX: c.mirrorX },
          prior: c.prior,
          oscillator: { beatsPerBar: c.beatsPerBar, phaseGain: c.phaseGain, periodGain: c.periodGain, ...tempo },
          trend: { beatsPerBar: c.beatsPerBar, ...tempo },
        });
        wasEnabled = true;
      }
      return ictus;
    };

    /** One body-frame step of the transport: whether the detector's anchor reaches the
     *  prior, and the start / cut-off / release it called. */
    const stepTransport = (tp: Transport, inputs: Record<string, unknown>, ic: Ictus, t: number, a: Anchor | null, cues: object) => {
      const wasHolding = tp.phase() === 'holding';
      const now = ic.state();
      const tr = tp.step({
        t,
        ...cues,
        anchor: a?.t,
        period: (now.state === 'running' || now.state === 'hold') && Number.isFinite(now.period) ? now.period : Infinity,
        pose: readTransportPose(inputs.transportPose),
      });
      transportReading = tr.stopped ? 'stopped' : tr.phase;
      waiting = tr.waiting;
      let released = false;
      // The stroke that releases the body's hold restarts the prior, like a start:
      // the release and the stroke after it set the tempo again (a conductor's
      // tempo after a fermata is a new one), and the beat moves at the old tempo
      // in between. Feeding it to a prior whose confidence decayed through the hold
      // would hand the beat to the speed fallback for a few strokes.
      if (wasHolding && tr.accept) {
        ic.prior.reset();
        fermataAnchors = 0;
        released = true;
      }
      return { accept: tr.accept, stopped: tr.stopped, started: tr.started, released };
    };

    // 1. Feed the tracked point (or free-run when no hand is in frame).
    //    Only a NEW camera frame is an observation (#225): the engine ticks at the
    //    display rate over a slower camera, and the same frame fed twice at two
    //    tick times flattens the detector's parabolic fit and biases the ictus. The
    //    sample time is the frame's capture time when the source stamped one
    //    (#226), else the tick time.
    const feedBody = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params, ic: Ictus): Fed => {
      const body = inputs.body as BodyFrame | undefined;
      const fresh = isFresh(body, lastBodyFrame);
      lastBodyFrame = body;
      const t = captureTime(body, ctx);
      if (!(body && fresh && !(lastBody && t < lastBody.t + MIN_SAMPLE_SPACING))) return { s: ic.advance(ctx.time), stopped: false, started: false, released: false };
      // A frame with nobody in it is fed too (no channels): the detector needs to
      // see the time pass to call a joint lost.
      if (lastBody) {
        const qom = bodyQuantityOfMotion(lastBody.frame, body, t - lastBody.t);
        if (qom !== undefined) noteSpeed(qom, t - lastBody.t);
      }
      lastBody = { t, frame: body };
      // The detector always sees the frame; whether its anchor reaches the prior is
      // the transport's call (no anchor before the downbeat).
      // The player's lead offset (#427): the anchor moved by its joint's learned lag.
      lead.setOffsets(readLeadOffsets(inputs.leadOffsets));
      // The detector's own refractory (a quarter period) on the corrected anchors too:
      // two joints with different offsets must not make one stroke two.
      const period = ic.state().period;
      const a = lead.push(ic.detector.push(bodyChannelFrame(body, t, c.hand)), t, Number.isFinite(period) && period > 0 ? 0.25 * period : 0);
      let accept = a !== null;
      const cues = meter ? meter.push(body, t, c.hand) : {};
      let flags = { stopped: false, started: false, released: false };
      if (transport) {
        const tr = stepTransport(transport, inputs, ic, t, a, cues);
        accept = tr.accept;
        flags = { stopped: tr.stopped, started: tr.started, released: tr.released };
      }
      return { s: a && accept ? ic.feedAnchor(a) : ic.advance(t), ...flags };
    };

    const feedHands = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params, ic: Ictus): Fed => {
      const frame = inputs.hands as HandsFrame | undefined;
      const fresh = isFresh(frame, lastFrame);
      lastFrame = frame;
      const hand = frame && fresh ? pickHand(frame, c) : undefined;
      // The sample time: the frame's capture stamp in real time at speed 1, else the
      // tick. A sample that would not advance the detector (a stamped frame arriving
      // behind the last tick-timed one, right after a slot swap) is skipped rather
      // than given an invented time.
      const t = captureTime(frame, ctx);
      let s: IctusState;
      if (hand && frame && frame.height > 0 && !(lastPt && t < lastPt.t + MIN_SAMPLE_SPACING)) {
        const pt = handPoint(hand, frame, c, t);
        if (lastPt && pt.t > lastPt.t) noteSpeed(Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) / (pt.t - lastPt.t), pt.t - lastPt.t);
        lastPt = pt;
        s = ic.feed(pt);
      } else {
        s = ic.advance(ctx.time);
      }
      return { s, stopped: false, started: false, released: false };
    };

    /** A cut-off (#377): the prior forgets the piece's tempo and waits for the next
     *  ready pose; the beat stays where it stopped (a held fermata is released by the
     *  new start's first stroke), unless the piece is over, when it returns to the top. */
    const cutOff = (ic: Ictus): IctusState => {
      // Only the prior: the detector keeps what it learned of this player's joints and
      // stroke period, and the dynamics their envelope (a fresh detector mistakes the
      // still arm's jitter for strokes while it relearns them).
      ic.prior.reset();
      // A leading joint's anchor held past the cut-off is not a stroke after it.
      lead.reset();
      const s = ic.state();
      fermataAnchors = 0;
      if (docLastOnset !== null && beatOut >= docLastOnset) {
        beatOut = 0;
        fermataAt = null;
        fermataReleased = null;
        afterStop = false;
      } else afterStop = true;
      return s;
    };

    /** The beat at or after `b` (`ceil`) or nearest it (`round`) that a stroke lands on, for
     *  strokes `k` beats apart: a multiple of `k`, counted from the time signature's start
     *  (the servo's reference). */
    const gridFor = (k: number) => (b: number, snap: (x: number) => number): number => {
      const ref = k === 1 || !docBarStart ? 0 : docBarStart(b);
      return ref + k * snap((b - ref) / k);
    };

    /** The downbeat (#377): the first stroke after the upbeat plays a whole beat (the next
     *  one when a cut-off left the beat between two). Until the second stroke gives the
     *  prior a period, the beat moves at the score's marked tempo (or the priors' initial
     *  one) rather than the speed fallback, and never reaches the next stroke's beat on
     *  its own: the second stroke plays it. Also keeps `startBeat` and `strokeBeat`. */
    const placeStart = (fed: Fed, s: IctusState, grid: Grid): void => {
      const { started, released, stopped } = fed;
      if (started && afterStop) {
        // After a cut-off the note at the stop has sounded (a fermata's too): the restart
        // plays the next stroke's beat strictly after it.
        const from = beatOut;
        beatOut = grid(beatOut + START_EPS / 2, Math.ceil);
        if (fermataAt !== null && fermataAt <= from) {
          fermataReleased = fermataAt;
          fermataAt = null;
        }
        afterStop = false;
      } else if (started) beatOut = grid(beatOut - START_EPS, Math.ceil);
      else if (released) {
        // A body hold waits just short of a stroke's beat: the release plays it. A fermata
        // is not on the stroke grid at every level (beat 3 marking half bars): the beat
        // goes on from it rather than jumping to the next stroke's beat.
        const g = grid(beatOut - 2 * START_EPS, Math.ceil);
        if (g - beatOut <= 2 * START_EPS) beatOut = Math.max(beatOut, g);
      }
      if (started || released) {
        startBeat = beatOut;
        startBpm = released && holdBpm > 0 ? holdBpm : null;
      }
      if (startBeat !== null && (!transport || s.state !== 'ready' || s.anchors === 0)) startBeat = null;
      if (!transport || stopped) {
        strokeBeat = null;
        waiting = false;
      } else if (s.anchor) strokeBeat = grid(beatOut, Math.round);
    };

    /** The beat reached a written fermata: stop on it and hold there. */
    const stopAtFermata = (f: number, s: IctusState, ctx: NodeContext): void => {
      fermataAt = f;
      fermataAnchors = s.anchors;
      fermataT = ctx.time;
      fermataPeriod = Number.isFinite(s.period) && s.period > 0 ? s.period : 0;
    };

    /** The body holding (raised and still, no stroke): the beat goes on at the tempo it
     *  had, but no further than just short of the next stroke's beat, and holds there.
     *  Never frozen between two: a release from a fraction of a stroke has no right
     *  answer (the servo would pick a side by rounding), and the beat the conductor
     *  last gave is the one that sustains. Returns the tempo it advanced at. */
    const holdBeat = (ctx: NodeContext, s: IctusState, grid: Grid): number => {
      const cap = grid(beatOut, Math.ceil) - START_EPS;
      let next = Math.min(beatOut + (holdBpm / 60) * ctx.dt, Math.max(beatOut, cap));
      // A written fermata on the way stops it there, as when running.
      const f = fermatas.find((x) => x > beatOut && x <= next);
      if (f !== undefined) {
        next = f;
        stopAtFermata(f, s, ctx);
      }
      const bpm = next > beatOut && f === undefined ? holdBpm : 0;
      beatOut = next;
      return bpm;
    };

    /** Running: the inferred tempo blended with the speed fallback by confidence (`w`),
     *  integrated, phase-servoed onto the inferred beat and stopped on any fermata it would
     *  cross. Returns the tempo it advanced at. */
    const runBeat = (c: Params, ctx: NodeContext, s: IctusState, k: number, grid: Grid, fallbackBpm: number): number => {
      const w = s.state === 'running' && c.fallbackBelowConfidence > 0 ? clamp01(s.confidence / c.fallbackBelowConfidence) : s.state === 'running' ? 1 : 0;
      let bpm = startBeat !== null ? (startBpm ?? docTempo?.(beatOut) ?? START_BPM) : w * s.tempo * k + (1 - w) * fallbackBpm;
      const advanced = beatOut + (bpm / 60) * ctx.dt;
      // 3. Phase servo: converge onto the inferred beat over `servoBeats`, never
      //    below where the beat already was (a rewind would retrigger a note).
      let corrected = advanced;
      if (w > 0 && Number.isFinite(s.period) && s.period > 0) {
        // A stroke lands on a multiple of `k` beats, counted from the time
        // signature's start. The horizon stays in strokes (`s.period`).
        const ref = k === 1 ? 0 : docBarStart ? docBarStart(beatOut) : 0;
        const err = k === 1 ? wrapPhase(advanced - beatAt(s, ctx.time)) : wrapPhase((advanced - ref) / k - beatAt(s, ctx.time)) * k;
        corrected = advanced - w * err * Math.min(1, ctx.dt / (c.servoBeats * s.period));
      }
      let next = Math.max(beatOut, corrected);
      if (startBeat !== null) next = Math.max(beatOut, Math.min(next, grid(startBeat + START_EPS, Math.ceil) - START_EPS));
      // The stroke overdue and the body still: the next stroke's beat waits for it.
      if (waiting && strokeBeat !== null) next = Math.max(beatOut, Math.min(next, strokeBeat + k - START_EPS));
      // 4. Fermatas: stop exactly on one the beat would cross, and hold there.
      for (const f of fermatas) {
        // One the beat sits on counts too (a fermata at beat 0, #393), unless just released.
        if ((f > beatOut || (f === beatOut && f !== fermataReleased)) && f <= next) {
          next = f;
          stopAtFermata(f, s, ctx);
          bpm = 0;
          break;
        }
      }
      beatOut = next;
      if (bpm > 0) holdBpm = bpm;
      return bpm;
    };

    /** 2. The tempo this tick advanced the beat at, and the beat moved: a written fermata
     *  holds (released by the next stroke), else the body's hold, else frozen before a first
     *  stroke or while holding, else running. */
    const advanceBeat = (c: Params, ctx: NodeContext, s: IctusState, k: number, grid: Grid, bodyHold: boolean): number => {
      const fallbackBpm = c.fallbackBpmMin + (c.fallbackBpmMax - c.fallbackBpmMin) * (speedEnv > 0 ? clamp01(speedEw / speedEnv) : 0);
      // A fermata releases on the NEXT stroke after it was reached. The stroke that landed
      // on it does not (`fermataT`): its anchor is confirmed a few frames after the beat got
      // there, hands and body alike (#449).
      const landedOnIt = s.lastAnchorAt !== undefined && s.lastAnchorAt < fermataT + FERMATA_RELEASE_PERIODS * fermataPeriod;
      if (fermataAt !== null && s.anchors > fermataAnchors && !landedOnIt) {
        fermataReleased = fermataAt;
        fermataAt = null;
      }
      if (fermataAt !== null) return 0;
      if (bodyHold) return holdBeat(ctx, s, grid);
      // Holding, or no stroke seen yet (the preparatory beat has not come): frozen.
      if (s.state === 'hold' || s.anchors === 0) return 0;
      return runBeat(c, ctx, s, k, grid, fallbackBpm);
    };

    /** The time this tick reports, from the follower's state and the beat as moved. */
    const timeOf = (ctx: NodeContext, c: Params, s: IctusState, bpm: number, bodyHold: boolean): MusicalTime => {
      const wholeBeat = Math.floor(beatOut);
      const bpb = docMeter ? docMeter(beatOut) : c.beatsPerBar;
      return {
        t: ctx.time,
        beat: beatOut,
        phase: beatOut - wholeBeat,
        tempo: bpm,
        period: bpm > 0 ? 60 / bpm : Infinity,
        confidence: s.confidence,
        nextBeatAt: bpm > 0 ? ctx.time + ((1 - (beatOut - wholeBeat)) * 60) / bpm : Infinity,
        beatsPerBar: bpb,
        beatInBar: barBeat(beatOut, bpb),
        // A fermata reads as a hold to every consumer (the HUD, the panel, the score).
        state: fermataAt !== null || bodyHold ? 'hold' : s.state,
        anchors: s.anchors,
        lastAnchorAt: s.lastAnchorAt,
        leadOffset: s.leadOffset,
      };
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        resolveDoc(inputs.doc);
        const beatsPerBar = docMeter ? docMeter(beatOut) : c.beatsPerBar;
        if (!c.enabled) return idleTick(ctx, c, beatsPerBar);
        if (c.source === 'dancer') return danceTick(inputs, ctx, c);
        leaveDance();
        const ic = prepareFollower(c, ctx);
        const fed = c.source === 'body' ? feedBody(inputs, ctx, c, ic) : feedHands(inputs, ctx, c, ic);
        // 1b. Expression (#378): from the beat's source, or from the other one through a
        //     follower of its own whose strokes only shape; reading the body, the strokes'
        //     dynamics are blended with its motion and its arm's reach, each per player.
        const expression = shapeExpression(inputs, ctx, c, fed.s);
        const s = fed.stopped ? cutOff(ic) : fed.s;
        // The strokes' tempo and phase are scaled to the piece's beats by the level `k`.
        const k = markRatio(c, s, ctx.time, beatsPerBar);
        const grid = gridFor(k);
        const bodyHold = transport?.phase() === 'holding';
        placeStart(fed, s, grid);
        const bpm = advanceBeat(c, ctx, s, k, grid, bodyHold);
        return emit({ time: timeOf(ctx, c, s, bpm, bodyHold), bpm, dynamics: expression.dynamics, articulation: expression.articulation, enabled: true, c, level: k });
      },
      dispose() {
        ictus = null;
      },
    };
  },
});
