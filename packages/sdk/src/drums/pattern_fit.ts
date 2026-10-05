/**
 * Fitting a player's take to a drum pattern (#269): their tempo, their feel, their
 * positions. Pure, offline, over the hits the air drum already emits.
 *
 * ## What is learned, and why each thing
 *
 * - **Tempo and phase.** A coarse scan around the count-in's tempo (`fitGrid` gives the
 *   beat grid's phase at each; every subdivision of the pattern's length is tried as
 *   its first step, because a pattern with hi-hats on every eighth ties the beat grid
 *   between the beat and the off-beat) keeps what explains the most hits, closest; then
 *   a least-squares line, time against beat, is refit over the matched hits. Then, since
 *   a player's tempo drifts and one line over a long take cannot hold both ends inside
 *   the matching window, each pass gets a line of its own over its hits and the
 *   assignment is redone against those local lines; the walk starts from the pass the
 *   curve matched best and goes out both ways. The stated tempo is only where the
 *   search starts: the fit says what they played, and the tempo reported is the mean
 *   local period over the matched hits.
 * - **Assignment.** Every hit goes to the nearest event within half a subdivision, in
 *   two rounds (see `assignHits`): strictly by sound first, then against the drums'
 *   identities on this kit (the sound and pad of the hits that were each drum), which
 *   is how a drum played on a pad of another sound is learned as that drum's pad, and
 *   why a flam's second kick, its kick slot taken, is an extra. The fits that choose the
 *   tempo and the phase are scored with the strict round only. One hit per event per
 *   pass; the rest are extras, and events no hit reached are misses.
 * - **Feel.** Per event, the mean and spread of its hits' offsets from the local grid, in
 *   fractions of a beat: the player's own timing on that pattern (the snare a little
 *   late, the off-beats pushed), measured the way playback applies it. An event whose
 *   spread exceeds its offset has no habit, only noise, and plays on the grid.
 * - **Positions.** Per drum, the pad the player's hits for it fell in most often and their
 *   mean landing point, so playback sounds the drum when THAT pad is hit and shades from
 *   the player's own centre.
 *
 * A fit is refused (null) when fewer than `minMatched` hits match, or when recall or
 * precision fall under their floors: a take of something else fits *some* grid, always,
 * and a model built from it would be worse than none.
 *
 * Units: times in seconds on one clock (the engine's), offsets in beats. Nothing here
 * reads a clock, the DAG, React or audio.
 */
import { z } from 'zod';
import { fitGrid } from '@thoremin/ictus/metrics';
import { PAD_IDS, DRUM_SOUNDS, type DrumSound, type PadId } from '../nodes/music/drum_pads';
import { DRUM_NAMES, type DrumName } from '../music/gm_drums';
import type { DrumPattern, PatternEvent } from '../music/drum_patterns';

/** What the fit reads of a hit: the subset of `DrumHit` it needs. */
export interface HitSample {
  /** When it sounded, seconds. */
  t: number;
  sound?: DrumSound;
  pad?: PadId | null;
  x?: number;
  y?: number;
}

export const EventFeelSchema = z.object({
  /** Mean offset from the grid, fractions of a beat (positive = late). */
  offset: z.number(),
  /** Standard deviation of the offsets, fractions of a beat. */
  spread: z.number(),
  /** Hits behind the number. */
  n: z.number().int().min(0),
});
export type EventFeel = z.infer<typeof EventFeelSchema>;

export const DrumPositionSchema = z.object({
  pad: z.enum(PAD_IDS).nullable(),
  /** Mean landing point, in the displayed frame's fractions; null when no hit carried one. */
  centre: z.object({ x: z.number(), y: z.number() }).nullable(),
  n: z.number().int().min(0),
});
export type DrumPosition = z.infer<typeof DrumPositionSchema>;

/** The pattern model: what a take taught, persisted per pattern. */
export const PatternModelSchema = z.object({
  v: z.literal(1).default(1),
  patternId: z.string().min(1),
  /** The player's tempo over the take, beats per minute: the mean local period over the
   *  matched hits. */
  bpm: z.number().positive(),
  /** The tempo the count-in stated. */
  statedBpm: z.number().positive(),
  /** How many passes the matched hits span. */
  passes: z.number().int().min(1),
  /** Per event index: the player's feel on it. Events with no hit are absent. */
  feel: z.record(z.string(), EventFeelSchema),
  /** Per drum name: where the player strikes it. */
  positions: z.record(z.string(), DrumPositionSchema),
  /** Events that got a hit, over the events inside the take's span. */
  recall: z.number().min(0).max(1),
  /** Hits assigned to an event, over all hits. */
  precision: z.number().min(0).max(1),
  takenAt: z.number(),
});
export type PatternModel = z.infer<typeof PatternModelSchema>;

export interface FitOptions {
  /** The count-in's tempo: where the grid search starts. Default: the pattern's. */
  statedBpm?: number;
  /** Half of this, in subdivisions, is how far from an event a hit may fall and still be
   *  it. Default 1 (half a subdivision either way). */
  windowSteps?: number;
  /** Matched hits needed for a fit. Below it, null. */
  minMatched?: number;
  /** Recall and precision floors. Under either, null: the take was something else. */
  minRecall?: number;
  minPrecision?: number;
  /** When the take was made (for the model's stamp). */
  takenAt?: number;
  /** Rounds of match-and-refit on the take's line (as many again with a tempo trend). */
  rounds?: number;
  /** The coarse scan: `tempoSteps` either side of the stated tempo, `tempoStep` apart (a
   *  fraction). The defaults cover 70 to 130 percent of the count-in, at 2.5 percent. */
  tempoSteps?: number;
  tempoStep?: number;
}

/** The floors are for a TRAINING take: a take that missed or added a third of the hits is
 *  asked for again rather than learned from (another pattern played against this one
 *  scores about 0.67 recall and 0.8 precision). */
const FIT_DEFAULTS = { windowSteps: 1, minMatched: 4, minRecall: 0.7, minPrecision: 0.7, rounds: 3, tempoSteps: 12, tempoStep: 0.025 };

export interface Assignment {
  hit: number;
  event: number;
  pass: number;
  /** Offset from the grid, beats (positive = late). */
  offset: number;
}

/** Time against beat: `t = phase + beat * period + trend * beat^2`. A line when `trend` is
 *  0; with a trend, the period changes steadily over the take (a tempo drifting up or
 *  down), the trend prior's own shape. */
export interface Line {
  period: number;
  phase: number;
  trend?: number;
}

/** The take's curve and, where a pass had enough hits, a line of its own. */
export interface Grid {
  line: Line;
  local?: ReadonlyMap<number, Line>;
}

/** The absolute beat of an event in a pass. */
const absBeat = (pattern: Pick<DrumPattern, 'lengthBeats'>, e: Pick<PatternEvent, 'beat'>, pass: number) => pass * pattern.lengthBeats + e.beat;

const lineFor = (grid: Grid, pass: number): Line => grid.local?.get(pass) ?? grid.line;

/** The time of a beat on a line. */
const timeAt = (l: Line, beat: number) => l.phase + beat * l.period + (l.trend ?? 0) * beat * beat;
/** The period at a beat (the derivative). */
const periodAt = (l: Line, beat: number) => l.period + 2 * (l.trend ?? 0) * beat;
/** The beat at a time: the line's answer, then one Newton step for the trend. */
function beatAt(l: Line, t: number): number {
  let beat = (t - l.phase) / l.period;
  if (l.trend) {
    for (let i = 0; i < 3; i++) beat -= (timeAt(l, beat) - t) / Math.max(1e-6, periodAt(l, beat));
  }
  return beat;
}

/** When the grid says an event of a pass falls, seconds. */
export function gridTime(grid: Grid, pattern: DrumPattern, event: Pick<PatternEvent, 'beat'>, pass: number): number {
  return timeAt(lineFor(grid, pass), absBeat(pattern, event, pass));
}

/** What a drum is, on this player's kit: the sound and the pad of the hits that were it. */
export interface DrumIdentity {
  sound?: DrumSound;
  pad?: PadId;
}

const dominant = <T extends string>(xs: readonly (T | null | undefined)[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const x of xs) if (x) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/**
 * Assign hits to events on a grid, in two rounds. Each hit's candidates are the events
 * within the window. The first round is strict: a hit may take only an event of its own
 * sound, greedily by closeness, one hit per event per pass. From it each drum gets an
 * IDENTITY, the sound and pad of the hits that were it; a drum no hit of its sound
 * reached takes the identity of the unassigned hits on its events, which is how the
 * hi-hat played on a snare-sounding pad becomes "the hi-hat is the snare sound on p8".
 * The second round assigns against the identities: a hit may take an event whose drum
 * has its sound, preferring the drum's own pad and shunning another drum's, so two
 * hits of one sound at one instant go to their own drums; a drum nothing identified
 * takes any sound. A flam's second kick, its kick slot taken, is an extra.
 */
export function assignHits(hits: readonly HitSample[], pattern: DrumPattern, grid: Grid, options: Pick<FitOptions, 'windowSteps'> & { identities?: boolean } = {}): Assignment[] {
  const windowBeats = (options.windowSteps ?? FIT_DEFAULTS.windowSteps) / pattern.stepsPerBeat / 2;
  if (pattern.events.length === 0 || hits.length === 0) return [];
  type Candidate = { hit: number; event: number; pass: number; offset: number; same: boolean };
  const candidates: Candidate[] = [];
  hits.forEach((h, i) => {
    // Which pass the hit is in, by the take's curve; the offset by that pass's own line.
    const pass = Math.floor(beatAt(grid.line, h.t) / pattern.lengthBeats);
    const mine: Candidate[] = [];
    // Two passes either side: the take's curve may be a beat or two off at the ends of a
    // drifting take, and the local lines are what the offsets are measured on.
    for (const p of [pass - 2, pass - 1, pass, pass + 1, pass + 2]) {
      if (p < 0) continue;
      const l = lineFor(grid, p);
      for (const e of pattern.events) {
        const beat = absBeat(pattern, e, p);
        const offset = (h.t - timeAt(l, beat)) / periodAt(l, beat);
        if (Math.abs(offset) > windowBeats) continue;
        mine.push({ hit: i, event: e.index, pass: p, offset, same: h.sound === undefined || h.sound === e.sound });
      }
    }
    candidates.push(...mine);
  });
  const greedy = (allowed: (c: Candidate) => boolean, rank: (c: Candidate) => number): Assignment[] => {
    const sorted = candidates.filter(allowed).sort((a, b) => rank(a) - rank(b) || Math.abs(a.offset) - Math.abs(b.offset));
    const taken = new Set<string>();
    const usedHit = new Set<number>();
    const out: Assignment[] = [];
    for (const c of sorted) {
      const key = `${c.pass}:${c.event}`;
      if (usedHit.has(c.hit) || taken.has(key)) continue;
      usedHit.add(c.hit);
      taken.add(key);
      out.push({ hit: c.hit, event: c.event, pass: c.pass, offset: c.offset });
    }
    return out;
  };
  // Round one, strict. With `identities: false` that is the answer: the fits that
  // choose the tempo and the phase must be scored strictly, because the identity round
  // below can make a WRONG phase score perfectly by relabelling the drums (a grid a beat
  // off puts the kicks on the snare's events, and "the snare is the kick sound on the
  // kick's pad" explains every hit, pads swapped).
  const first = greedy((c) => c.same, () => 0);
  if (options.identities === false) return first.sort((a, b) => a.hit - b.hit);
  // The identities round one yields. Each drum's evidence is the hits that
  // were it, or, for a drum no hit of its sound reached, the unassigned hits on its
  // events. Drums are identified in order of evidence, and a pad already claimed by a
  // better-evidenced drum does not count for a later one: the snare's evidence in the
  // rock beat is only the beats it shares with the hi-hat, so a hi-hat played on a
  // snare-sounding pad would otherwise claim the snare's pad too.
  const assignedHits = new Set(first.map((a) => a.hit));
  const evidence = new Map<DrumName, HitSample[]>();
  for (const drum of DRUM_NAMES) {
    if (!pattern.events.some((e) => e.drum === drum)) continue;
    const mine = first.filter((a) => pattern.events[a.event].drum === drum).map((a) => hits[a.hit]);
    if (mine.length > 0) {
      evidence.set(drum, mine);
      continue;
    }
    const near = candidates.filter((c) => !assignedHits.has(c.hit) && pattern.events[c.event].drum === drum).map((c) => hits[c.hit]);
    if (near.length > 0) evidence.set(drum, near);
  }
  const identity = new Map<DrumName, DrumIdentity>();
  const claimed = new Set<PadId>();
  for (const [drum, ev] of [...evidence.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const free = ev.filter((h) => !h.pad || !claimed.has(h.pad));
    const use = free.length > 0 ? free : ev;
    const id: DrumIdentity = { sound: dominant(use.map((h) => h.sound)), pad: dominant(use.map((h) => h.pad)) };
    identity.set(drum, id);
    if (id.pad) claimed.add(id.pad);
  }
  const padsOfOthers = (drum: DrumName) => new Set([...identity.entries()].filter(([d, id]) => d !== drum && id.pad).map(([, id]) => id.pad!));
  // Round two, against the identities.
  return greedy(
    (c) => {
      const id = identity.get(pattern.events[c.event].drum);
      return !id?.sound || hits[c.hit].sound === undefined || hits[c.hit].sound === id.sound;
    },
    (c) => {
      const drum = pattern.events[c.event].drum;
      const pad = hits[c.hit].pad;
      if (!pad) return 1;
      if (identity.get(drum)?.pad === pad) return 0;
      return padsOfOthers(drum).has(pad) ? 2 : 1;
    },
  ).sort((a, b) => a.hit - b.hit);
}

/** Distinct beats a curve with a trend needs: under it, the trend is noise. */
const TREND_MIN_BEATS = 12;
/** A refit or a walk must keep this share of the matched hits to be accepted. */
const REFIT_KEEP = 0.9;

/**
 * Least squares of t against beat over assignments: a line, or with enough distinct
 * beats and `withTrend`, a curve with a steady change of period. Null under three
 * distinct beats or a non-positive period.
 */
function refit(hits: readonly HitSample[], pattern: DrumPattern, assignments: readonly Assignment[], withTrend = false): Line | null {
  const beats = new Set(assignments.map((a) => absBeat(pattern, pattern.events[a.event], a.pass)));
  if (beats.size < 3) return null;
  const xs = assignments.map((a) => absBeat(pattern, pattern.events[a.event], a.pass));
  const ys = assignments.map((a) => hits[a.hit].t);
  const quadratic = withTrend && beats.size >= TREND_MIN_BEATS;
  // Normal equations for t = p0 + p1 x (+ p2 x^2), solved by elimination.
  const k = quadratic ? 3 : 2;
  const m: number[][] = Array.from({ length: k }, () => Array(k + 1).fill(0));
  for (let i = 0; i < xs.length; i++) {
    const row = quadratic ? [1, xs[i], xs[i] * xs[i]] : [1, xs[i]];
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) m[r][c] += row[r] * row[c];
      m[r][k] += row[r] * ys[i];
    }
  }
  for (let c = 0; c < k; c++) {
    let pivot = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-12) return null;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= k; j++) m[r][j] -= f * m[c][j];
    }
  }
  const p = m.map((row, r) => row[k] / row[r]);
  const line: Line = { phase: p[0], period: p[1], trend: quadratic ? p[2] : 0 };
  // The period must stay positive over the beats seen.
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (!(periodAt(line, lo) > 0) || !(periodAt(line, hi) > 0)) return quadratic ? refit(hits, pattern, assignments, false) : null;
  return line;
}

/**
 * A line per pass, walked in order like a follower: each pass is predicted from the
 * line of the pass before it (the same period, continuous at the pass's first beat),
 * its hits matched against that prediction, same sound strictly, and its own line
 * refit from them where three distinct beats matched. A tempo that drifts a little every
 * pass is followed however far it drifts over the take, which one curve over the whole
 * take cannot do once the ends are more than a window off it (the coarse fit explains
 * the middle and never matches the ends, so nothing pulls it back).
 */
function walkPasses(hits: readonly HitSample[], pattern: DrumPattern, take: Line, seedAssignments: readonly Assignment[], windowSteps: number): Map<number, Line> {
  const windowBeats = windowSteps / pattern.stepsPerBeat / 2;
  const L = pattern.lengthBeats;
  const times = hits.map((h) => h.t);
  const start = Math.min(...times);
  const end = Math.max(...times);
  const firstPass = Math.max(0, Math.floor(beatAt(take, start) / L));
  const lastPass = Math.max(firstPass, Math.ceil(beatAt(take, end) / L));
  // Start where the take's curve is surest: the pass with the most matched hits, and
  // walk out from it both ways, so the passes the curve missed are reached from a
  // neighbour that fits rather than from the curve that missed them.
  const perPass = new Map<number, number>();
  for (const a of seedAssignments) perPass.set(a.pass, (perPass.get(a.pass) ?? 0) + 1);
  let seedPass = firstPass;
  let most = -1;
  for (const [p, n] of perPass) if (n > most || (n === most && p < seedPass)) [seedPass, most] = [p, n];
  const out = new Map<number, Line>();
  const used = new Set<number>();
  const fitPass = (p: number, predicted: Line): Line => {
    const b0 = p * L;
    const mine: Assignment[] = [];
    const takenEvents = new Set<number>();
    const pairs: { hit: number; event: number; offset: number }[] = [];
    for (const e of pattern.events) {
      const t = timeAt(predicted, b0 + e.beat);
      hits.forEach((h, i) => {
        if (used.has(i) || (h.sound !== undefined && h.sound !== e.sound)) return;
        const offset = (h.t - t) / predicted.period;
        if (Math.abs(offset) <= windowBeats) pairs.push({ hit: i, event: e.index, offset });
      });
    }
    pairs.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
    for (const pr of pairs) {
      if (used.has(pr.hit) || takenEvents.has(pr.event)) continue;
      used.add(pr.hit);
      takenEvents.add(pr.event);
      mine.push({ hit: pr.hit, event: pr.event, pass: p, offset: pr.offset });
    }
    return refit(hits, pattern, mine) ?? predicted;
  };
  const fromTake = (p: number): Line => {
    const b0 = p * L;
    return { period: periodAt(take, b0), phase: timeAt(take, b0) - b0 * periodAt(take, b0) };
  };
  // Forward from the seed: each pass predicted from the one before it, continuous at
  // its first beat, the same period.
  let prev: Line | null = null;
  for (let p = seedPass; p <= lastPass; p++) {
    const b0 = p * L;
    const predicted: Line = prev ? { period: prev.period, phase: timeAt(prev, b0) - b0 * prev.period } : fromTake(p);
    const line = fitPass(p, predicted);
    out.set(p, line);
    prev = line;
  }
  // Backward from the seed: each pass predicted from the one after it, continuous at
  // that pass's first beat.
  let next: Line | null = out.get(seedPass) ?? null;
  for (let p = seedPass - 1; p >= firstPass; p--) {
    const b1 = (p + 1) * L;
    const predicted: Line = next ? { period: next.period, phase: timeAt(next, b1) - b1 * next.period } : fromTake(p);
    const line = fitPass(p, predicted);
    out.set(p, line);
    next = line;
  }
  return out;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/** The fit's working result before it becomes a model, for a caller that wants the grid
 *  (a cursor that follows the take, a test). */
export interface Fit {
  grid: Grid;
  assignments: Assignment[];
  model: PatternModel;
}

/**
 * Fit a take to a pattern. Null when too few hits match at any tempo near the stated one,
 * or when recall or precision fall under their floors (the player did something else, or
 * nothing).
 */
export function fitPatternFull(hits: readonly HitSample[], pattern: DrumPattern, options: FitOptions = {}): Fit | null {
  const o = { ...FIT_DEFAULTS, ...options };
  const statedBpm = o.statedBpm ?? pattern.bpm;
  const times = hits.map((h) => h.t).sort((a, b) => a - b);
  if (times.length < o.minMatched) return null;
  const start = times[0];
  const end = times[times.length - 1];

  // 1. The coarse search: tempo, the beat grid's phase, every subdivision as step one.
  let grid: Grid = { line: { period: 60 / statedBpm, phase: start } };
  let assignments: Assignment[] = [];
  let bestScore = -Infinity;
  const steps = Math.max(1, pattern.steps);
  for (let step = -o.tempoSteps; step <= o.tempoSteps; step++) {
    const bpm = statedBpm * (1 + step * o.tempoStep);
    const p = 60 / bpm;
    const firstBeat = fitGrid(times, bpm, start - p, end + p).grid[0] ?? start;
    for (let k = 0; k < steps; k++) {
      let candidate = firstBeat + (k * p) / pattern.stepsPerBeat;
      while (candidate > start) candidate -= pattern.lengthBeats * p;
      const g: Grid = { line: { period: p, phase: candidate } };
      const a = assignHits(hits, pattern, g, { ...o, identities: false });
      const score = a.length - (a.length ? mean(a.map((x) => Math.abs(x.offset))) : 0);
      if (score > bestScore) {
        bestScore = score;
        grid = g;
        assignments = a;
      }
    }
  }
  // 2. Refit the take's curve (a line, then with a trend once enough beats have
  //    matched), then the per-pass lines, re-assigning against each.
  //    A refit that trades a hit or two at the ends for a better line is accepted (the
  //    first version stopped at the first traded hit and never reached the trend).
  for (let round = 0; round < o.rounds * 2; round++) {
    const better = refit(hits, pattern, assignments, round >= o.rounds);
    if (!better) break;
    const next = assignHits(hits, pattern, { line: better }, { ...o, identities: false });
    if (next.length < REFIT_KEEP * assignments.length) break;
    grid = { line: better };
    assignments = next;
  }
  {
    const local = walkPasses(hits, pattern, grid.line, assignments, o.windowSteps);
    const g: Grid = { line: grid.line, local };
    const next = assignHits(hits, pattern, g, { ...o, identities: false });
    if (next.length >= REFIT_KEEP * assignments.length) {
      grid = g;
      assignments = next;
    }
  }
  // The final assignment, with the drums' identities on this kit.
  assignments = assignHits(hits, pattern, grid, o);
  if (assignments.length < o.minMatched) return null;

  // 3. Feel per event, over the passes, against the local grid.
  const byEvent = new Map<number, number[]>();
  for (const a of assignments) byEvent.set(a.event, [...(byEvent.get(a.event) ?? []), a.offset]);
  const feel: Record<string, EventFeel> = {};
  for (const [event, offsets] of byEvent) feel[String(event)] = { offset: mean(offsets), spread: sd(offsets), n: offsets.length };

  // 4. Positions per drum.
  const positions: Record<string, DrumPosition> = {};
  for (const drum of DRUM_NAMES) {
    const mine = assignments.filter((a) => pattern.events[a.event].drum === drum).map((a) => hits[a.hit]);
    if (mine.length === 0) continue;
    const padCounts = new Map<PadId, number>();
    for (const h of mine) if (h.pad) padCounts.set(h.pad, (padCounts.get(h.pad) ?? 0) + 1);
    const pad = [...padCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const placed = mine.filter((h) => typeof h.x === 'number' && typeof h.y === 'number') as (HitSample & { x: number; y: number })[];
    const centre = placed.length ? { x: mean(placed.map((h) => h.x)), y: mean(placed.map((h) => h.y)) } : null;
    positions[drum] = { pad, centre, n: mine.length };
  }

  // 5. Accuracy over the span the take covered: the events whose grid time falls between
  //    the first and the last hit (a window either side), whatever beat the take began on.
  const passList = assignments.map((a) => a.pass);
  const firstPass = Math.min(...passList);
  const lastPass = Math.max(...passList);
  // The player's tempo over the take: the mean of the local period at every matched hit
  // (the pass lines are what followed the drift; the take's curve only found the middle).
  const meanPeriod = mean(assignments.map((a) => periodAt(lineFor(grid, a.pass), absBeat(pattern, pattern.events[a.event], a.pass))));
  const windowS = (o.windowSteps / pattern.stepsPerBeat / 2) * meanPeriod;
  let expected = 0;
  for (let p = Math.max(0, firstPass - 1); p <= lastPass + 1; p++) {
    for (const e of pattern.events) {
      const t = gridTime(grid, pattern, e, p);
      if (t >= start - windowS && t <= end + windowS) expected += 1;
    }
  }
  const recall = expected > 0 ? Math.min(1, assignments.length / expected) : 0;
  const precision = assignments.length / hits.length;
  if (recall < o.minRecall || precision < o.minPrecision) return null;
  const model = PatternModelSchema.parse({
    patternId: pattern.id,
    bpm: 60 / meanPeriod,
    statedBpm,
    passes: new Set(passList).size,
    feel,
    positions,
    recall,
    precision,
    takenAt: o.takenAt ?? 0,
  });
  return { grid, assignments, model };
}

/** The model alone (see {@link fitPatternFull}). */
export function fitPattern(hits: readonly HitSample[], pattern: DrumPattern, options: FitOptions = {}): PatternModel | null {
  return fitPatternFull(hits, pattern, options)?.model ?? null;
}

/** The feel to apply to an event in playback: its mean offset when it is a habit (the
 *  mean clears the spread) and there were enough hits, else 0. */
export function playbackOffset(model: Pick<PatternModel, 'feel'>, event: number, minHits = 2): number {
  const f = model.feel[String(event)];
  if (!f || f.n < minHits) return 0;
  return Math.abs(f.offset) > f.spread ? f.offset : 0;
}

/** The pad a drum sounds from in playback: the player's, else null (the pad's own sound). */
export function playbackPad(model: Pick<PatternModel, 'positions'>, drum: DrumName): PadId | null {
  return model.positions[drum]?.pad ?? null;
}

/** For a strip: which drum names the pattern uses, in row order. */
export function patternDrums(pattern: Pick<DrumPattern, 'rows'>): DrumName[] {
  return DRUM_NAMES.filter((d) => pattern.rows[d] !== undefined);
}

export { DRUM_SOUNDS };
