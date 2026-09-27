/**
 * Fitting a player's take to a drum pattern (#269): their tempo, their feel, their
 * positions. Pure, offline, over the hits the air drum already emits.
 *
 * ## What is learned, and why each thing
 *
 * - **Tempo and phase.** `fitGrid` at the stated tempo finds the phase that best matches
 *   the hits to a beat grid; the matched hits and their beats then give a least-squares
 *   line, time against beat, whose slope is the player's period. One more round of
 *   matching at that tempo and the line is refit. The stated tempo is only a starting
 *   point (the count-in's): the fit says what they played.
 * - **Assignment.** Every hit goes to the nearest pattern event within half a subdivision,
 *   an event of the hit's own sound if one is there, else any. Unassigned hits are
 *   extras; events no hit reached are misses. Their counts are the take's accuracy.
 * - **Feel.** Per event, the mean and spread of its hits' offsets from the grid, in
 *   fractions of a beat. This is the player's own timing on that pattern (the snare a
 *   little late, the off-beats pushed), and it is what playback puts back after
 *   quantising. An event whose spread exceeds its offset has no habit, only noise, and
 *   plays on the grid.
 * - **Positions.** Per drum, the pad the player's hits for it fell in most often (which
 *   need not be the pad whose sound it is) and their mean landing point, so playback
 *   sounds the drum when THAT pad is hit and shades from the player's own centre.
 *
 * Units: times in seconds on one clock (the engine's), offsets in beats. Nothing here
 * reads a clock, the DAG, React or audio.
 */
import { z } from 'zod';
import { fitGrid } from '@/ictus/metrics';
import { PAD_IDS, DRUM_SOUNDS, type DrumSound, type PadId } from '@/nodes/music/drum_pads';
import { DRUM_NAMES, type DrumName } from '@/music/gm_drums';
import type { DrumPattern, PatternEvent } from '@/music/drum_patterns';

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
  /** The player's tempo over the take, beats per minute. */
  bpm: z.number().positive(),
  /** The tempo the count-in stated. */
  statedBpm: z.number().positive(),
  /** How many times the pattern was played through (the fit's estimate). */
  passes: z.number().int().min(1),
  /** Per event index: the player's feel on it. Events with no hit are absent. */
  feel: z.record(z.string(), EventFeelSchema),
  /** Per drum name: where the player strikes it. */
  positions: z.record(z.string(), DrumPositionSchema),
  /** Events that got a hit, over all the events of all the passes. */
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
  /** When the take was made (for the model's stamp). */
  takenAt?: number;
  /** Tempo search: rounds of match-and-refit after the coarse scan. */
  rounds?: number;
  /** The coarse scan: `tempoSteps` either side of the stated tempo, `tempoStep` apart (a
   *  fraction). The defaults cover 70 to 130 percent of the count-in, at 2.5 percent. */
  tempoSteps?: number;
  tempoStep?: number;
}

const FIT_DEFAULTS = { windowSteps: 1, minMatched: 4, rounds: 3, tempoSteps: 12, tempoStep: 0.025 };

export interface Assignment {
  hit: number;
  event: number;
  pass: number;
  /** Offset from the grid, beats (positive = late). */
  offset: number;
}

/** The absolute beat of an event in a pass. */
const absBeat = (pattern: Pick<DrumPattern, 'lengthBeats'>, e: Pick<PatternEvent, 'beat'>, pass: number) => pass * pattern.lengthBeats + e.beat;

/**
 * Assign hits to events on a grid (`period` seconds per beat, beat 0 at `phase`): each
 * hit to the nearest event of its own sound within the window, else the nearest of any
 * sound; one hit per event per pass (the closer wins; the other goes to the next best,
 * or is an extra).
 */
export function assignHits(hits: readonly HitSample[], pattern: DrumPattern, period: number, phase: number, options: Pick<FitOptions, 'windowSteps'> = {}): Assignment[] {
  const windowBeats = ((options.windowSteps ?? FIT_DEFAULTS.windowSteps) / pattern.stepsPerBeat) / 2;
  if (pattern.events.length === 0 || hits.length === 0) return [];
  const taken = new Set<string>();
  const out: Assignment[] = [];
  // A hit of a sound the pattern USES must go to an event of that sound (a second kick in
  // a flam is an extra, not the hi-hat under it); a hit of a sound the pattern has no
  // event for may be the player's substitute for any drum (the pad they use for it).
  const patternSounds = new Set(pattern.events.map((e) => e.sound));
  // Candidates per hit, then a greedy pass in order of closeness.
  const candidates: { hit: number; event: number; pass: number; offset: number }[] = [];
  hits.forEach((h, i) => {
    const beat = (h.t - phase) / period;
    const pass = Math.floor(beat / pattern.lengthBeats);
    const strict = h.sound !== undefined && patternSounds.has(h.sound);
    for (const p of [pass - 1, pass, pass + 1]) {
      if (p < 0) continue;
      for (const e of pattern.events) {
        if (strict && e.sound !== h.sound) continue;
        const offset = beat - absBeat(pattern, e, p);
        if (Math.abs(offset) > windowBeats) continue;
        candidates.push({ hit: i, event: e.index, pass: p, offset });
      }
    }
  });
  candidates.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
  const usedHit = new Set<number>();
  for (const c of candidates) {
    const key = `${c.pass}:${c.event}`;
    if (usedHit.has(c.hit) || taken.has(key)) continue;
    usedHit.add(c.hit);
    taken.add(key);
    out.push({ hit: c.hit, event: c.event, pass: c.pass, offset: c.offset });
  }
  return out.sort((a, b) => a.hit - b.hit);
}

/** Least squares of t against beat over assignments: period (s/beat) and phase (s). */
function refit(hits: readonly HitSample[], pattern: DrumPattern, assignments: readonly Assignment[]): { period: number; phase: number } | null {
  const n = assignments.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const a of assignments) {
    const x = absBeat(pattern, pattern.events[a.event], a.pass);
    const y = hits[a.hit].t;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (den <= 0) return null;
  const period = (n * sxy - sx * sy) / den;
  if (!(period > 0)) return null;
  const phase = (sy - period * sx) / n;
  return { period, phase };
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Fit a take to a pattern. Null when too few hits match at any tempo near the stated one
 * (the player did something else, or nothing).
 */
export function fitPattern(hits: readonly HitSample[], pattern: DrumPattern, options: FitOptions = {}): PatternModel | null {
  const o = { ...FIT_DEFAULTS, ...options };
  const statedBpm = o.statedBpm ?? pattern.bpm;
  const times = hits.map((h) => h.t).sort((a, b) => a - b);
  if (times.length < o.minMatched) return null;
  const start = times[0];
  const end = times[times.length - 1];
  // 1. A coarse search near the stated tempo: at each tempo the beat grid's phase
  //    (`fitGrid`), and since a beat grid says where the beats are but not which beat is
  //    the pattern's first, every beat of the pattern's length as beat 0 (folded back so
  //    the take starts in pass 0 or later). Keep what explains the most hits, closest.
  let period = 60 / statedBpm;
  let phase = start;
  let assignments: Assignment[] = [];
  let bestScore = -Infinity;
  const beats = Math.max(1, Math.round(pattern.lengthBeats));
  for (let step = -o.tempoSteps; step <= o.tempoSteps; step++) {
    const bpm = statedBpm * (1 + step * o.tempoStep);
    const p = 60 / bpm;
    const firstBeat = fitGrid(times, bpm, start - p, end + p).grid[0] ?? start;
    for (let k = 0; k < beats; k++) {
      let candidate = firstBeat + k * p;
      while (candidate > start) candidate -= pattern.lengthBeats * p;
      const a = assignHits(hits, pattern, p, candidate, o);
      const score = a.length - (a.length ? mean(a.map((x) => Math.abs(x.offset))) : 0);
      if (score > bestScore) {
        bestScore = score;
        period = p;
        phase = candidate;
        assignments = a;
      }
    }
  }
  // 2. Match and refit the tempo a few rounds (a straight line, time against beat).
  for (let round = 0; round < o.rounds; round++) {
    const better = refit(hits, pattern, assignments);
    if (!better) break;
    period = better.period;
    phase = better.phase;
    const next = assignHits(hits, pattern, period, phase, o);
    if (next.length < assignments.length) break;
    assignments = next;
  }
  if (assignments.length < o.minMatched) return null;

  // 3. Feel per event, over the passes, against each pass's OWN line: a player's tempo
  //    drifts, and against one line over the take a steady drift reads as a feel that
  //    changes sign from the first pass to the last. The local tempo is what playback
  //    follows too, so the feel is measured the way it will be applied. A pass with too
  //    few hits for a line of its own keeps the take's.
  const byPass = new Map<number, Assignment[]>();
  for (const a of assignments) byPass.set(a.pass, [...(byPass.get(a.pass) ?? []), a]);
  const local = new Map<number, { period: number; phase: number }>();
  for (const [p, as] of byPass) local.set(p, (as.length >= 3 ? refit(hits, pattern, as) : null) ?? { period, phase });
  const byEvent = new Map<number, number[]>();
  for (const a of assignments) {
    const line = local.get(a.pass)!;
    const offset = (hits[a.hit].t - (line.phase + absBeat(pattern, pattern.events[a.event], a.pass) * line.period)) / line.period;
    byEvent.set(a.event, [...(byEvent.get(a.event) ?? []), offset]);
  }
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
  const windowS = ((o.windowSteps / pattern.stepsPerBeat) / 2) * period;
  const lastPass = Math.max(...assignments.map((a) => a.pass));
  let expected = 0;
  for (let p = 0; p <= lastPass + 1; p++) {
    for (const e of pattern.events) {
      const t = phase + absBeat(pattern, e, p) * period;
      if (t >= start - windowS && t <= end + windowS) expected += 1;
    }
  }
  const passes = Math.max(1, Math.round((end - start) / (pattern.lengthBeats * period) + 1 / Math.max(1, pattern.events.length)));
  const recall = expected > 0 ? Math.min(1, assignments.length / expected) : 0;
  const precision = assignments.length / hits.length;
  return PatternModelSchema.parse({
    patternId: pattern.id,
    bpm: 60 / period,
    statedBpm,
    passes,
    feel,
    positions,
    recall: Math.min(1, recall),
    precision,
    takenAt: o.takenAt ?? 0,
  });
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
