/**
 * A player's own words for chord moves (#715): "Rate this move". The practice plays a move between
 * two of a key's chords and the player places it on two axes, dark to bright (valence) and settled
 * to tense (tension); the ratings become a caption set of their own beside the interval and the
 * computed ones. Context changes how a chord move feels (the harmony research note, idea E), so a
 * model of THIS player's hearing is the honest alternative to fixed labels: its words say only what
 * this player said, and its model is named as theirs (the #613 rule).
 *
 * A move is rated by scale degree, not by chord: I to vi in C is I to vi in G. Major and minor keys
 * are rated apart (a key counts as the mode of its seven-note parent: the harmonic minor is minor,
 * a pentatonic is its parent's). A move keeps its last {@link MAX_RATINGS_KEPT} ratings, and the
 * caption is their mean, so a player who changes their mind is heard. Only a key's own diatonic
 * chords have a degree here; a borrowed or applied chord gets no rated words.
 *
 * Pure: the records are stored by the host (a zodal collection); this turns them into words, and
 * `./captions` (`ratedCaptions`, the set `mine`) puts the words on a key's moves.
 */
import { z } from 'zod';
import { parentKey, type Key } from './chord';

export const RATING_MODES = ['major', 'minor'] as const;
export type RatingMode = (typeof RATING_MODES)[number];

/** How many ratings a move keeps (the oldest is dropped first). */
export const MAX_RATINGS_KEPT = 12;

/** One rating: both axes -1..1 (dark..bright, settled..tense), and when it was given. */
export const RatingSchema = z.object({
  valence: z.number().min(-1).max(1),
  tension: z.number().min(-1).max(1),
  at: z.number(),
});
export type Rating = z.infer<typeof RatingSchema>;

/** A move's ratings: the mode, the degrees (0..6) it goes from and to, the ratings kept. */
export const MoveRatingsSchema = z.object({
  mode: z.enum(RATING_MODES),
  from: z.number().int().min(0).max(6),
  to: z.number().int().min(0).max(6),
  ratings: z.array(RatingSchema).max(MAX_RATINGS_KEPT),
});
export type MoveRatings = z.infer<typeof MoveRatingsSchema>;

/** A move's mean rating and how many ratings it is the mean of. */
export interface RatedMove {
  valence: number;
  tension: number;
  n: number;
}

/** The player's ratings by move ({@link moveKey}): what a caption reads. */
export type RatingsTable = Readonly<Record<string, RatedMove>>;

/** A key's rating mode: its seven-note parent's. */
export function ratingMode(key: Key): RatingMode {
  return parentKey(key).scale === 'major' ? 'major' : 'minor';
}

export const moveKey = (mode: RatingMode, from: number, to: number): string => `${mode}:${from}>${to}`;

/** The degrees' numerals in each mode (the natural minor's for minor). */
const NUMERALS: Record<RatingMode, readonly string[]> = {
  major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  minor: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
};

/** A move's name: "I → vi (major keys)". */
export function moveName(mode: RatingMode, from: number, to: number): string {
  return `${NUMERALS[mode][from]} → ${NUMERALS[mode][to]} (${mode} keys)`;
}

/** The record name a move is stored under (one record per move). */
export const moveRecordName = (mode: RatingMode, from: number, to: number): string => `${mode} ${from + 1} to ${to + 1}`;

/** A move's ratings with one more (the oldest dropped past {@link MAX_RATINGS_KEPT}). */
export function withRating(prev: MoveRatings | null, mode: RatingMode, from: number, to: number, rating: Rating): MoveRatings {
  const kept = prev && prev.mode === mode && prev.from === from && prev.to === to ? prev.ratings : [];
  return { mode, from, to, ratings: [...kept, rating].slice(-MAX_RATINGS_KEPT) };
}

/** The table of mean ratings over the stored records (a record with no ratings is left out). */
export function ratingsTable(records: readonly MoveRatings[]): RatingsTable {
  const out: Record<string, RatedMove> = {};
  for (const r of records) {
    const n = r.ratings.length;
    if (n === 0) continue;
    const mean = (f: (x: Rating) => number) => r.ratings.reduce((s, x) => s + f(x), 0) / n;
    out[moveKey(r.mode, r.from, r.to)] = { valence: mean((x) => x.valence), tension: mean((x) => x.tension), n };
  }
  return out;
}

/** How far from the middle a mean must be to earn a word (a third of the way to either end). */
export const RATING_WORD_AT = 0.3;

/** A rated move's words: "bright, tense"; "even" when it sits in the middle of both axes. */
export function ratingWords(r: RatedMove): string {
  const words: string[] = [];
  if (r.valence >= RATING_WORD_AT) words.push('bright');
  else if (r.valence <= -RATING_WORD_AT) words.push('dark');
  if (r.tension >= RATING_WORD_AT) words.push('tense');
  else if (r.tension <= -RATING_WORD_AT) words.push('settled');
  return words.length ? words.join(', ') : 'even';
}

/** Every move of a mode: the 42 ordered pairs of different degrees. */
export function movesOf(mode: RatingMode): { mode: RatingMode; from: number; to: number }[] {
  const out: { mode: RatingMode; from: number; to: number }[] = [];
  for (let from = 0; from < 7; from++) for (let to = 0; to < 7; to++) if (from !== to) out.push({ mode, from, to });
  return out;
}

/** How many of a mode's moves have at least one rating. */
export function ratedCount(table: RatingsTable, mode: RatingMode): number {
  return movesOf(mode).filter((m) => table[moveKey(m.mode, m.from, m.to)]).length;
}

/** The next move to rate: one of the least-rated moves of the mode, chosen by `random` (0..1),
 *  never `avoid` (the move just rated) when another is as little rated. */
export function nextMoveToRate(table: RatingsTable, mode: RatingMode, { random = Math.random, avoid }: { random?: () => number; avoid?: { from: number; to: number } } = {}): { mode: RatingMode; from: number; to: number } {
  const moves = movesOf(mode);
  const count = (m: { from: number; to: number }) => table[moveKey(mode, m.from, m.to)]?.n ?? 0;
  const least = Math.min(...moves.map(count));
  let pool = moves.filter((m) => count(m) === least);
  if (avoid && pool.length > 1) pool = pool.filter((m) => m.from !== avoid.from || m.to !== avoid.to);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
