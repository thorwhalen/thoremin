/**
 * Reading a {@link MusicalContext} at a song position: the beat ruler both ways, the key and the
 * chord in force, the next of each, and what is coming within a horizon (the expectations a
 * follower or a wait gate checks the player against).
 *
 * Every lookup is a binary search over a list sorted by time, so a reader can call these on every
 * tick. Pure.
 */
import type { ChordSpan, KeyRegion, MelodyNote, MusicalContext } from './schema';

const EPS = 1e-9;

interface Span {
  start: number;
  end: number;
}

/** The index of the last item whose `key(item) <= x`, or -1. */
function lastAtOrBefore<T>(items: readonly T[], x: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= x + EPS) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Song seconds of a (fractional) beat of the ruler; past either end, at the nearest beat
 *  period. NaN when the ruler has fewer than two beats. */
export function secondsOfBeat(ctx: Pick<MusicalContext, 'beats'>, beat: number): number {
  const b = ctx.beats;
  if (b.length < 2 || !Number.isFinite(beat)) return NaN;
  const last = b.length - 1;
  if (beat <= 0) return b[0].t + beat * (b[1].t - b[0].t);
  if (beat >= last) return b[last].t + (beat - last) * (b[last].t - b[last - 1].t);
  const i = Math.floor(beat);
  return b[i].t + (beat - i) * (b[i + 1].t - b[i].t);
}

/** The (fractional) beat of the ruler at song seconds `s`: the inverse of {@link secondsOfBeat}. */
export function beatOfSeconds(ctx: Pick<MusicalContext, 'beats'>, s: number): number {
  const b = ctx.beats;
  if (b.length < 2 || !Number.isFinite(s)) return NaN;
  const last = b.length - 1;
  if (s <= b[0].t) return (s - b[0].t) / (b[1].t - b[0].t || 1);
  if (s >= b[last].t) return last + (s - b[last].t) / (b[last].t - b[last - 1].t || 1);
  const i = lastAtOrBefore(b, s, (x) => x.t);
  const span = b[i + 1].t - b[i].t;
  return i + (span > 0 ? (s - b[i].t) / span : 0);
}

/** The span in force at `s` (start <= s < end), or null. */
export function spanAt<T extends Span>(spans: readonly T[], s: number): T | null {
  const i = lastAtOrBefore(spans, s, (x) => x.start);
  return i >= 0 && s < spans[i].end - EPS ? spans[i] : null;
}

/** The first span that starts after `s`, or null. */
export function nextSpan<T extends Span>(spans: readonly T[], s: number): T | null {
  return spans[lastAtOrBefore(spans, s, (x) => x.start) + 1] ?? null;
}

/** The key region in force at `s`: before the first, the first; after the last, the last (the
 *  key a piece ended in is still its key). Null without keys. */
export function keyAt(ctx: Pick<MusicalContext, 'keys'>, s: number): KeyRegion | null {
  const k = ctx.keys;
  if (!k.length) return null;
  const i = lastAtOrBefore(k, s, (x) => x.start);
  return k[Math.max(0, i)];
}

/** The chord in force at `s`, or null (before the first, after the last, or in a gap). */
export const chordAt = (ctx: Pick<MusicalContext, 'chords'>, s: number): ChordSpan | null => spanAt(ctx.chords, s);

/** Something the music is about to do, at a song time. */
export type Expectation =
  | { kind: 'bar'; t: number }
  | { kind: 'key'; t: number; key: KeyRegion }
  | { kind: 'chord'; t: number; chord: ChordSpan }
  | { kind: 'note'; t: number; note: MelodyNote };

/** What starts after `s` and no later than `s + horizonS`, in time order (a bar line before the
 *  key or chord change it carries, then the melody note). */
export function expectations(ctx: MusicalContext, s: number, horizonS: number): Expectation[] {
  const to = s + Math.max(0, horizonS);
  const out: Expectation[] = [];
  const within = (t: number) => t > s + EPS && t <= to + EPS;
  const from = <T>(items: readonly T[], key: (item: T) => number) => lastAtOrBefore(items, s, key) + 1;
  for (let i = from(ctx.downbeats, (x) => x); i < ctx.downbeats.length && within(ctx.downbeats[i]); i++) out.push({ kind: 'bar', t: ctx.downbeats[i] });
  for (let i = from(ctx.keys, (x) => x.start); i < ctx.keys.length && within(ctx.keys[i].start); i++) out.push({ kind: 'key', t: ctx.keys[i].start, key: ctx.keys[i] });
  for (let i = from(ctx.chords, (x) => x.start); i < ctx.chords.length && within(ctx.chords[i].start); i++) out.push({ kind: 'chord', t: ctx.chords[i].start, chord: ctx.chords[i] });
  for (let i = from(ctx.melody, (x) => x.start); i < ctx.melody.length && within(ctx.melody[i].start); i++) out.push({ kind: 'note', t: ctx.melody[i].start, note: ctx.melody[i] });
  const order = { bar: 0, key: 1, chord: 2, note: 3 } as const;
  return out.sort((a, b) => a.t - b.t || order[a.kind] - order[b.kind]);
}
