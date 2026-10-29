/**
 * Match the note: the tuner made into a drill. A note is played; the player finds it (voice or
 * instrument, any octave) and holds it in tune for a moment; then the next. Judged by how quickly
 * the note was found and how steadily it was held, the two numbers a singing teacher listens for.
 * Self-paced: the lesson's beats are ignored, a note begins when the last one is done.
 *
 * The microphone hears the reference note too, and it is exactly the target: so listening starts
 * only after the reference has died away (`listenAfter`), and headphones are recommended.
 *
 * Pure: fed the engine time and what was heard each tick.
 */
import { centsOff } from '@thoremin/judge';
import { createCueFeed, type Cue } from './cues';
import { placeLesson, type Lesson } from './lesson';
import { shifted, type Heard } from './listen';
import type { GameView, TrailPoint, ViewNote } from './view';

export interface MatchOptions {
  start: number;
  transpose?: number;
  /** Half-width of "in tune", cents. Default 50 (a quarter tone: a singer's drill, not a tuner's). */
  toleranceCents?: number;
  /** How long the note must be held in tune, seconds. Default 1. */
  holdS?: number;
  /** Give up on a note after this long, seconds. Default 8. */
  timeoutS?: number;
  /** Listening starts this long after the reference note. Default 1.2. */
  listenAfter?: number;
  /** A voiceless gap shorter than this does not break a hold, seconds. Default 0.12. */
  dropout?: number;
  offset?: number;
  /** Tiers by time to find the note, seconds from listening. */
  tiers?: readonly { name: string; within: number }[];
}

export const MATCH_TIERS = [
  { name: 'perfect', within: 1.5 },
  { name: 'great', within: 3 },
  { name: 'good', within: Infinity },
] as const;

const REFERENCE_VELOCITY = 0.8;
const GAP = 0.6;

interface Outcome {
  found: number | null;
  spreadCents: number;
  tier: string;
}

export function createMatchSession(lesson: Lesson, opts: MatchOptions) {
  const tol = opts.toleranceCents ?? 50;
  const holdS = opts.holdS ?? 1;
  const timeoutS = opts.timeoutS ?? 8;
  const listenAfter = opts.listenAfter ?? 1.2;
  const dropout = opts.dropout ?? 0.12;
  const offset = opts.offset ?? 0;
  const tiers = opts.tiers ?? MATCH_TIERS;
  const targets = placeLesson({ ...lesson, countIn: 0 }, 0, opts.transpose ?? 0).notes.map((n) => n.midi ?? 60);
  const low = Math.min(...targets) - 3;
  const high = Math.max(...targets) + 3;
  const outcomes: Outcome[] = [];
  const view: ViewNote[] = targets.map((midi, id) => ({ id, start: 0, end: 0, midi, state: 'pending' }));
  const feed = createCueFeed(0.5);
  const trail: TrailPoint[] = [];
  const flashes: GameView['flashes'] = [];
  let i = 0;
  let begin = opts.start;
  let holdStart: number | null = null;
  let lastInTune = -Infinity;
  let holdCents: number[] = [];
  let lastCents: number | null = null;
  let finishedAt = -Infinity;

  const cueFor = (k: number, t: number) => feed.add([{ t, midi: targets[k], velocity: REFERENCE_VELOCITY, kind: 'reference' }]);
  cueFor(0, begin);
  view[0].start = begin;

  const finish = (now: number, outcome: Outcome) => {
    outcomes.push(outcome);
    view[i].state = outcome.found === null ? 'miss' : 'hit';
    view[i].label = outcome.tier;
    view[i].end = now;
    flashes.push({ t: now, label: outcome.tier });
    i++;
    holdStart = null;
    holdCents = [];
    lastCents = null;
    finishedAt = now;
    if (i < targets.length) {
      begin = now + GAP;
      view[i].start = begin;
      cueFor(i, begin);
    }
  };

  function tick(now: number, heardRaw: Heard): { view: GameView; cues: Cue[] } {
    const heard = shifted(heardRaw, offset);
    for (const p of [...heard.pitch].sort((a, b) => a.t - b.t)) {
      if (i >= targets.length) break;
      const listenFrom = begin + listenAfter;
      const voiced = p.f0 !== null && p.f0 > 0 && p.clarity >= 0.5;
      const cents = voiced ? centsOff(p.f0!, targets[i], true) : null;
      trail.push({ t: p.t, midi: cents === null ? null : targets[i] + cents / 100 });
      if (p.t < listenFrom) continue;
      lastCents = cents;
      if (cents !== null && Math.abs(cents) <= tol) {
        holdStart ??= p.t;
        lastInTune = p.t;
        holdCents.push(cents);
        if (p.t - holdStart >= holdS) {
          const found = holdStart - listenFrom;
          const mean = holdCents.reduce((a, b) => a + b, 0) / holdCents.length;
          const spread = Math.sqrt(holdCents.reduce((a, b) => a + (b - mean) ** 2, 0) / holdCents.length);
          finish(now, { found, spreadCents: spread, tier: tiers.find((t) => found <= t.within)?.name ?? 'good' });
        }
      } else if (holdStart !== null && p.t - lastInTune > dropout) {
        holdStart = null;
        holdCents = [];
      }
    }
    if (i < targets.length && now > begin + listenAfter + timeoutS) finish(now, { found: null, spreadCents: NaN, tier: 'miss' });
    while (trail.length > 0 && trail[0].t < now - 3) trail.shift();
    while (flashes.length > 0 && flashes[0].t < now - 1) flashes.shift();
    if (i < targets.length && view[i].state === 'pending' && now >= begin) view[i].state = 'active';

    const done = i >= targets.length;
    const hits = outcomes.filter((o) => o.found !== null);
    const counts: Record<string, number> = {};
    for (const o of outcomes) counts[o.tier] = (counts[o.tier] ?? 0) + 1;
    const accuracy = outcomes.length === 0 ? 0 : hits.length / targets.length;
    const meanFound = hits.length ? hits.reduce((a, o) => a + o.found!, 0) / hits.length : NaN;
    const meanSpread = hits.length ? hits.reduce((a, o) => a + o.spreadCents, 0) / hits.length : NaN;
    const v: GameView = {
      game: 'match',
      title: lesson.title,
      phase: done && now >= finishedAt ? 'results' : 'playing',
      now,
      from: now - 3,
      to: now,
      low,
      high,
      toleranceCents: tol,
      notes: view.map((n) => ({ ...n })),
      trail: [...trail],
      flashes: [...flashes],
      countdown: 0,
      accuracy,
      combo: 0,
      ...(done
        ? {
            results: {
              accuracy,
              counts,
              summary: hits.length
                ? `${hits.length} of ${targets.length} found, in ${meanFound.toFixed(1)} s on average, held within ${Math.round(meanSpread)} cents`
                : `none of ${targets.length} found`,
            },
          }
        : {
            target: {
              midi: targets[i],
              cents: now >= begin + listenAfter ? lastCents : null,
              hold: holdStart === null ? 0 : Math.min(1, (lastInTune - holdStart) / holdS),
            },
          }),
    };
    return { view: v, cues: feed.due(now) };
  }

  return { tick, targets, outcomes: () => [...outcomes] };
}

