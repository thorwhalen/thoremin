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
export type { ConductorTransportReading } from './conductor_transport';
export { firstTempo } from './conductor_doc';
import { ConductorDialSchema, MusicalTimeSchema, type ConductorDialParams } from './conductor.schema';
import { createConductorFollower } from './conductor_follower';
export { CONDUCTOR_HANDS, CONDUCTOR_POINTS, CONDUCTOR_TARGETS, CONDUCTOR_SOURCES, CONDUCTOR_MARK_LEVELS, CONDUCTOR_EXPRESSION_SOURCES, MARK_LEVEL_CAPTURE, MARK_LEVEL_PERSIST_S, ConductorTransportSchema, ConductorDancerSchema, DEFAULT_CONDUCTOR_DANCER, ConductorHandGestureSchema, DEFAULT_CONDUCTOR_HAND_GESTURE, DEFAULT_CONDUCTOR_TRANSPORT, ConductorDialSchema, DEFAULT_CONDUCTOR_DIAL, MusicalTimeSchema, conductorReadsTwoHands, LeadOffsetsSchema, readLeadOffsets } from './conductor.schema';
export type { ConductorHand, ConductorPoint, ConductorTarget, ConductorSource, ConductorMarkLevel, ConductorExpressionSource, ConductorTransport, ConductorDancer, ConductorHandGesture, ConductorDialParams } from './conductor.schema';
export { CONDUCTOR_BODY_POINTS, type ConductorBodyPoint } from './conductor_body';
export { ARTICULATION_SOURCES, type ArticulationSource } from '@thoremin/ictus';

export const conductorNode = defineNode<ConductorDialParams>({
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
  params: ConductorDialSchema,
  make(p) {
    const f = createConductorFollower(p);
    return {
      process(inputs, ctx: NodeContext) {
        const c = f.resolveConfig(inputs.config);
        f.resolveDoc(inputs.doc);
        const beatsPerBar = f.beatsPerBar(c);
        if (!c.enabled) return f.idleTick(ctx, c, beatsPerBar);
        if (c.source === 'dancer') return f.danceTick(inputs, ctx, c);
        f.leaveDance();
        const ic = f.prepareFollower(c, ctx);
        const fed = c.source === 'body' ? f.feedBody(inputs, ctx, c, ic) : f.feedHands(inputs, ctx, c, ic);
        // 1b. Expression (#378): from the beat's source, or from the other one through a
        //     follower of its own whose strokes only shape; reading the body, the strokes'
        //     dynamics are blended with its motion and its arm's reach, each per player.
        const expression = f.shape(inputs, ctx, c, fed.s);
        const s = fed.stopped ? f.cutOff(ic) : fed.s;
        // The strokes' tempo and phase are scaled to the piece's beats by the level `k`.
        const k = f.markRatio(c, s, ctx.time, beatsPerBar);
        const grid = f.gridFor(k);
        const bodyHold = f.bodyHolding();
        f.place(fed, s, grid);
        const bpm = f.advanceBeat(c, ctx, s, k, grid, bodyHold);
        return f.emit({ time: f.timeOf(ctx, c, s, bpm, bodyHold), bpm, dynamics: expression.dynamics, articulation: expression.articulation, enabled: true, c, level: k });
      },
      dispose: f.dispose,
    };
  },
});
