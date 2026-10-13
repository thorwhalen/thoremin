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
 * the score's marked tempo at the position, held once chosen and changed only after
 * another ratio has persisted 3 s (the red-noise guard of #339). `k` is applied at the
 * one seam between the follower's state and the integrated beat: the tempo is `k` times
 * the strokes' and the phase servo lands a stroke on a multiple of `k` beats (counted
 * from the current time signature's start), so the score, the orchestra and
 * `recordingTime` all inherit it. Leading a recording, `auto` has no marked tempo to
 * relate to and stays at the beat: the song's pace controller relates the conducted beat
 * to the song's tracked one ({1/2, 1, 2}, the servo's level). The `level` output is `k`.
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
 * Pure and Node-safe: no DOM, no clock (it reads `ctx.time` / `ctx.dt`), and the
 * recorded conducting fixtures drive it headlessly.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { beatAt, conductorRatios, createIctus, createImpactDetector, createLevelHold, wrapPhase, DEFAULT_RHYTHM_PRIOR, RHYTHM_PRIOR_KINDS, type Ictus, type IctusState, type LevelHold, type MusicalTime } from '@thoremin/ictus';
import { LM, frameTime, type BodyFrame, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { bodyChannelFrame, bodyQuantityOfMotion, conductorBodyJoints, CONDUCTOR_BODY_POINTS } from './conductor_body';
import { beatsPerBarAt, timeSignatureAt } from '@thoremin/sdk/score/schema';
import { readScoreDoc } from '@thoremin/sdk/score/prepare';

export const CONDUCTOR_HANDS = ['auto', 'right', 'left'] as const;
export type ConductorHand = (typeof CONDUCTOR_HANDS)[number];
export const CONDUCTOR_POINTS = ['wrist', 'indexTip'] as const;
export type ConductorPoint = (typeof CONDUCTOR_POINTS)[number];
/** What the conductor leads (#187 PR 7): the score (and the orchestra), or the song
 *  loaded in the Song tool ("Conduct a recording"). */
export const CONDUCTOR_TARGETS = ['score', 'recording'] as const;
export type ConductorTarget = (typeof CONDUCTOR_TARGETS)[number];
/** What the conductor reads (#375): the beating hand (the hand model), or the body (the
 *  pose model, a second camera branch the derivation composes while this is `body`). */
export const CONDUCTOR_SOURCES = ['hands', 'body'] as const;
export type ConductorSource = (typeof CONDUCTOR_SOURCES)[number];
export { CONDUCTOR_BODY_POINTS, type ConductorBodyPoint } from './conductor_body';
/** Which level a stroke marks (#376): every beat, every other beat, every bar, or found
 *  by relating the strokes to the score's marked tempo. */
export const CONDUCTOR_MARK_LEVELS = ['beat', 'half', 'bar', 'auto'] as const;
export type ConductorMarkLevel = (typeof CONDUCTOR_MARK_LEVELS)[number];
/** `markLevel: auto`: how far (a fraction, in log terms) the player's tempo may be from
 *  the marked tempo at the level followed before another level is tried, and how long a
 *  different level must persist before it is followed. */
export const MARK_LEVEL_CAPTURE = 0.5;
export const MARK_LEVEL_PERSIST_S = 3;

const Params = z.object({
  /** Off by default: conducting replaces the score's fixed tempo, and a player who
   *  never opens the Conductor panel should never have the score play. */
  enabled: z.boolean().default(false),
  /** What the beat leads: the score (and the orchestra), or the loaded recording, whose
   *  tempo then follows the beat through the song's pacer (#187 PR 7). While it leads the
   *  recording the score and the orchestra stay silent. */
  conducts: z.enum(CONDUCTOR_TARGETS).default('score'),
  /** What beats time (#375): the hand (the hand model's wrist or fingertip) or the body
   *  (the pose model: an arm, the trunk, the head, the hips). Everything after the
   *  anchors (the prior, the beat, the score, the orchestra, a recording) is the same. */
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

/** MediaPipe's label for the player's hand, given the mirror convention. */
function labelFor(hand: Exclude<ConductorHand, 'auto'>, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The score's first marked tempo (bpm), if it marks one. */
function firstTempo(doc: ScoreDoc): number | null {
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
    /** `markLevel: auto`: the level held (its ratio set has this beats-per-bar). */
    let levelHold: LevelHold | null = null;
    let levelBpb = 0;
    /** The document's first tempo mark (bpm), seeding the body detector's period. */
    let docBpm: number | null = null;
    /** Fermata hold: the beat we stopped at, and the anchor count when we stopped (a
     *  NEW stroke — one more anchor — releases it). */
    let fermataAt: number | null = null;
    let fermataAnchors = 0;
    /** The fermata last released: the beat still sits on it, and must not stop there again. */
    let fermataReleased: number | null = null;
    /** The hands frame seen on the previous tick: the same object again is not a new
     *  observation (#225). */
    let lastFrame: HandsFrame | undefined;
    /** The body frame seen on the previous tick, and the last one fed (with its time). */
    let lastBodyFrame: BodyFrame | undefined;
    let lastBody: { t: number; frame: BodyFrame } | null = null;
    /** What the follower was built for: a change re-creates it (the body's joints are
     *  fixed at construction), keeping the beat where it is. */
    let coreKey = '';
    /** The score tempo (bpm) the body follower was built at (null: the priors' default). */
    let seededBpm: number | null = null;
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
      levelHold = null;
      lastPt = null;
      lastBody = null;
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
      docBpm = null;
      fermataAt = null;
      fermataReleased = null;
      const doc = readScoreDoc(raw);
      if (!doc) return;
      fermatas = [...doc.fermatas].sort((a, b) => a - b);
      docMeter = (beat) => beatsPerBarAt(doc, beat);
      docTempo = (beat) => tempoAt(doc, beat);
      docSigStart = (beat) => timeSignatureAt(doc, beat).beat;
      docBpm = firstTempo(doc);
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

    const emit = (time: MusicalTime, bpm: number, dyn: number, art: number, enabled: boolean, c: Params, level = 1) => ({
      time,
      beat: beatOut,
      bpm,
      velocityScale: enabled ? c.dynMin + (c.dynMax - c.dynMin) * clamp01(dyn) : 0,
      phase: time.phase,
      dynamics: dyn,
      articulation: art,
      confidence: time.confidence,
      enabled,
      leadsScore: enabled && c.conducts === 'score',
      recordingTime: enabled && c.conducts === 'recording' ? time : undefined,
      level,
    });

    /** The piece's beats per stroke `k` (see the header). `auto` relates the strokes to
     *  the marked tempo at the position, conducting the score only. */
    const markRatio = (c: Params, s: IctusState | null, t: number, bpb: number): number => {
      if (c.markLevel === 'beat') return 1;
      if (c.markLevel === 'half') return 2;
      if (c.markLevel === 'bar') return bpb;
      if (!levelHold || levelBpb !== bpb) {
        // A new meter: a held bar stays a bar, a held beat stays a beat.
        const held = levelHold?.ratio() ?? null;
        levelHold = createLevelHold({ ratios: conductorRatios(bpb), captureRange: MARK_LEVEL_CAPTURE, persistS: MARK_LEVEL_PERSIST_S, sticky: true });
        if (held !== null) levelHold.set(held === levelBpb && held > 2 ? bpb : held);
        levelBpb = bpb;
      }
      const marked = c.conducts === 'score' && docTempo ? docTempo(beatOut) : null;
      if (s && marked !== null && marked > 0) {
        const trusted = s.state === 'running' && s.confidence >= c.fallbackBelowConfidence && Number.isFinite(s.period) && s.period > 0;
        levelHold.step(t, trusted ? s.period : NaN, 60 / marked);
      }
      return levelHold.ratio() ?? 1;
    };
    /** The tempo the body follower is seeded at: the score's first mark, at the stated
     *  level (null without a score, or reading the hands). */
    const bodySeed = (c: Params): number | null => {
      if (c.source !== 'body' || docBpm === null) return null;
      const k = c.markLevel === 'half' ? 2 : c.markLevel === 'bar' ? (docMeter ? docMeter(0) : c.beatsPerBar) : 1;
      return docBpm / k;
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        resolveDoc(inputs.doc);
        const beatsPerBar = docMeter ? docMeter(beatOut) : c.beatsPerBar;
        if (!c.enabled) {
          if (wasEnabled) {
            resetFollower();
            beatOut = 0;
            fermataAt = null;
            fermataReleased = null;
            wasEnabled = false;
          }
          levelHold = null;
          return emit(idleTime(ctx.time, beatsPerBar), 0, 0, 0.5, false, c);
        }
        // The hand's follower reads `hand` and `point` live; the body's detector fixes its
        // joints when built, so a change of side or point (or of source) re-creates it.
        // The beat stays where it is: the new follower waits for its first stroke.
        const key = c.source === 'body' ? `body:${c.bodyPoint}:${c.hand}:${c.mirrorX}` : 'hands';
        // The level confirms itself from the first joint followed (A2, note 5 on #386), so
        // the body follower starts at the score's marked tempo: the detector's period and
        // both priors'. The piece loads only once conducting is on, so it usually arrives
        // after the follower was built; until the first stroke, a new tempo rebuilds it.
        if (ictus && c.source === 'body' && bodySeed(c) !== seededBpm && ictus.state().anchors === 0) resetFollower();
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

        // 1. Feed the tracked point (or free-run when no hand is in frame).
        //    Only a NEW camera frame is an observation (#225): the engine ticks at the
        //    display rate over a slower camera, and the same frame fed twice at two
        //    tick times flattens the detector's parabolic fit and biases the ictus. The
        //    sample time is the frame's capture time when the source stamped one
        //    (#226), else the tick time.
        // The same object again, or a distinct copy carrying the same stamp (a replayed
        // recording stores every tick, so a camera frame comes back as two parsed
        // copies), is not a new observation.
        const isFresh = (f: { t?: number } | undefined, prev: { t?: number } | undefined): boolean =>
          f !== prev && !(!!f && !!prev && f.t !== undefined && f.t === prev.t);
        let s: IctusState;
        if (c.source === 'body') {
          const body = inputs.body as BodyFrame | undefined;
          const fresh = isFresh(body, lastBodyFrame);
          lastBodyFrame = body;
          const t = frameTime(body, ctx);
          if (body && fresh && !(lastBody && t < lastBody.t + MIN_SAMPLE_SPACING)) {
            // A frame with nobody in it is fed too (no channels): the detector needs to
            // see the time pass to call a joint lost.
            if (lastBody) {
              const qom = bodyQuantityOfMotion(lastBody.frame, body, t - lastBody.t);
              if (qom !== undefined) noteSpeed(qom, t - lastBody.t);
            }
            lastBody = { t, frame: body };
            s = ictus.feedFrame(bodyChannelFrame(body, t, c.hand));
          } else {
            s = ictus.advance(ctx.time);
          }
        } else {
          const frame = inputs.hands as HandsFrame | undefined;
          const fresh = isFresh(frame, lastFrame);
          lastFrame = frame;
          const hand = frame && fresh ? pickHand(frame, c) : undefined;
          // The sample time: the frame's capture stamp in real time at speed 1, else the
          // tick. A sample that would not advance the detector (a stamped frame arriving
          // behind the last tick-timed one, right after a slot swap) is skipped rather
          // than given an invented time.
          const t = frameTime(frame, ctx);
          if (hand && frame && frame.height > 0 && !(lastPt && t < lastPt.t + MIN_SAMPLE_SPACING)) {
            const kp = hand.keypoints[c.point === 'wrist' ? LM.wrist : LM.index_tip];
            const pt = { t, x: kp.x / frame.height, y: kp.y / frame.height };
            if (lastPt && pt.t > lastPt.t) noteSpeed(Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) / (pt.t - lastPt.t), pt.t - lastPt.t);
            lastPt = pt;
            s = ictus.feed(pt);
          } else {
            s = ictus.advance(ctx.time);
          }
        }

        // 2. Blend the inferred tempo with the speed fallback by confidence; integrate. The
        //    strokes' tempo and phase are scaled to the piece's beats by the level `k`.
        const k = markRatio(c, s, ctx.time, beatsPerBar);
        const fallbackBpm = c.fallbackBpmMin + (c.fallbackBpmMax - c.fallbackBpmMin) * (speedEnv > 0 ? clamp01(speedEw / speedEnv) : 0);
        let bpm: number;
        // A fermata releases on the NEXT stroke after it was reached.
        if (fermataAt !== null && s.anchors > fermataAnchors) {
          fermataReleased = fermataAt;
          fermataAt = null;
        }
        if (fermataAt !== null) {
          bpm = 0;
        } else if (s.state === 'hold' || s.anchors === 0) {
          // Holding, or no stroke seen yet (the preparatory beat has not come): frozen.
          bpm = 0;
        } else {
          const w = s.state === 'running' && c.fallbackBelowConfidence > 0 ? clamp01(s.confidence / c.fallbackBelowConfidence) : s.state === 'running' ? 1 : 0;
          bpm = w * s.tempo * k + (1 - w) * fallbackBpm;
          const advanced = beatOut + (bpm / 60) * ctx.dt;
          // 3. Phase servo: converge onto the inferred beat over `servoBeats`, never
          //    below where the beat already was (a rewind would retrigger a note).
          let corrected = advanced;
          if (w > 0 && Number.isFinite(s.period) && s.period > 0) {
            // A stroke lands on a multiple of `k` beats, counted from the time
            // signature's start. The horizon stays in strokes (`s.period`).
            const ref = k === 1 ? 0 : docSigStart ? docSigStart(beatOut) : 0;
            const err = k === 1 ? wrapPhase(advanced - beatAt(s, ctx.time)) : wrapPhase((advanced - ref) / k - beatAt(s, ctx.time)) * k;
            corrected = advanced - w * err * Math.min(1, ctx.dt / (c.servoBeats * s.period));
          }
          let next = Math.max(beatOut, corrected);
          // 4. Fermatas: stop exactly on one the beat would cross, and hold there.
          for (const f of fermatas) {
            // One the beat sits on counts too (a fermata at beat 0, #393), unless just released.
            if ((f > beatOut || (f === beatOut && f !== fermataReleased)) && f <= next) {
              next = f;
              fermataAt = f;
              fermataAnchors = s.anchors;
              bpm = 0;
              break;
            }
          }
          beatOut = next;
        }

        const wholeBeat = Math.floor(beatOut);
        const bpb = docMeter ? docMeter(beatOut) : c.beatsPerBar;
        const time: MusicalTime = {
          t: ctx.time,
          beat: beatOut,
          phase: beatOut - wholeBeat,
          tempo: bpm,
          period: bpm > 0 ? 60 / bpm : Infinity,
          confidence: s.confidence,
          nextBeatAt: bpm > 0 ? ctx.time + ((1 - (beatOut - wholeBeat)) * 60) / bpm : Infinity,
          beatsPerBar: bpb,
          beatInBar: ((wholeBeat % bpb) + bpb) % bpb,
          // A fermata reads as a hold to every consumer (the HUD, the panel, the score).
          state: fermataAt !== null ? 'hold' : s.state,
          anchors: s.anchors,
          lastAnchorAt: s.lastAnchorAt,
          leadOffset: s.leadOffset,
        };
        return emit(time, bpm, s.dynamics, s.articulation, true, c, k);
      },
      dispose() {
        ictus = null;
      },
    };
  },
});
