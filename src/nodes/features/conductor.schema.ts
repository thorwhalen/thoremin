/**
 * The `conductor` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */
import { z } from 'zod';
import { ARTICULATION_SOURCES, DANCE_LEAD_DEFAULTS, DEFAULT_RHYTHM_PRIOR, HAND_GESTURE_DEFAULTS, RHYTHM_PRIOR_KINDS, TEMPO_PRIORS, TRANSPORT_DEFAULTS, type LeadOffsets } from '@thoremin/ictus';
import { CONDUCTOR_BODY_POINTS } from './conductor_body.schema';

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
/** Which level a stroke marks (#376): every beat, every other beat, every bar, or found
 *  by relating the strokes to the score's marked tempo. */
export const CONDUCTOR_MARK_LEVELS = ['beat', 'half', 'bar', 'auto'] as const;
export type ConductorMarkLevel = (typeof CONDUCTOR_MARK_LEVELS)[number];
/** Where the dynamics and the articulation come from (#378): the same source as the beat
 *  (the default), or the other one (the split role: the body beats, a hand shapes). */
export const CONDUCTOR_EXPRESSION_SOURCES = ['same', 'hands', 'body'] as const;
export type ConductorExpressionSource = (typeof CONDUCTOR_EXPRESSION_SOURCES)[number];
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
  /**
   * The process model the tempo follows when the gesture is too uncertain to say (#333): `none`
   * (today: the speed-based fallback) or `kth-final-ritard`, which slows into the last beats of
   * the piece the way a performer would (Friberg and Sundberg's stopping-runner curve), from the
   * last tempo the gesture was confident of. A confident gesture overrides it. Off by default:
   * it changes the tempo a player hears when their gesture is hesitant (#168).
   */
  tempoPrior: z.enum(TEMPO_PRIORS).default('none'),
  /** How many beats before the piece's last note the ritard starts. */
  ritardBeats: z.number().min(1).max(32).default(8),
  /** The tempo at the last beat, relative to the tempo the ritard started from. */
  ritardRatio: z.number().min(0.1).max(1).default(0.35),
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

/** Whether the conductor reads two hands at once (#457): a hand conductor whose named
 *  shaping hand is not the beating one. The host counts it in the hand model's hands. */
export function conductorReadsTwoHands(c: Partial<Params> | undefined): boolean {
  if (!c || c.enabled !== true || (c.source ?? 'hands') !== 'hands') return false;
  const shaping = c.expressionHand ?? 'auto';
  const beating = (c.hand ?? 'auto') === 'auto' ? 'right' : c.hand;
  const handsShape = (c.expression ?? 'same') !== 'body';
  return handsShape && shaping !== 'auto' && shaping !== beating;
}

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
