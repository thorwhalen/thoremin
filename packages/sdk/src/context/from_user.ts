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

export const UserKeySchema = z.object({ tonic: z.number().int().min(0).max(11), mode: z.enum(KEY_MODES).default('major') });
export type UserKey = z.infer<typeof UserKeySchema>;

export const UserTempoSchema = z.object({
  bpm: z.number().min(20).max(400),
  /** The song second of a downbeat (bar 1 of the chart). */
  firstBeatS: z.number().min(0),
  beatsPerBar: z.number().int().min(1).max(16).default(4),
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

/** The least-squares line t = t0 + period k through numbered taps (null when it is not a tempo). */
export function fitTaps(taps: readonly NumberedTap[]): { t0: number; period: number } | null {
  const n = taps.length;
  if (n < 2) return null;
  const mk = taps.reduce((s, x) => s + x.k, 0) / n;
  const mt = taps.reduce((s, x) => s + x.t, 0) / n;
  let num = 0;
  let den = 0;
  for (const x of taps) {
    num += (x.k - mk) * (x.t - mt);
    den += (x.k - mk) ** 2;
  }
  const period = den > 0 ? num / den : NaN;
  return period > 0 ? { t0: mt - period * mk, period } : null;
}

/**
 * Number one more tap after a run: its beat number is the last one's plus the gap in beats, at
 * least one (a missed tap counts two); the beat is the run's fitted period, or the median gap
 * before there is one. Returns the run with it (`bounce`: the run unchanged, the tap was a finger
 * bounce; `restart`: a pause, the tap starts a new run as its beat 0).
 */
export function numberTap(run: readonly NumberedTap[], t: number): { run: NumberedTap[]; event: 'added' | 'bounce' | 'restart' } {
  const last = run[run.length - 1];
  if (!last || t <= last.t) return { run: [{ t, k: 0 }], event: last ? 'restart' : 'added' };
  const gaps = run.slice(1).map((x, i) => (x.t - run[i].t) / Math.max(1, x.k - run[i].k));
  const fit = run.length >= 3 ? fitTaps(run) : null;
  const beat = fit?.period ?? (gaps.length ? median(gaps) : t - last.t);
  const gap = t - last.t;
  if ((gaps.length && gap < TAP_BOUNCE * beat) || gap < TAP_MIN_GAP_S) return { run: [...run], event: 'bounce' };
  if (gaps.length && gap > TAP_PAUSE * beat) return { run: [{ t, k: 0 }], event: 'restart' };
  return { run: [...run, { t, k: last.k + Math.max(1, Math.round(gap / beat)) }], event: 'added' };
}

/** A run's tempo, its downbeat at beat 0 (null with fewer than `minTaps` taps or no tempo). */
export function tempoOfRun(run: readonly NumberedTap[], { minTaps = 4, beatsPerBar = 4 }: { minTaps?: number; beatsPerBar?: number } = {}): UserTempo | null {
  if (run.length < minTaps) return null;
  const fit = fitTaps(run);
  if (!fit) return null;
  return UserTempoSchema.parse({ bpm: Math.min(400, Math.max(20, 60 / fit.period)), firstBeatS: Math.max(0, fit.t0), beatsPerBar });
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
    beats = Array.from({ length: count }, (_, k) => ({ t: entry.tempo!.firstBeatS + k * period, confidence: 1 }));
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
