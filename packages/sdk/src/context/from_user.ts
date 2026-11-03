/**
 * The player's producer: a timeline from what the player says about the music, for any source
 * (one with no analysis at all included): a key, a tempo tapped along, and a chord chart.
 *
 * - The key is one region over the whole piece.
 * - The tempo (`bpm`, the song second of a downbeat it was tapped from, the beats in a bar) is the
 *   ruler: a beat every period from that downbeat, extrapolated both ways, and a bar line every
 *   `beatsPerBar` beats.
 * - The chart is lead-sheet text, bars between `|`, chords in a bar sharing it equally:
 *   `C | F G | Am7 | G7/B`. `%` repeats the bar before; `N.C.` is no chord. Bar 1 starts on the
 *   tempo's downbeat. A chart needs a ruler: the tempo's, or one a caller passes (a song's own beat
 *   grid, in song seconds).
 *
 * Also the tap-tempo arithmetic (`tempoFromTaps`): taps in song seconds to a tempo and its
 * downbeat, by a least-squares line through the taps' beat numbers.
 *
 * Pure.
 */
import { z } from 'zod';
import { QUALITIES, QUALITY_IDS, type QualityId } from '../harmony/qualities';
import type { Chord } from '../harmony/chord';
import { KEY_MODES, keyPitchClasses, normalizeFifths } from '../score/schema';
import { MusicalContextSchema, type ChordSpan, type MusicalContext } from './schema';
import { secondsOfBeat } from './cursor';
import { olsLine } from '@thoremin/stats/line';

export const UserKeySchema = z.object({ tonic: z.number().int().min(0).max(11), mode: z.enum(KEY_MODES).default('major') });
export type UserKey = z.infer<typeof UserKeySchema>;

/** How fast the ruler forgets: a tap this many beats away weighs half (#945). Measured on scripted
 *  runs with tap jitter: at 2.5 a step from 100 to 130 bpm is followed within a bar, a final
 *  ritardando (120 to 90 over eight beats) lags under half a beat at its last beat (eight beats
 *  lagged most of a beat, as one line through every tap does), and 25 ms of random jitter moves the
 *  tempo now by under half a beat a minute (2 beats moves it more). */
export const RULER_HALF_LIFE_BEATS = 2.5;
/** A ruler point is kept only where the even spacing between its neighbours would miss it by more
 *  than this (seconds, #945): a steady tempo is two points, a changing one as many as it needs. */
export const RULER_TOLERANCE_S = 0.005;
/** The most points a ruler keeps (the run's own cap). */
export const RULER_MAX_POINTS = 128;

/** A tapped beat on the ruler: its beat number from the downbeat, and its song second. */
export const RulerPointSchema = z.object({ k: z.number().int().min(0), t: z.number().min(0) });
export type RulerPoint = z.infer<typeof RulerPointSchema>;

export const UserTempoSchema = z.object({
  /** The tempo now (at the last tapped beat): the ruler goes on at it past its last point. */
  bpm: z.number().min(20).max(400),
  /** The song second of a downbeat (bar 1 of the chart). */
  firstBeatS: z.number().min(0),
  beatsPerBar: z.number().int().min(1).max(16).default(4),
  /**
   * The tapped ruler (#945): where the taps put their beats, smoothed, beat 0 first. Between two
   * points the beats are spaced evenly; past the last, every `60 / bpm`. Absent (an entry from
   * before it): a beat every `60 / bpm` from `firstBeatS`.
   */
  ruler: z
    .array(RulerPointSchema)
    .max(RULER_MAX_POINTS)
    .refine((r) => r.every((p, i) => i === 0 || (p.k > r[i - 1].k && p.t > r[i - 1].t)), 'a ruler goes forward in beats and in time')
    .optional(),
});
export type UserTempo = z.infer<typeof UserTempoSchema>;

/** What the player says about the music. */
export const UserEntrySchema = z.object({
  key: UserKeySchema.nullable().default(null),
  tempo: UserTempoSchema.nullable().default(null),
  chart: z.string().max(4000).default(''),
});
export type UserEntry = z.infer<typeof UserEntrySchema>;

export const EMPTY_USER_ENTRY: UserEntry = UserEntrySchema.parse({});

export const USER_ANALYZER = { name: 'user', version: '1', weightsLicence: 'none' } as const;

/** Whether the entry says anything. */
export const hasUserEntry = (e: UserEntry): boolean => e.key !== null || e.tempo !== null || e.chart.trim() !== '';

const LETTER_PC: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The suffixes a lead sheet writes, onto the SDK's qualities: each quality's own symbol and short
 *  form, plus the common spellings, an extended chord as its seventh chord. */
const SUFFIXES: Readonly<Record<string, QualityId>> = (() => {
  const out: Record<string, QualityId> = {};
  for (const id of QUALITY_IDS) {
    out[QUALITIES[id].symbol] = id;
    out[QUALITIES[id].short] ??= id;
  }
  const alias: Record<string, QualityId> = {
    M: 'maj', maj: 'maj', min: 'min', '-': 'min', o: 'dim', '+': 'aug', M7: 'maj7', Maj7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7',
    min7: 'min7', '-7': 'min7', 'ø': 'hdim7', 'ø7': 'hdim7', o7: 'dim7', 'm(maj7)': 'minmaj7', mM7: 'minmaj7', sus: 'sus4',
    '9': '7', '11': '7', '13': '7', maj9: 'maj7', M9: 'maj7', m9: 'min7', m11: 'min7', '7sus4': 'sus4', add2: 'add9',
  };
  return { ...out, ...alias };
})();

/** One lead-sheet chord symbol (`F#m7`, `Bb/D`, `Gsus4`), or null when it is not one. */
export function parseChordSymbol(raw: string): Chord | null {
  const m = /^([A-Ga-g])([#b]?)(.*?)(?:\/([A-Ga-g])([#b]?))?$/.exec(raw.trim());
  if (!m) return null;
  const pc = (letter: string, acc: string) => (((LETTER_PC[letter.toUpperCase()] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0)) % 12) + 12) % 12;
  const quality = SUFFIXES[m[3]];
  if (!quality) return null;
  const root = pc(m[1], m[2]);
  const bass = m[4] ? pc(m[4], m[5] ?? '') : null;
  return bass !== null && bass !== root ? { root, quality, bass } : { root, quality };
}

/** A chart's bars: each a list of chords (null = no chord), and the tokens that were not chords. */
export function parseChart(text: string): { bars: (Chord | null)[][]; errors: string[] } {
  const errors: string[] = [];
  const bars: (Chord | null)[][] = [];
  const cells = text.split('|').map((b) => b.trim());
  // A chart written with bar lines at both ends has an empty first and last cell.
  while (cells.length && cells[0] === '') cells.shift();
  while (cells.length && cells[cells.length - 1] === '') cells.pop();
  for (const cell of cells) {
    if (cell === '%') {
      bars.push([...(bars[bars.length - 1] ?? [null])]);
      continue;
    }
    const chords: (Chord | null)[] = [];
    for (const token of cell.split(/\s+/).filter(Boolean)) {
      if (/^(n\.?c\.?|-)$/i.test(token)) chords.push(null);
      else {
        const chord = parseChordSymbol(token);
        if (chord) chords.push(chord);
        else errors.push(token);
      }
    }
    bars.push(chords.length ? chords : [null]);
  }
  return { bars, errors };
}

/** A tap closer than this share of a beat to the one before is a bounce, not a beat. */
export const TAP_BOUNCE = 0.4;
/** A gap longer than this many beats is a pause: the count starts again after it. */
export const TAP_PAUSE = 4;
/** A second tap closer than this (seconds: 400 beats a minute) is a bounce: no beat is known yet to
 *  tell it by. */
export const TAP_MIN_GAP_S = 0.15;

/** A tap with its beat number in the run (the run's first tap is beat 0, the downbeat). */
export interface NumberedTap {
  t: number;
  k: number;
}

const median = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * The least-squares line t = t0 + period k through numbered taps (null when it is not a tempo):
 * `@thoremin/stats`'s line. `weight` (default 1 for every tap) makes it a weighted fit:
 * {@link tapRuler} centres one on each tap, so a tempo that changes is followed.
 */
export function fitTaps(taps: readonly NumberedTap[], weight?: (tap: NumberedTap) => number): { t0: number; period: number } | null {
  const line = olsLine(
    taps.map((x) => x.k),
    taps.map((x) => x.t),
    weight ? { weights: taps.map(weight) } : {},
  );
  return line && line.slope > 0 ? { t0: line.intercept, period: line.slope } : null;
}


/** How far a local fit looks, in half-lives: a tap further away weighs under a thousandth. */
const LOCAL_REACH_HALF_LIVES = 10;

/** The weighted fit centred on beat `k`: taps weigh half every `halfLifeBeats` beats away, and those
 *  past the reach are left out (so a long run costs a window per fit, not the whole run). Widened
 *  to the nearest taps either side when the reach holds fewer than two. */
function localFit(run: readonly NumberedTap[], k: number, halfLifeBeats: number) {
  const reach = LOCAL_REACH_HALF_LIVES * halfLifeBeats;
  const near = run.filter((x) => Math.abs(x.k - k) <= reach);
  // Too few in reach (a long gap): the two nearest, unweighted (a far tap's weight would underflow).
  if (near.length < 2) return fitTaps([...run].sort((a, b) => Math.abs(a.k - k) - Math.abs(b.k - k)).slice(0, 2));
  return fitTaps(near, (x) => 0.5 ** (Math.abs(x.k - k) / halfLifeBeats));
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The points that matter: from each kept point, the farthest next point such that the straight
 *  spacing between the two misses every point in between by no more than `toleranceS` (first and
 *  last always kept). */
function thinRuler(points: readonly RulerPoint[], toleranceS: number): RulerPoint[] {
  if (points.length <= 2) return [...points];
  const fits = (i: number, j: number) => {
    const a = points[i];
    const b = points[j];
    for (let m = i + 1; m < j; m++) {
      const p = points[m];
      if (Math.abs(a.t + ((b.t - a.t) * (p.k - a.k)) / (b.k - a.k) - p.t) > toleranceS) return false;
    }
    return true;
  };
  const kept: RulerPoint[] = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    while (j + 1 < points.length && fits(i, j + 1)) j++;
    kept.push(points[j]);
    i = j;
  }
  return kept;
}

/**
 * The ruler a run makes (#945): at each tap's beat number, where a line fitted to the taps around
 * it (weights halving every `halfLifeBeats` beats) puts that beat, so an accelerando or a
 * ritardando is followed beat by beat while the run's first tap stays beat 0; and the period now,
 * the fit's at the last tap. A tap is only a point of the ruler, never a beat that moves the
 * numbering. Null with fewer than two taps.
 */
export function tapRuler(
  run: readonly NumberedTap[],
  { halfLifeBeats = RULER_HALF_LIFE_BEATS, toleranceS = RULER_TOLERANCE_S }: { halfLifeBeats?: number; toleranceS?: number } = {},
): { ruler: RulerPoint[]; period: number } | null {
  const last = run[run.length - 1];
  const now = last ? localFit(run, last.k, halfLifeBeats) : null;
  if (!now) return null;
  const ruler: RulerPoint[] = [];
  for (const x of run) {
    const fit = localFit(run, x.k, halfLifeBeats);
    if (!fit) return null;
    const t = round3(Math.max(0, fit.t0 + fit.period * x.k));
    // Strictly later than the point before (a ruler never goes back).
    if (ruler.length && t <= ruler[ruler.length - 1].t) continue;
    ruler.push({ k: x.k, t });
  }
  if (ruler.length < 2) return null;
  // Within the stored bound: a wider tolerance until it fits.
  let thin = thinRuler(ruler, toleranceS);
  for (let tol = toleranceS * 2; thin.length > RULER_MAX_POINTS; tol *= 2) thin = thinRuler(ruler, tol);
  return { ruler: thin, period: now.period };
}

/**
 * Number one more tap after a run: its beat number is the last one's plus the gap in beats, at
 * least one (a missed tap counts two); the beat is the run's fitted period, or the median gap
 * before there is one. Returns the run with it (`bounce`: the run unchanged, the tap was a finger
 * bounce; `restart`: a pause, the tap starts a new run as its beat 0).
 */
export function numberTap(
  run: readonly NumberedTap[],
  t: number,
  { halfLifeBeats = RULER_HALF_LIFE_BEATS }: { halfLifeBeats?: number } = {},
): { run: NumberedTap[]; event: 'added' | 'bounce' | 'restart' } {
  const last = run[run.length - 1];
  if (!last || t <= last.t) return { run: [{ t, k: 0 }], event: last ? 'restart' : 'added' };
  const gaps = run.slice(1).map((x, i) => (x.t - run[i].t) / Math.max(1, x.k - run[i].k));
  // The beat now: the fit centred on the last tap (a tempo that changes is numbered at its pace).
  const fit = run.length >= 3 ? localFit(run, last.k, halfLifeBeats) : null;
  const beat = fit?.period ?? (gaps.length ? median(gaps) : t - last.t);
  const gap = t - last.t;
  if ((gaps.length && gap < TAP_BOUNCE * beat) || gap < TAP_MIN_GAP_S) return { run: [...run], event: 'bounce' };
  if (gaps.length && gap > TAP_PAUSE * beat) return { run: [{ t, k: 0 }], event: 'restart' };
  return { run: [...run, { t, k: last.k + Math.max(1, Math.round(gap / beat)) }], event: 'added' };
}

/** A run's tempo, its downbeat at beat 0 and its ruler ({@link tapRuler}; null with fewer than
 *  `minTaps` taps or no tempo). */
export function tempoOfRun(
  run: readonly NumberedTap[],
  { minTaps = 4, beatsPerBar = 4, halfLifeBeats = RULER_HALF_LIFE_BEATS }: { minTaps?: number; beatsPerBar?: number; halfLifeBeats?: number } = {},
): UserTempo | null {
  if (run.length < minTaps) return null;
  const made = tapRuler(run, { halfLifeBeats });
  if (!made) return null;
  // A stored value: to a millionth of a beat a minute, so a steady run reads its tempo exactly.
  const bpm = Math.round(Math.min(400, Math.max(20, 60 / made.period)) * 1e6) / 1e6;
  return UserTempoSchema.parse({ bpm, firstBeatS: made.ruler[0].t, beatsPerBar, ruler: made.ruler });
}

/** Beat `k`'s song second on a tempo: between ruler points evenly, past the last at `bpm`, and on a
 *  tempo with no ruler a beat every `60 / bpm` from `firstBeatS`. */
export function beatOnTempo(tempo: UserTempo, k: number): number {
  const period = 60 / tempo.bpm;
  const r = tempo.ruler;
  if (!r || r.length < 2) return tempo.firstBeatS + k * period;
  const lastPoint = r[r.length - 1];
  if (k >= lastPoint.k) return lastPoint.t + (k - lastPoint.k) * period;
  let i = 0;
  while (r[i + 1].k <= k) i++;
  const a = r[i];
  const b = r[i + 1];
  return a.t + ((b.t - a.t) * (k - a.k)) / (b.k - a.k);
}

/**
 * Tap tempo: taps (song seconds) to a tempo and the downbeat it starts from. The taps are numbered
 * one after another (`numberTap`: a missed tap counts two beats, a bounce is dropped, a pause
 * starts again), the first tap of the last run is beat 0 and stays the downbeat however long the
 * player goes on, and a least-squares line through the numbered taps gives the period and the
 * downbeat's time. Null with fewer than `minTaps` taps in the run.
 */
export function tempoFromTaps(taps: readonly number[], options: { minTaps?: number; beatsPerBar?: number } = {}): UserTempo | null {
  let run: NumberedTap[] = [];
  for (const t of [...taps].filter(Number.isFinite).sort((a, b) => a - b)) run = numberTap(run, t).run;
  return tempoOfRun(run, options);
}

/**
 * A chart placed on bar lines that are known (a score's: its pickup and its meter): bar i of the
 * chart from `downbeats[i]` to the next bar line (the last to `endS`), its chords sharing it.
 */
export function chartOnBars(chart: string, downbeats: readonly number[], endS: number): ChordSpan[] {
  const { bars } = parseChart(chart);
  const out: ChordSpan[] = [];
  bars.forEach((bar, b) => {
    const from = downbeats[b];
    if (from === undefined) return;
    const to = downbeats[b + 1] ?? endS;
    if (!(to > from)) return;
    bar.forEach((chord, i) => {
      const start = from + ((to - from) * i) / bar.length;
      const end = from + ((to - from) * (i + 1)) / bar.length;
      if (!chord) return;
      const last = out[out.length - 1];
      if (last && Math.abs(last.end - start) < 1e-9 && last.chord.root === chord.root && last.chord.quality === chord.quality && last.chord.bass === chord.bass) last.end = end;
      else out.push({ start, end, chord, confidence: 1 });
    });
  });
  return out;
}

/** How far ahead a ruler is drawn past the chart (beats): reading extrapolates past it anyway. */
const RULER_PAD_BEATS = 2;

/**
 * The player's timeline. `ruler` (song seconds of beat 0, 1, 2, ...) is used for the chart when
 * the entry has no tempo; with neither, the chart is left out. `durationS`: the piece's length when
 * known.
 */
export function contextFromUser(entry: UserEntry, { ruler, durationS = 0, contentKey = '' }: { ruler?: readonly number[]; durationS?: number; contentKey?: string } = {}): MusicalContext {
  const { bars } = parseChart(entry.chart);
  const beatsPerBar = entry.tempo?.beatsPerBar ?? 4;
  const chartBeats = bars.length * beatsPerBar;
  let beats: { t: number; confidence: number }[] = [];
  if (entry.tempo) {
    const period = 60 / entry.tempo.bpm;
    const count = Math.max(2, chartBeats + RULER_PAD_BEATS, Math.ceil(durationS / period) + 1);
    // Counted from the ruler's last point: its beats before it may have been faster or slower.
    const last = entry.tempo.ruler?.[entry.tempo.ruler.length - 1];
    const ruled = last ? last.k + 1 + Math.max(RULER_PAD_BEATS, Math.ceil((durationS - last.t) / period)) : 0;
    beats = Array.from({ length: Math.max(count, ruled) }, (_, k) => ({ t: beatOnTempo(entry.tempo!, k), confidence: 1 }));
  } else if (ruler && ruler.length >= 2) beats = ruler.map((t) => ({ t, confidence: 1 }));
  const ruled = beats.length >= 2;
  const at = (beat: number) => secondsOfBeat({ beats }, beat);

  const chords: ChordSpan[] = [];
  if (ruled) {
    bars.forEach((bar, b) => {
      bar.forEach((chord, i) => {
        const start = at(b * beatsPerBar + (i * beatsPerBar) / bar.length);
        const end = at(b * beatsPerBar + ((i + 1) * beatsPerBar) / bar.length);
        if (!chord || end <= start) return;
        const last = chords[chords.length - 1];
        if (last && Math.abs(last.end - start) < 1e-9 && last.chord.root === chord.root && last.chord.quality === chord.quality && last.chord.bass === chord.bass) last.end = end;
        else chords.push({ start, end, chord, confidence: 1 });
      });
    });
  }
  const end = Math.max(durationS, chords.length ? chords[chords.length - 1].end : 0, ruled ? beats[beats.length - 1].t : 0);
  const keys = entry.key
    ? [{ start: 0, end: Math.max(end, 1e-6), tonic: entry.key.tonic, mode: entry.key.mode, scalePcs: scaleOf(entry.key), confidence: 1 }]
    : [];
  const downbeats: number[] = [];
  if (ruled) for (let k = 0; k < beats.length; k += beatsPerBar) downbeats.push(beats[k].t);

  return MusicalContextSchema.parse({
    contentKey,
    durationS: end,
    source: 'user',
    analyzers: [USER_ANALYZER],
    beats,
    downbeats,
    meter: ruled ? [{ t: beats[0].t, numerator: beatsPerBar, denominator: 4 }] : [],
    tempo: entry.tempo ? [{ t: entry.tempo.firstBeatS, bpm: entry.tempo.bpm }] : [],
    keys,
    chords,
  });
}

/** The pitch classes of a key from its tonic and mode. */
function scaleOf(key: UserKey): number[] {
  // The signature whose tonic in this mode is the key's: try each, the one that matches.
  for (let f = -6; f <= 6; f++) {
    const pcs = keyPitchClasses({ fifths: normalizeFifths(f), mode: key.mode });
    if (pcs[0] === key.tonic) return pcs;
  }
  return [key.tonic];
}
