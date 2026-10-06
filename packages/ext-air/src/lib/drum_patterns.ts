/**
 * Drum patterns as data (#269): short repeated scores written as a grid, compiled to the
 * score document, shipped as a handful of starters.
 *
 * ## The grid
 *
 * One row per drum, one character per subdivision (sixteenths by default), read left to
 * right through the bar:
 *
 *     kick   x...x...x...x...
 *     snare  ....x.......x...
 *     hihat  x.x.x.x.x.x.x.x.
 *
 * `x` is a hit, `X` an accent, `.` nothing, and spaces or `|` between groups are ignored,
 * so a row may be written `x... x... x... x...`. Every row of a pattern has the same
 * length once the fillers are dropped, and that length is the pattern's length in
 * subdivisions: a two-bar pattern is a row of 32.
 *
 * ## Why a ScoreDoc
 *
 * A pattern compiles to a `ScoreDoc` with one percussion part (the schema already carries
 * the flag) at the stated tempo, so it is a score like any other: the score node could
 * play it as a backing track, a drum track from a MIDI file could become a pattern by
 * the same route, and the trainer's fit (`src/drums/pattern_fit.ts`) works on the
 * compiled events, not on the text. The drum names map to General MIDI numbers and to
 * the air drum's sounds through `gm_drums.ts`. Pure.
 */
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import type { DrumSound } from '@thoremin/sdk/nodes/music/drum_pads';
import { DRUM_MIDI, DRUM_NAMES, DRUM_SOUND, type DrumName } from './gm_drums';

export interface DrumPatternInput {
  id: string;
  name: string;
  bpm: number;
  /** Subdivisions per beat (quarter note). Default 4: sixteenths. */
  stepsPerBeat?: number;
  /** The grid, one row per drum. */
  rows: Partial<Record<DrumName, string>>;
  /** One line on what it is for. */
  description?: string;
}

/** One hit of a pattern, in the pattern's own time. */
export interface PatternEvent {
  /** Position in the event list, the fit's key for it. */
  index: number;
  /** The subdivision it falls on, 0-based. */
  step: number;
  /** Onset in beats from the pattern's start. */
  beat: number;
  drum: DrumName;
  midi: number;
  sound: DrumSound;
  accent: boolean;
}

export interface DrumPattern {
  id: string;
  name: string;
  description: string;
  bpm: number;
  stepsPerBeat: number;
  /** Subdivisions in the pattern (its length). */
  steps: number;
  lengthBeats: number;
  /** The rows as written, fillers dropped, for the strip. */
  rows: Partial<Record<DrumName, string>>;
  /** Events in time order, ties by row order (`DRUM_NAMES`). */
  events: PatternEvent[];
  score: ScoreDoc;
}

const ACCENT_VELOCITY = 1;
const HIT_VELOCITY = 0.75;

/** A row with its fillers dropped. Throws on a character that is not a step. */
export function cleanRow(row: string): string {
  const out = row.replace(/[\s|]/g, '');
  const bad = out.replace(/[xX.]/g, '');
  if (bad.length > 0) throw new Error(`drum pattern row "${row}": unknown step "${bad[0]}"`);
  return out;
}

/** Compile a grid to a pattern. Throws on rows of unequal length, an empty pattern, or an
 *  unknown drum: patterns are constants, and a typo should fail at import. */
export function compilePattern(input: DrumPatternInput): DrumPattern {
  const stepsPerBeat = input.stepsPerBeat ?? 4;
  const rows: Partial<Record<DrumName, string>> = {};
  let steps = -1;
  for (const [name, row] of Object.entries(input.rows) as [DrumName, string][]) {
    if (!DRUM_NAMES.includes(name)) throw new Error(`drum pattern "${input.id}": unknown drum "${name}"`);
    const clean = cleanRow(row);
    if (steps >= 0 && clean.length !== steps) throw new Error(`drum pattern "${input.id}": row "${name}" has ${clean.length} steps, expected ${steps}`);
    steps = clean.length;
    rows[name] = clean;
  }
  if (steps <= 0) throw new Error(`drum pattern "${input.id}": no steps`);
  const events: PatternEvent[] = [];
  for (let step = 0; step < steps; step++) {
    for (const drum of DRUM_NAMES) {
      const ch = rows[drum]?.[step];
      if (ch !== 'x' && ch !== 'X') continue;
      events.push({ index: events.length, step, beat: step / stepsPerBeat, drum, midi: DRUM_MIDI[drum], sound: DRUM_SOUND[drum], accent: ch === 'X' });
    }
  }
  const lengthBeats = steps / stepsPerBeat;
  const score: ScoreDoc = {
    v: 1,
    title: input.name,
    source: 'builtin',
    parts: [
      {
        id: 'drums',
        name: 'Drums',
        percussion: true,
        notes: events.map((e) => ({ midi: e.midi, start: e.beat, duration: 1 / stepsPerBeat, velocity: e.accent ? ACCENT_VELOCITY : HIT_VELOCITY })),
      },
    ],
    tempoMap: [{ beat: 0, bpm: input.bpm }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    dynamics: [],
    fermatas: [],
    lengthBeats,
  };
  return { id: input.id, name: input.name, description: input.description ?? '', bpm: input.bpm, stepsPerBeat, steps, lengthBeats, rows, events, score };
}

/** The time of an event in a given pass, from a tempo and a start, seconds. */
export function eventTime(pattern: Pick<DrumPattern, 'lengthBeats'>, event: Pick<PatternEvent, 'beat'>, pass: number, bpm: number, start: number): number {
  return start + ((pass * pattern.lengthBeats + event.beat) * 60) / bpm;
}

/**
 * The starters: what a first drum lesson asks for, at tempos an air stroke can keep.
 * Ninety to a hundred beats per minute, since a stroke in the air is slower than a stick
 * on a head and the predictor needs a fall to read.
 */
export const DRUM_PATTERNS: readonly DrumPattern[] = [
  {
    id: 'rock',
    name: 'Rock beat',
    description: 'The basic beat: kick on one and three, snare on two and four, eighths on the hi-hat.',
    bpm: 96,
    rows: { kick: 'x... .... x... ....', snare: '.... x... .... x...', hihat: 'x.x. x.x. x.x. x.x.' },
  },
  {
    id: 'rock-open',
    name: 'Rock beat, open hi-hat on the and of four',
    description: 'The rock beat with the hi-hat opened on the last eighth, the classic turn into the next bar.',
    bpm: 96,
    rows: { kick: 'x... .... x... ....', snare: '.... x... .... x...', hihat: 'x.x. x.x. x.x. x...', openHihat: '.... .... .... ..x.' },
  },
  {
    id: 'rock-kick',
    name: 'Rock beat, extra kick',
    description: 'A second kick on the and of three: the backbeat variation every drummer plays first.',
    bpm: 96,
    rows: { kick: 'x... .... x.x. ....', snare: '.... x... .... x...', hihat: 'x.x. x.x. x.x. x.x.' },
  },
  {
    id: 'half-time',
    name: 'Half-time feel',
    description: 'One snare per bar, on three, the kick on one: twice the room for each stroke.',
    bpm: 90,
    rows: { kick: 'x... .... .... ....', snare: '.... .... x... ....', hihat: 'x.x. x.x. x.x. x.x.' },
  },
  {
    id: 'four-floor',
    name: 'Four on the floor',
    description: 'Kick on every beat, snare on two and four, hi-hat off-beats.',
    bpm: 100,
    rows: { kick: 'x... x... x... x...', snare: '.... x... .... x...', hihat: '..x. ..x. ..x. ..x.' },
  },
  {
    id: 'fill',
    name: 'Snare fill',
    description: 'A bar of the rock beat, then a bar of eighths on the snare; the crash lands on the one that follows (the loop\'s first step, with the kick).',
    bpm: 90,
    rows: {
      kick: 'x... .... x... .... | .... .... .... ....',
      snare: '.... x... .... x... | x.x. x.x. x.x. x.X.',
      hihat: 'x.x. x.x. x.x. x.x. | .... .... .... ....',
      crash: 'x... .... .... .... | .... .... .... ....',
    },
  },
].map(compilePattern);

export const patternById = (id: string): DrumPattern | null => DRUM_PATTERNS.find((p) => p.id === id) ?? null;
