/**
 * The conductor's follower core (#557, #600 S7): the state the `conductor` node keeps between
 * ticks and the steps one tick is made of, as a factory, so the node's `make()` is only wiring
 * (`conductor.ts`: which step runs, in which order). #593 moved the expression, the score
 * document and the fermata state out of `make()`, #594 the dance lead and the transport; this is
 * the rest: the follower (ictus) and its re-creation, the speed fallback, feeding the hands or the
 * body, the mark level, the beat's advance (fermatas, the body's hold, the phase servo), the cut
 * off, and the output.
 *
 * Moved verbatim: the conducting golden (`test/conductor_golden.test.ts`) is byte-identical.
 */
import type { NodeContext } from '@thoremin/dag';
import { beatAt, conductorRatios, createIctus, createImpactDetector, createLeadCorrector, createFinalRitard, createLevelHold, wrapPhase, UNKNOWN_PULSE, type Ictus, type IctusState, type LevelHold, type MusicalTime, type PulseState } from '@thoremin/ictus';
import type { BodyFrame, HandsFrame } from '@thoremin/sdk/nodes/domain';
import { captureTime } from '@thoremin/sdk/timing/tracker';
import { clamp01 } from '@thoremin/sdk/features/math';
import { handPoint, isFresh, MIN_SAMPLE_SPACING, pickHand } from './conductor_hands';
import { createExpressionShaper } from './conductor_shaping';
import { createDocContext } from './conductor_doc';
import { createDanceState } from './conductor_dance';
import { createBodyTransport, rulesOn, START_BPM, START_EPS, type Grid, type StartFlags } from './conductor_transport';
import { bodyChannelFrame, bodyQuantityOfMotion, conductorBodyJoints } from './conductor_body';
import { MARK_LEVEL_CAPTURE, MARK_LEVEL_PERSIST_S, ConductorDialSchema, readLeadOffsets, type ConductorDialParams } from './conductor.schema';

/** The live `config` port: a partial override of the params (the dial's value). */
const ConfigOverride = ConductorDialSchema.partial();

/** The release of a fermata is a stroke at least this many periods after it was reached. */
const FERMATA_RELEASE_PERIODS = 0.5;

/** What one tick's output is built from (`emit`): the time, the tempo it advanced at, the
 *  expression, and the few facts that decide `leadsScore` / `recordingTime` / `level`. */
export interface EmitArgs {
  time: MusicalTime;
  bpm: number;
  dynamics: number;
  articulation: number;
  enabled: boolean;
  c: ConductorDialParams;
  /** The piece's beats per stroke (a dancer's: its cycle ratio). */
  level?: number;
  /** False before a dancer's piece has started: the score stays silent. */
  sounding?: boolean;
}

/** What feeding the follower one tick produced: its state, and what the body's transport
 *  called (a cut-off, a start, the release of a hold). */
export interface Fed extends StartFlags {
  s: IctusState;
}


/** The follower core of one `conductor` node instance (`p`: its build-time params). */
export function createConductorFollower(p: ConductorDialParams) {
  let ictus: Ictus | null = null;
  let lastConfigRef: unknown = undefined;
  let cfg: ConductorDialParams = p;
  /** The beat the score reads: integrated here, phase-servoed onto the ictus. */
  let beatOut = 0;
  let wasEnabled = false;
  /** The loaded piece: its fermatas, meter, tempo, bar lines, first tempo, last onset and length. */
  const doc = createDocContext();
  /** `markLevel: auto`: the level held (its ratio set has this beats-per-bar). */
  let levelHold: LevelHold | null = null;
  let levelBpb = 0;
  /** Fermata hold. `at`: the beat we stopped at; `anchors`: the anchor count when we
   *  stopped (a NEW stroke, one more anchor, releases it); `t` and `period`: when the
   *  fermata was reached and the stroke period then (the release is a stroke whose own
   *  time is at least half a period later: the stroke that LANDS on the fermata is often
   *  confirmed after the beat got there, as one that ends in a stop is confirmed late,
   *  #377; counting it as the release would play straight through); `released`: the
   *  fermata last released, which the beat still sits on and must not stop at again. */
  const fermata: { at: number | null; anchors: number; t: number; period: number; released: number | null } = { at: null, anchors: 0, t: -Infinity, period: 0, released: null };
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
  /** The body's transport (#377) and the start it leaves behind (`conductor_transport.ts`):
   *  present while reading the body with the rules on. */
  const tp = createBodyTransport();
  /** The expression's state (#378, #457) lives in its own factory (`conductor_shaping.ts`). */
  const expr = createExpressionShaper();
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
    confidentBpm = null;
    // The expression's own frame clocks restart with the follower's (a replay from the top).
    expr.restartClocks();
    lastPt = null;
    lastBody = null;
    lead.reset();
    seededBpm = null;
    speedEw = 0;
    speedEnv = 0;
  };

  /** The final-ritard curve for the current dial values (rebuilt only when they change). */
  let ritardKey = '';
  let ritard = createFinalRitard();
  const finalRitard = (c: ConductorDialParams) => {
    const key = `${c.ritardBeats}|${c.ritardRatio}`;
    if (key !== ritardKey) {
      ritardKey = key;
      ritard = createFinalRitard({ beats: c.ritardBeats, finalRatio: c.ritardRatio });
    }
    return ritard;
  };
  /** The last tempo (bpm) the gesture was confident of; null before one. */
  let confidentBpm: number | null = null;

  const resolveDoc = (raw: unknown): void => {
    if (!doc.resolve(raw)) return;
    confidentBpm = null;
    fermata.at = null;
    fermata.released = null;
  };

  const resolveConfig = (raw: unknown): ConductorDialParams => {
    if (raw === lastConfigRef) return cfg;
    lastConfigRef = raw;
    if (raw && typeof raw === 'object') {
      const parsed = ConfigOverride.safeParse(raw);
      if (parsed.success) {
        const overrides = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
        cfg = { ...p, ...overrides } as ConductorDialParams;
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
    leadsScore: enabled && sounding && c.conducts === 'score' && !tp.silences(time.anchors),
    // A dancer leading the recording is the song following the dancer's pulse (the pace
    // law, `song-pace`), not the beat servo on a time derived from it.
    recordingTime: enabled && c.conducts === 'recording' && c.source !== 'dancer' ? time : undefined,
    level,
    transport: enabled ? tp.reading : 'off',
  });

  /** The piece's beats per stroke `k` (see the header). `auto` relates the strokes to
   *  the marked tempo at the position, conducting the score only. */
  const markRatio = (c: ConductorDialParams, s: IctusState | null, t: number, bpb: number): number => {
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
    const marked = doc.tempo ? doc.tempo(beatOut) : null;
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
    const into = beat - (doc.barStart ? doc.barStart(beat) : 0);
    return Math.floor((((into % bpb) + bpb) % bpb) + 1e-9);
  };
  /** The tempo the body follower is seeded at: the score's first mark, at the stated
   *  level (null without a score, or reading the hands). */
  const bodySeed = (c: ConductorDialParams): number | null => {
    // With the transport rules the start is the ready pose and the upbeat, and the beat
    // moves at the marked tempo until the second stroke (`startBeat`); seeding the prior
    // too would hand the detector the marked period at the downbeat, and a piece marked
    // at twice the conductor's tempo then has it take each stroke's rebound for a stroke
    // (measured on A1's fixture against a score at 160 bpm).
    if (c.source !== 'body' || doc.bpm === null || c.transport.rules) return null;
    const k = c.markLevel === 'half' ? 2 : c.markLevel === 'bar' ? (doc.meter ? doc.meter(0) : c.beatsPerBar) : 1;
    return doc.bpm / k;
  };

  /** A dancer leads (#380): ictus's dance lead owns the beat (the loose law: it starts on
   *  a cycle, follows inside the clamp, holds and never stops while the dancer dances).
   *  A written fermata holds for one dancer cycle and the piece loops at its end (#463;
   *  the expression keeps reading the dancer's cycles through a hold, so a dancer's
   *  movement can swell a held chord); the transport rules are a conductor's. The beat
   *  goes on from where the last leader left it. */
  const dance = createDanceState();
  const danceTick = (inputs: Record<string, unknown>, ctx: NodeContext, c: ConductorDialParams) => {
    tp.drop();
    levelHold = null;
    tp.startBeat = null;
    fermata.at = null;
    // The hand's or the body's follower is not kept across a dancer: back to it, it
    // starts fresh and waits for a first stroke.
    if (ictus) resetFollower();
    const lead = dance.enter(beatOut);
    wasEnabled = true;
    const raw = inputs.pulse as PulseState | undefined;
    const pulse = raw && typeof raw === 'object' && typeof raw.period === 'number' ? raw : UNKNOWN_PULSE;
    const marked = doc.tempo?.(beatOut) ?? c.dancer.bpm;
    // The piece's written fermatas hold for one dancer cycle, and its end loops to the top
    // on a cycle start (#463): the dance lead's rules 6 and 7.
    const d = lead.step({ t: ctx.time, pulse, marked, ref: doc.barStart ? doc.barStart(beatOut) : 0, range: c.dancer.range, phaseOffset: c.dancer.phaseOffset, fermatas: doc.fermatas, top: doc.sigStart ? doc.sigStart(0) : 0, ...(doc.length !== null ? { end: doc.length } : {}) });
    beatOut = d.beat;
    // A cycle the follower fitted is the dancer's "stroke" for the expression (A6's note).
    const expression = expr.shape(inputs, ctx, c, { dynamics: 0.5, articulation: 0.5, anchor: dance.cycle(pulse) });
    const bpm = d.started ? d.tempo : 0;
    const wholeBeat = Math.floor(beatOut);
    const bpb = doc.meter ? doc.meter(beatOut) : c.beatsPerBar;
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
      ...(d.started && lead.wrap() ? { wrap: lead.wrap()! } : {}),
    };
    return { ...emit({ time, bpm, dynamics: expression.dynamics, articulation: expression.articulation, enabled: true, c, level: Number.isFinite(d.ratio) ? d.ratio : 1, sounding: d.started }), dance: d.mode };
  };

  /** The conductor is off: the follower, the transport and the dancer's lead are let go,
   *  and the output is the idle time (a frozen beat, a silent score). */
  const idleTick = (ctx: NodeContext, c: ConductorDialParams, beatsPerBar: number) => {
    if (wasEnabled) {
      resetFollower();
      beatOut = 0;
      fermata.at = null;
      fermata.released = null;
      wasEnabled = false;
    }
    levelHold = null;
    tp.idle();
    dance.forget();
    expr.reset();
    return emit({ time: idleTime(ctx.time, beatsPerBar), bpm: 0, dynamics: 0, articulation: 0.5, enabled: false, c });
  };

  /** The follower for this tick, re-created when the source, the point or the side
   *  changed (the body's detector fixes its joints when built) and made on first use. The
   *  beat stays where it is: a new follower waits for its first stroke. */
  const prepareFollower = (c: ConductorDialParams, ctx: NodeContext): Ictus => {
    const key = c.source === 'body' ? `body:${c.bodyPoint}:${c.hand}:${c.mirrorX}` : 'hands';
    // The level confirms itself from the first joint followed (A2, note 5 on #386), so
    // the body follower starts at the score's marked tempo: the detector's period and
    // both priors'. The piece loads only once conducting is on, so it usually arrives
    // after the follower was built; until the first stroke, a new tempo rebuilds it.
    if (ictus && c.source === 'body' && bodySeed(c) !== seededBpm && ictus.state().anchors === 0) resetFollower();
    tp.prepare(rulesOn(c.source, c.transport.rules, c.bodyPoint), c.transport, ctx.time, () => ictus !== null && ictus.state().state === 'running');
    if (ictus && key !== coreKey) {
      resetFollower();
      // A held fermata stays held, and the new follower's first stroke releases it
      // (its anchor count starts again from 0).
      fermata.anchors = 0;
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

  // 1. Feed the tracked point (or free-run when no hand is in frame).
  //    Only a NEW camera frame is an observation (#225): the engine ticks at the
  //    display rate over a slower camera, and the same frame fed twice at two
  //    tick times flattens the detector's parabolic fit and biases the ictus. The
  //    sample time is the frame's capture time when the source stamped one
  //    (#226), else the tick time.
  const feedBody = (inputs: Record<string, unknown>, ctx: NodeContext, c: ConductorDialParams, ic: Ictus): Fed => {
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
    const cues = tp.cues(body, t, c.hand);
    let flags = { stopped: false, started: false, released: false };
    if (tp.active()) {
      const tr = tp.step(inputs, ic, t, a, cues);
      if (tr.released) fermata.anchors = 0;
      accept = tr.accept;
      flags = { stopped: tr.stopped, started: tr.started, released: tr.released };
    }
    return { s: a && accept ? ic.feedAnchor(a) : ic.advance(t), ...flags };
  };

  const feedHands = (inputs: Record<string, unknown>, ctx: NodeContext, c: ConductorDialParams, ic: Ictus): Fed => {
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
    fermata.anchors = 0;
    if (doc.lastOnset !== null && beatOut >= doc.lastOnset) {
      beatOut = 0;
      fermata.at = null;
      fermata.released = null;
      tp.afterStop = false;
    } else tp.afterStop = true;
    return s;
  };

  /** The beat at or after `b` (`ceil`) or nearest it (`round`) that a stroke lands on, for
   *  strokes `k` beats apart: a multiple of `k`, counted from the time signature's start
   *  (the servo's reference). */
  const gridFor = (k: number) => (b: number, snap: (x: number) => number): number => {
    const ref = k === 1 || !doc.barStart ? 0 : doc.barStart(b);
    return ref + k * snap((b - ref) / k);
  };

  /** The beat reached a written fermata: stop on it and hold there. */
  const stopAtFermata = (f: number, s: IctusState, ctx: NodeContext): void => {
    fermata.at = f;
    fermata.anchors = s.anchors;
    fermata.t = ctx.time;
    fermata.period = Number.isFinite(s.period) && s.period > 0 ? s.period : 0;
  };

  /** The body holding (raised and still, no stroke): the beat goes on at the tempo it
   *  had, but no further than just short of the next stroke's beat, and holds there.
   *  Never frozen between two: a release from a fraction of a stroke has no right
   *  answer (the servo would pick a side by rounding), and the beat the conductor
   *  last gave is the one that sustains. Returns the tempo it advanced at. */
  const holdBeat = (ctx: NodeContext, s: IctusState, grid: Grid): number => {
    const cap = grid(beatOut, Math.ceil) - START_EPS;
    let next = Math.min(beatOut + (tp.holdBpm / 60) * ctx.dt, Math.max(beatOut, cap));
    // A written fermata on the way stops it there, as when running.
    const f = doc.fermatas.find((x) => x > beatOut && x <= next);
    if (f !== undefined) {
      next = f;
      stopAtFermata(f, s, ctx);
    }
    const bpm = next > beatOut && f === undefined ? tp.holdBpm : 0;
    beatOut = next;
    return bpm;
  };

  /** Running: the inferred tempo blended with the speed fallback by confidence (`w`),
   *  integrated, phase-servoed onto the inferred beat and stopped on any fermata it would
   *  cross. Returns the tempo it advanced at. */
  const runBeat = (c: ConductorDialParams, ctx: NodeContext, s: IctusState, k: number, grid: Grid, speedBpm: number): number => {
    const w = s.state === 'running' && c.fallbackBelowConfidence > 0 ? clamp01(s.confidence / c.fallbackBelowConfidence) : s.state === 'running' ? 1 : 0;
    // The tempo the gesture was last sure of: the start of a final ritard (#333).
    if (w >= 1 && s.tempo * k > 0) confidentBpm = s.tempo * k;
    // What the tempo does where the gesture says nothing: the speed fallback, or, in the last
    // beats of a piece with the KTH prior chosen, a performer's final ritard from the last
    // confident tempo (a confident gesture, w = 1, overrides it either way).
    const ritardBpm = c.tempoPrior === 'kth-final-ritard' && doc.lastOnset !== null ? finalRitard(c).tempoAt(beatOut, doc.lastOnset, confidentBpm ?? doc.tempo?.(beatOut) ?? speedBpm) : null;
    const fallbackBpm = ritardBpm ?? speedBpm;
    let bpm = tp.startBeat !== null ? (tp.startBpm ?? doc.tempo?.(beatOut) ?? START_BPM) : w * s.tempo * k + (1 - w) * fallbackBpm;
    const advanced = beatOut + (bpm / 60) * ctx.dt;
    // 3. Phase servo: converge onto the inferred beat over `servoBeats`, never
    //    below where the beat already was (a rewind would retrigger a note).
    let corrected = advanced;
    if (w > 0 && Number.isFinite(s.period) && s.period > 0) {
      // A stroke lands on a multiple of `k` beats, counted from the time
      // signature's start. The horizon stays in strokes (`s.period`).
      const ref = k === 1 ? 0 : doc.barStart ? doc.barStart(beatOut) : 0;
      const err = k === 1 ? wrapPhase(advanced - beatAt(s, ctx.time)) : wrapPhase((advanced - ref) / k - beatAt(s, ctx.time)) * k;
      corrected = advanced - w * err * Math.min(1, ctx.dt / (c.servoBeats * s.period));
    }
    let next = Math.max(beatOut, corrected);
    if (tp.startBeat !== null) next = Math.max(beatOut, Math.min(next, grid(tp.startBeat + START_EPS, Math.ceil) - START_EPS));
    // The stroke overdue and the body still: the next stroke's beat waits for it.
    if (tp.waiting && tp.strokeBeat !== null) next = Math.max(beatOut, Math.min(next, tp.strokeBeat + k - START_EPS));
    // 4. Fermatas: stop exactly on one the beat would cross, and hold there.
    for (const f of doc.fermatas) {
      // One the beat sits on counts too (a fermata at beat 0, #393), unless just released.
      if ((f > beatOut || (f === beatOut && f !== fermata.released)) && f <= next) {
        next = f;
        stopAtFermata(f, s, ctx);
        bpm = 0;
        break;
      }
    }
    beatOut = next;
    if (bpm > 0) tp.holdBpm = bpm;
    return bpm;
  };

  /** 2. The tempo this tick advanced the beat at, and the beat moved: a written fermata
   *  holds (released by the next stroke), else the body's hold, else frozen before a first
   *  stroke or while holding, else running. */
  const advanceBeat = (c: ConductorDialParams, ctx: NodeContext, s: IctusState, k: number, grid: Grid, bodyHold: boolean): number => {
    const fallbackBpm = c.fallbackBpmMin + (c.fallbackBpmMax - c.fallbackBpmMin) * (speedEnv > 0 ? clamp01(speedEw / speedEnv) : 0);
    // A fermata releases on the NEXT stroke after it was reached. The stroke that landed
    // on it does not (`fermata.t`): its anchor is confirmed a few frames after the beat got
    // there, hands and body alike (#449).
    const landedOnIt = s.lastAnchorAt !== undefined && s.lastAnchorAt < fermata.t + FERMATA_RELEASE_PERIODS * fermata.period;
    if (fermata.at !== null && s.anchors > fermata.anchors && !landedOnIt) {
      fermata.released = fermata.at;
      fermata.at = null;
    }
    if (fermata.at !== null) return 0;
    if (bodyHold) return holdBeat(ctx, s, grid);
    // Holding, or no stroke seen yet (the preparatory beat has not come): frozen.
    if (s.state === 'hold' || s.anchors === 0) return 0;
    return runBeat(c, ctx, s, k, grid, fallbackBpm);
  };

  /** The time this tick reports, from the follower's state and the beat as moved. */
  const timeOf = (ctx: NodeContext, c: ConductorDialParams, s: IctusState, bpm: number, bodyHold: boolean): MusicalTime => {
    const wholeBeat = Math.floor(beatOut);
    const bpb = doc.meter ? doc.meter(beatOut) : c.beatsPerBar;
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
      state: fermata.at !== null || bodyHold ? 'hold' : s.state,
      anchors: s.anchors,
      lastAnchorAt: s.lastAnchorAt,
      leadOffset: s.leadOffset,
    };
  };

  return {
    /** The config this tick: the dial's override over the build-time params (cached by reference). */
    resolveConfig,
    /** Take a new score document (its meter, tempo, fermatas). */
    resolveDoc,
    /** The beats per bar at the current beat (the score's meter, else the dial's). */
    beatsPerBar: (c: ConductorDialParams): number => (doc.meter ? doc.meter(beatOut) : c.beatsPerBar),
    idleTick,
    danceTick,
    /** A tick that is not the dancer's: the dance lead is left. */
    leaveDance: (): void => dance.leave(),
    prepareFollower,
    feedBody,
    feedHands,
    /** The expression this tick (`conductor_shaping.ts`), from the fed state. */
    shape: (inputs: Record<string, unknown>, ctx: NodeContext, c: ConductorDialParams, s: IctusState) => expr.shape(inputs, ctx, c, s),
    cutOff,
    markRatio,
    gridFor,
    /** Whether the body's transport is holding (raised and still, no stroke). */
    bodyHolding: (): boolean => tp.phase() === 'holding',
    /** Place the beat for the transport (a start, a release), before it advances. */
    place: (fed: Fed, s: IctusState, grid: Grid): void => {
      beatOut = tp.place(fed, s, grid, beatOut, fermata);
    },
    advanceBeat,
    timeOf,
    emit,
    dispose: (): void => {
      ictus = null;
    },
  };
}

export type ConductorFollower = ReturnType<typeof createConductorFollower>;
