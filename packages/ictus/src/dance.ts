/**
 * The dance lead: a score's beat that follows a dancer's pulse (#380, body-movement A8,
 * "Dance the orchestra"; the design's §3.7).
 *
 * The pace controller (`pace.ts`) makes a SONG follow the dancer by changing its playback
 * rate. A score has no recording to stretch: its beat is ours to integrate, so this module
 * owns the beat itself, and the conductor node plays the score and the orchestra on it as
 * it does on a conductor's. The law is the dancer's loose one, not a conductor's strict
 * one (A5's note on #386: a cut-off is no dancer's gesture):
 *
 * 1. **The level.** One dancer cycle is `k` score beats, `k` from the dancer's integer
 *    set ({@link paceRatios}: `1..8`, `1/2..1/8`, never an octave fold), related to the
 *    score's MARKED tempo at the position by ictus's one level relation
 *    ({@link createLevelHold}, #376): the ratio whose matching tempo is nearest the
 *    marked one, followed only once it has persisted `persistS` (the red-noise guard of
 *    #339), and none further than `captureRange` from it.
 * 2. **The start.** Nothing sounds until a relation is followed; then the piece starts on
 *    the dancer's next cycle start (shifted by `phaseOffset` beats), on a beat of the
 *    stroke grid (a multiple of `k` from `ref`, the time signature's start). So a dancer
 *    whose stride repeats once a bar (the Que Calor dancer, `k` = 4 in 4/4) has the
 *    score's bars start on their cycles from the first one.
 * 3. **The tempo** follows the matching tempo, smoothed (`smoothS`), and never leaves
 *    `marked * (1 +- range)`: the score keeps its own character, the dancer only bends it.
 *    It follows the dancer's PERIOD only once the pulse is sure of it (`tempoConfidence`),
 *    the piece has followed `tempoAfterCycles` cycles, or the marked tempo has let the
 *    dancer get `handoverPhaseError` beats off the grid; until then it plays the marked
 *    tempo and the phase law alone keeps the cycle on the grid (#464). Handed over, it
 *    stays handed over until the lead is reset. A trusted pulse is
 *    not yet a settled one: on the Que Calor replay the follower's first period is 1.75 s
 *    at confidence 0.3 and settles to 1.95 s two cycles after the start, and a score that
 *    followed the first estimate ran 7 % fast for those cycles and landed up to 0.6 beat
 *    off the dancer's steps (`test/dance_orchestra.test.ts`); the marked tempo was nearer.
 *    The phase-error handover is for a dancer the marked tempo does NOT suit (a steady step
 *    8 to 10 % off at a modest confidence): without it the error built up over the three
 *    cycles, and at the clamp's edge (where no correction is left) stayed. With it, such a
 *    dancer is at most about 0.2 beat off, and only a dancer at or past the edge keeps it.
 * 4. **The phase.** The cycle start should stay on the grid: the error, in score beats,
 *    is taken modulo `k` (so a 4-beat cycle keeps the BARS aligned, not just the beats)
 *    and corrected by a tempo factor of `-error / horizonBeats`, at most `maxCorrection`,
 *    inside the clamp. The beat never goes backwards. The dancer's phase is read from the
 *    last cycle the follower FITTED (`lastAnchorAt`, its count `anchors`), carried forward
 *    at the pulse's period (`phaseFrom: anchor`, the default), not from the pulse prior's
 *    phase: on the Que Calor replay the prior's phase wanders a few tenths of a beat
 *    against the fitted cycles, and correcting onto it lost to no correction at all
 *    (`test/dance_orchestra.test.ts`). Carried forward, the next cycle start is predicted
 *    at the last one plus a period, so the piece still starts on time, not when the next
 *    cycle is confirmed (about half a second late).
 * 5. **Never stop.** Once started, an untrusted pulse (the dancer paused, stepped out, or
 *    changed step and the new one has not persisted) HOLDS the tempo: the beat goes on at
 *    the tempo it had. Only switching the conductor off stops the piece.
 *
 * Pure, causal and clock-free like the rest of ictus: the caller passes the time.
 */
import { beatAt, wrapPhase } from './types';
import { PULSE_TRUSTED_CONFIDENCE, type PulseState } from './pulse';
import { createLevelHold, paceRatios } from './level';

export interface DanceLeadOptions {
  /** The clamp around the marked tempo, a fraction (0.1 = within +-10 %). */
  range?: number;
  /** A ratio whose matching tempo is further than this from the marked one (a fraction)
   *  is no relation. Never narrower than `range`. */
  captureRange?: number;
  /** The largest integer ratio tried, both ways. */
  maxRatio?: number;
  /** Pulse confidence below which the tempo holds. */
  trustedConfidence?: number;
  /** Pulse confidence from which the tempo follows the dancer's period (below it, and
   *  before `tempoAfterCycles`, the marked tempo plays, bent by the phase law only). */
  tempoConfidence?: number;
  /** Followed cycles after which the tempo follows the dancer's period whatever the
   *  confidence (a dancer the follower never grows sure of still bends the score). */
  tempoAfterCycles?: number;
  /** Beats off the grid (modulo the ratio) after which the tempo follows the dancer's
   *  period whatever the confidence (the marked tempo is not working). */
  handoverPhaseError?: number;
  /** Seconds a relation must persist before it is followed (the first and every change). */
  persistS?: number;
  /** Time constant of the tempo's smoothing, seconds. */
  smoothS?: number;
  /** The phase error is corrected over about this many score beats. */
  horizonBeats?: number;
  /** The largest phase correction, a fraction of the tempo. */
  maxCorrection?: number;
  /** Where the dancer's cycle start lands, in score beats after a grid beat. */
  phaseOffset?: number;
  /** What the dancer's phase is read from: the last fitted cycle carried forward at the
   *  pulse's period (`anchor`), or the pulse prior's own phase (`prior`). */
  phaseFrom?: DancePhaseSource;
}

export type DancePhaseSource = 'anchor' | 'prior';

export const DANCE_LEAD_DEFAULTS = {
  range: 0.1,
  captureRange: 0.15,
  maxRatio: 8,
  trustedConfidence: PULSE_TRUSTED_CONFIDENCE,
  tempoConfidence: 0.4,
  tempoAfterCycles: 3,
  handoverPhaseError: 0.2,
  persistS: 3,
  smoothS: 1,
  horizonBeats: 4,
  maxCorrection: 0.05,
  phaseOffset: 0,
  phaseFrom: 'anchor',
} as const satisfies Required<DanceLeadOptions>;

/** One step's observation. */
export interface DanceLeadInput {
  /** Now, seconds. */
  t: number;
  /** The dancer's pulse. */
  pulse: PulseState;
  /** The score's marked tempo at the position, bpm (the piece's, or a stated one). */
  marked: number;
  /** The beat the time signature in force starts on: the grid's origin (0 by default). */
  ref?: number;
  /** Live overrides of the options (the player's dial). */
  range?: number;
  phaseOffset?: number;
}

/**
 * - `waiting`: no trusted pulse related to the score, nothing followed yet; silent.
 * - `locking`: a relation is persisting, not yet followed; silent.
 * - `armed`: a relation is followed; the piece starts on the dancer's next cycle start.
 * - `following`: the beat follows the dancer.
 * - `switching`: following, and a different ratio is persisting; the tempo holds.
 * - `holding`: started, and the pulse is untrusted or unrelated; the tempo holds.
 */
export type DanceLeadMode = 'waiting' | 'locking' | 'armed' | 'following' | 'switching' | 'holding';

export interface DanceLeadState {
  t: number;
  mode: DanceLeadMode;
  /** Whether the piece has started (the beat moves). */
  started: boolean;
  /** The score's beat at `t`. */
  beat: number;
  /** The tempo the beat moves at from `t`, bpm (0 before the start). */
  tempo: number;
  /** Score beats per dancer cycle (the followed ratio; NaN before any). */
  ratio: number;
  /** The smoothed tempo factor before the phase correction, a factor of the marked
   *  tempo (NaN before the start). */
  rate: number;
  /** The phase error at `t`, score beats, modulo the ratio: positive = the score is ahead
   *  of the dancer. NaN unless following. */
  phaseError: number;
  /** Dancer cycle starts since the piece started (the start's included). */
  cycles: number;
}

export interface DanceLead {
  step(input: DanceLeadInput): DanceLeadState;
  state(): DanceLeadState;
  /** Forget the dancer and stop; the next start is from `beat` (0 by default). */
  reset(beat?: number): void;
}

/** The dancer's position in cycles at `t` (its fractional part is the phase), or NaN when
 *  it is not known: reading `anchor`, no fitted cycle within the last two periods. */
function cyclesAt(pulse: PulseState, t: number, from: DancePhaseSource): number {
  if (from === 'prior') return beatAt(pulse, t);
  const a = pulse.lastAnchorAt;
  if (a === undefined || !Number.isFinite(a) || t - a >= 2 * pulse.period) return NaN;
  return pulse.anchors + Math.max(0, t - a) / pulse.period;
}

const clampTo = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const START_EPS = 1e-6;

export function createDanceLead(options: DanceLeadOptions = {}): DanceLead {
  const o = { ...DANCE_LEAD_DEFAULTS, ...options };
  const level = createLevelHold({ ratios: paceRatios(o.maxRatio), captureRange: o.captureRange, persistS: o.persistS });
  let beat = 0;
  let started = false;
  let tempo = 0;
  let smoothed = NaN;
  let lastT = NaN;
  /** While armed: the dancer's (offset) cycle count when armed; the start is the next one. */
  let armedCycle: number | null = null;
  let lastCycle = NaN;
  let cycles = 0;
  /** The tempo follows the dancer's period (rule 3); sticky until a reset. */
  let settled = false;
  let last: DanceLeadState = { t: 0, mode: 'waiting', started: false, beat: 0, tempo: 0, ratio: NaN, rate: NaN, phaseError: NaN, cycles: 0 };

  const reset = (from = 0): void => {
    level.reset();
    beat = from;
    started = false;
    tempo = 0;
    smoothed = NaN;
    lastT = NaN;
    armedCycle = null;
    lastCycle = NaN;
    cycles = 0;
    settled = false;
    last = { t: 0, mode: 'waiting', started: false, beat, tempo: 0, ratio: NaN, rate: NaN, phaseError: NaN, cycles: 0 };
  };

  return {
    step({ t, pulse, marked, ref = 0, range, phaseOffset }) {
      const dt = Number.isFinite(lastT) ? Math.max(0, t - lastT) : 0;
      lastT = t;
      // The beat at `t`, at the tempo set last step (never backwards).
      if (started) beat += (tempo / 60) * dt;
      const r = range !== undefined && range >= 0 && range < 1 ? range : o.range;
      const off = phaseOffset !== undefined && Number.isFinite(phaseOffset) ? phaseOffset : o.phaseOffset;
      const lo = 1 - r;
      const hi = 1 + r;
      const trusted = pulse.state === 'running' && pulse.confidence >= o.trustedConfidence && pulse.period > 0 && Number.isFinite(pulse.period);
      const markedOk = marked > 0 && Number.isFinite(marked);
      const rel = level.step(t, trusted && markedOk ? pulse.period : NaN, markedOk ? 60 / marked : NaN, { base: 1, captureRange: Math.max(o.captureRange, r) });
      const k = level.ratio();
      // The dancer's position in cycles, shifted so that an integer is where a grid beat
      // should be (`phaseOffset` beats after one).
      const cyc = trusted && k !== null ? cyclesAt(pulse, t, o.phaseFrom) + off / k : NaN;
      const cycleIndex = Number.isFinite(cyc) ? Math.floor(cyc) : NaN;
      const newCycle = Number.isFinite(cycleIndex) && Number.isFinite(lastCycle) && cycleIndex !== lastCycle;
      if (Number.isFinite(cycleIndex)) lastCycle = cycleIndex;

      if (!started) {
        if (k === null || !markedOk) {
          armedCycle = null;
          last = { t, mode: rel.mode as DanceLeadMode, started: false, beat, tempo: 0, ratio: rel.match?.ratio ?? NaN, rate: NaN, phaseError: NaN, cycles: 0 };
          return last;
        }
        // The tempo the piece starts at: the dancer's, once the pulse is sure of its period;
        // the marked one before (rule 3).
        if (rel.match && rel.mode === 'following') smoothed = pulse.confidence >= o.tempoConfidence ? clampTo(rel.match.rate, lo, hi) : 1;
        if (pulse.confidence >= o.tempoConfidence) settled = true;
        // Armed on the cycle the dancer is in; the start is the NEXT one, exactly one on. An
        // unknown phase (a pause) disarms, and any other change of count (the follower
        // starting over after a gap) re-arms there: the start is never mid-cycle.
        if (!Number.isFinite(cycleIndex)) armedCycle = null;
        else if (armedCycle === null || (cycleIndex !== armedCycle && cycleIndex !== armedCycle + 1)) armedCycle = cycleIndex;
        if (armedCycle !== null && cycleIndex === armedCycle + 1) {
          // The start: on the grid (a multiple of k from `ref`), as far into it as the
          // dancer already is into their cycle.
          started = true;
          cycles = 1;
          const grid = ref + k * Math.ceil((beat - ref) / k - START_EPS);
          beat = grid + (cyc - cycleIndex) * k;
          if (!Number.isFinite(smoothed)) smoothed = 1;
        } else {
          last = { t, mode: 'armed', started: false, beat, tempo: 0, ratio: k, rate: NaN, phaseError: NaN, cycles: 0 };
          return last;
        }
      } else if (newCycle) cycles++;

      let phaseError = NaN;
      let factor: number;
      if (rel.mode === 'following' && rel.match && Number.isFinite(cyc) && k !== null) {
        // Modulo k: the cycle start belongs on a grid beat, so a bar-long cycle keeps the bars.
        phaseError = wrapPhase((beat - ref) / k - cyc) * k;
        // The dancer's period sets the tempo once it is settled (rule 3); before, the tempo
        // stays where it is and the phase law below does the following.
        if (pulse.confidence >= o.tempoConfidence || cycles > o.tempoAfterCycles || Math.abs(phaseError) > o.handoverPhaseError) settled = true;
        const target = settled ? clampTo(rel.match.rate, lo, hi) : smoothed;
        smoothed = clampTo(smoothed + (target - smoothed) * (1 - Math.exp(-dt / o.smoothS)), lo, hi);
        factor = clampTo(smoothed * (1 + clampTo(-phaseError / o.horizonBeats, -o.maxCorrection, o.maxCorrection)), lo, hi);
      } else {
        // Holding: the tempo it had, inside the current clamp. Never stopped.
        smoothed = clampTo(smoothed, lo, hi);
        factor = smoothed;
      }
      // A score that marks no tempo here (the caller states one) keeps the tempo it had.
      if (markedOk) tempo = marked * factor;
      const mode: DanceLeadMode = rel.mode === 'following' ? (Number.isFinite(phaseError) ? 'following' : 'holding') : rel.mode === 'switching' ? 'switching' : 'holding';
      last = { t, mode, started: true, beat, tempo, ratio: k ?? NaN, rate: smoothed, phaseError, cycles };
      return last;
    },
    state: () => last,
    reset,
  };
}
