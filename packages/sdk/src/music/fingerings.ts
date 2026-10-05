/**
 * Fingering charts (#263) — which fingers are down for each note, per wind instrument,
 * as DATA.
 *
 * A chart is what an air wind instrument knows before its player has shown it anything:
 * the fingering prior (`src/air/fingering_prior.ts`) turns it into an expected hand
 * shape per note, the fingering guide draws it, and a scripted sequence of notes reads
 * its notes off it. Nothing here is a hand vector; this file is music, not vision.
 *
 * ## The finger names
 *
 * `LT` the left thumb, `L1..L4` the left index, middle, ring and little fingers, `R1..R4`
 * the same on the right. A fingering lists the fingers that are DOWN (pressing a key or
 * covering a hole); every other finger is up. Named keys a finger works (the flute's Eb
 * key under `R4`, the G# lever under `L4`, the clarinet's register key under `LT`) are
 * carried as `keys`, for the guide's caption: the prior reads only the finger.
 *
 * The right thumb is not a finger here: on every instrument in this file it holds the
 * instrument (or rests) and presses nothing, so a chart cannot have an opinion on it.
 *
 * ## Notation
 *
 * Each fingering is written as a short string, the two hands separated by `|`: `T` for
 * the thumb, `1`..`4` for the fingers, in any order, `-` allowed as filler. `T123|12-4`
 * is the flute's E: left thumb and three fingers, right index and middle, right little
 * finger on the Eb key. This is the same shape a printed chart shows, read left to right.
 *
 * ## Sources
 *
 * `docs/research/fingering-priors-and-sequence-training.md` lists the charts each table
 * was checked against. The tables here are the STANDARD fingerings (what a method book
 * teaches first); common alternates are listed where a player is likely to use them.
 */
import { parseNoteName } from './notes';
import { midiToName } from './theory';

export const FINGER_IDS = ['LT', 'L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'] as const;
export type FingerId = (typeof FINGER_IDS)[number];

/** A finger's state in a fingering. */
export type FingerState = 'down' | 'up';

export interface Fingering {
  /** The note, scientific pitch notation as `parseNoteName` reads it ("D5", "F#4", "Bb4"). */
  note: string;
  midi: number;
  /** The fingers that are down. */
  down: readonly FingerId[];
  /** Named keys or holes worked in this fingering, for the caption ("Eb key"). */
  keys: readonly string[];
  /** Other fingerings for the same note a player may use, with a name each. */
  alternates: readonly { name: string; down: readonly FingerId[]; keys: readonly string[] }[];
}

export interface FingeringChart {
  /** The chart's id (`flute`, `recorder-baroque`, …). */
  id: string;
  /** The instrument, for a label. */
  name: string;
  /** Written notes: what the chart's `note` names are. `transposition` is what SOUNDS,
   *  in semitones from written (a Bb clarinet's written C sounds Bb: -2). */
  transposition: number;
  fingerings: readonly Fingering[];
}

const HAND_PREFIX = { left: 'L', right: 'R' } as const;

/** Parse the `T123|12-4` notation into finger ids. Throws on a malformed string: charts
 *  are constants, and a typo should fail at import. */
export function parseFingers(shape: string): FingerId[] {
  const parts = shape.split('|');
  if (parts.length !== 2) throw new Error(`fingering "${shape}": expected two hands separated by |`);
  const out: FingerId[] = [];
  (['left', 'right'] as const).forEach((hand, i) => {
    for (const ch of parts[i].replace(/[\s-]/g, '')) {
      const id = ch === 'T' ? (`${HAND_PREFIX[hand]}T` as FingerId) : /[1-4]/.test(ch) ? (`${HAND_PREFIX[hand]}${ch}` as FingerId) : null;
      if (!id) throw new Error(`fingering "${shape}": unknown finger "${ch}"`);
      if (!out.includes(id)) out.push(id);
    }
  });
  return out;
}

interface AltInput {
  name: string;
  shape: string;
  keys?: readonly string[];
}

/** One chart row. */
function f(note: string, shape: string, keys: readonly string[] = [], alternates: readonly AltInput[] = []): Fingering {
  const spec = parseNoteName(note);
  if (!spec) throw new Error(`fingering chart: "${note}" is not a note name`);
  return {
    note: spec.name,
    midi: spec.midi,
    down: parseFingers(shape),
    keys,
    alternates: alternates.map((a) => ({ name: a.name, down: parseFingers(a.shape), keys: a.keys ?? [] })),
  };
}

/** The state of every finger in a fingering. */
export function fingerStates(fingering: Pick<Fingering, 'down'>): Record<FingerId, FingerState> {
  const down = new Set(fingering.down);
  return Object.fromEntries(FINGER_IDS.map((id) => [id, down.has(id) ? 'down' : 'up'])) as Record<FingerId, FingerState>;
}

/** A fingering's identity as a shape: the sorted down set, joined. Two notes with the same
 *  key are the same finger shape (the flute's E4 and E5). */
export function fingeringKey(fingering: Pick<Fingering, 'down'>): string {
  return [...fingering.down].sort().join(' ');
}

/** The chart's fingering for a note (by name or MIDI number), or null. Enharmonics match:
 *  `Eb4` finds the row written `D#4`. */
export function fingeringFor(chart: FingeringChart, note: string | number): Fingering | null {
  const midi = typeof note === 'number' ? note : parseNoteName(note)?.midi;
  if (midi === undefined) return null;
  return chart.fingerings.find((x) => x.midi === midi) ?? null;
}

/** The chart's notes in ascending order, optionally within [lo, hi] (inclusive, by MIDI). */
export function chartNotes(chart: FingeringChart, range?: [string | number, string | number]): Fingering[] {
  const lo = range ? (typeof range[0] === 'number' ? range[0] : parseNoteName(range[0])?.midi ?? -Infinity) : -Infinity;
  const hi = range ? (typeof range[1] === 'number' ? range[1] : parseNoteName(range[1])?.midi ?? Infinity) : Infinity;
  return [...chart.fingerings].filter((x) => x.midi >= lo && x.midi <= hi).sort((a, b) => a.midi - b.midi);
}

/**
 * Group a chart's notes by finger shape: one entry per distinct fingering, its notes in
 * ascending order. This is what a hand can tell apart: a webcam sees the fingers, not the
 * octave, so notes sharing a shape are one class to the prior.
 */
export function distinctFingerings(chart: FingeringChart, range?: [string | number, string | number]): { key: string; down: readonly FingerId[]; notes: Fingering[] }[] {
  const groups = new Map<string, { key: string; down: readonly FingerId[]; notes: Fingering[] }>();
  for (const x of chartNotes(chart, range)) {
    const key = fingeringKey(x);
    const g = groups.get(key);
    if (g) g.notes.push(x);
    else groups.set(key, { key, down: x.down, notes: [x] });
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------------------
// The Boehm flute (C foot). Written = sounding. The left thumb on the B key is `T`; the
// Bb thumb key is a named key on the same thumb. The right little finger works the Eb
// key (down for nearly every note: it is the flute's resting position, so a chart shows
// it down), and on the foot joint the C# and C keys.
// ---------------------------------------------------------------------------------------

const EB = 'Eb key';
const GSHARP = 'G# lever';
const FLUTE_FIRST_OCTAVE: [string, string, string[], AltInput[]?][] = [
  ['C4', 'T123|1234', ['C key (foot)']],
  ['C#4', 'T123|1234', ['C# key (foot)']],
  ['D4', 'T123|123-', []],
  ['D#4', 'T123|1234', [EB]],
  ['E4', 'T123|12-4', [EB]],
  ['F4', 'T123|1--4', [EB]],
  ['F#4', 'T123|--34', [EB], [{ name: 'R2 (older charts)', shape: 'T123|-2-4', keys: [EB] }]],
  ['G4', 'T123|---4', [EB]],
  ['G#4', 'T1234|---4', [GSHARP, EB]],
  ['A4', 'T12-|---4', [EB]],
  [
    'A#4',
    'T1--|---4',
    ['Bb thumb key', EB],
    [
      { name: 'one and one', shape: 'T1--|1--4', keys: [EB] },
      { name: 'side (Bb lever)', shape: 'T1--|---4', keys: ['Bb side lever (R1)', EB] },
    ],
  ],
  ['B4', 'T1--|---4', [EB]],
  ['C5', '-1--|---4', [EB]],
  ['C#5', '----|---4', [EB]],
];

/** The second octave repeats the first from E, overblown; D and D# lift the left index. */
function fluteSecondOctave(): [string, string, string[], AltInput[]?][] {
  const rows: [string, string, string[], AltInput[]?][] = [
    ['D5', 'T-23|123-', []],
    ['D#5', 'T-23|1234', [EB]],
  ];
  for (const [note, shape, keys, alts] of FLUTE_FIRST_OCTAVE) {
    const spec = parseNoteName(note)!;
    if (spec.midi < parseNoteName('E4')!.midi) continue;
    rows.push([`${note.slice(0, -1)}${Number(note.at(-1)) + 1}`, shape, keys, alts]);
  }
  return rows;
}

/** The third octave: its own fingerings (harmonics steered by venting). Less standard
 *  than the first two: charts differ on several notes, and this table is the commonly
 *  taught set; the prior's default range stops below it. */
const FLUTE_THIRD_OCTAVE: [string, string, string[], AltInput[]?][] = [
  ['D6', 'T-23|---4', [EB]],
  ['D#6', 'T1234|-234', [GSHARP, EB]],
  ['E6', 'T12-|12-4', [EB]],
  ['F6', 'T1-3|1--4', [EB]],
  ['F#6', 'T1-3|--34', ['Bb thumb key', EB]],
  ['G6', '-123|---4', [EB]],
  ['G#6', '--234|---4', [GSHARP, EB]],
  ['A6', 'T-2-|1--4', [EB]],
  ['A#6', 'T---|1--4', [EB]],
  ['B6', 'T1-3|---4', ['Bb thumb key', EB]],
  ['C7', '-1234|1--4', [GSHARP, EB]],
];

export const FLUTE_CHART: FingeringChart = {
  id: 'flute',
  name: 'Flute (Boehm, C foot)',
  transposition: 0,
  fingerings: [...FLUTE_FIRST_OCTAVE, ...fluteSecondOctave(), ...FLUTE_THIRD_OCTAVE].map(([n, s, k, a]) => f(n, s, k, a)),
};

// ---------------------------------------------------------------------------------------
// Soprano recorder, baroque (English) and German fingering. Hole 0 is the thumb; the
// second octave mostly "pinches" the thumb hole (half-open), which to a hand is still a
// thumb down. Half-holes are a finger down with the hole named. The two systems differ at
// F, F# and G# (the German system plain where the baroque forks).
// ---------------------------------------------------------------------------------------

const PINCH = 'thumb pinched (half-open)';
const RECORDER_BAROQUE_FIRST: [string, string, string[]][] = [
  ['C5', 'T123|1234', []],
  ['C#5', 'T123|1234', ['R4 half-hole']],
  ['D5', 'T123|123-', []],
  ['D#5', 'T123|123-', ['R3 half-hole', 'forked']],
  ['E5', 'T123|12--', []],
  ['F5', 'T123|1-34', ['forked']],
  ['F#5', 'T123|-23-', ['forked']],
  ['G5', 'T123|----', []],
  ['G#5', 'T12-|123-', ['R3 half-hole', 'forked']],
  ['A5', 'T12-|----', []],
  ['A#5', 'T1-3|1---', ['forked']],
  ['B5', 'T1--|----', []],
];

/** The German system's F is the plain one (R1 only); its F# is a deeper fork, and its G#
 *  a plain one. */
const RECORDER_GERMAN_FIRST: [string, string, string[]][] = RECORDER_BAROQUE_FIRST.map(([n, s, k]) =>
  n === 'F5' ? ['F5', 'T123|1---', []] : n === 'F#5' ? ['F#5', 'T123|-234', ['forked']] : n === 'G#5' ? ['G#5', 'T12-|12--', ['forked']] : [n, s, k],
);

/** The second octave, per the Woodwind Fingering Guide: D and Eb with the thumb OPEN, the
 *  rest with it pinched, and only E, G and A on the first octave's fingers; F, F#, G#,
 *  Bb and B are forks of their own, F and F# differing between the systems. C7 and above
 *  are left out (charts vary). */
function recorderSecondOctave(system: 'baroque' | 'german'): [string, string, string[]][] {
  const baroque = system === 'baroque';
  return [
    ['D6', '--2-|----', ['thumb open']],
    ['D#6', '--23|123-', ['thumb open', 'forked']],
    ['E6', 'T123|12--', [PINCH]],
    baroque ? ['F6', 'T123|1-3-', [PINCH, 'forked']] : ['F6', 'T123|1---', [PINCH]],
    baroque ? ['F#6', 'T123|-2--', [PINCH, 'forked']] : ['F#6', 'T123|-2-4', [PINCH, 'forked']],
    ['G6', 'T123|----', [PINCH]],
    ['G#6', 'T12-|1---', [PINCH, 'forked']],
    ['A6', 'T12-|----', [PINCH]],
    ['A#6', 'T12-|123-', [PINCH, 'forked']],
    ['B6', 'T12-|12--', [PINCH, 'forked']],
  ];
}

export const RECORDER_BAROQUE_CHART: FingeringChart = {
  id: 'recorder-baroque',
  name: 'Soprano recorder (baroque fingering)',
  transposition: 0,
  fingerings: [...RECORDER_BAROQUE_FIRST, ...recorderSecondOctave('baroque')].map(([n, s, k]) => f(n, s, k)),
};

export const RECORDER_GERMAN_CHART: FingeringChart = {
  id: 'recorder-german',
  name: 'Soprano recorder (German fingering)',
  transposition: 0,
  fingerings: [...RECORDER_GERMAN_FIRST, ...recorderSecondOctave('german')].map(([n, s, k]) => f(n, s, k)),
};

// ---------------------------------------------------------------------------------------
// Bb clarinet (Boehm system), written. The thumb hole is `T`; the register key is the
// same thumb (rolled up), so a clarion note is its chalumeau twelfth's fingers with the
// thumb still down and 'register key' named. The throat tones (G4 to Bb4) are the open
// tube with a side or throat key: nearly no fingers, which a hand cannot tell apart.
// ---------------------------------------------------------------------------------------

const REG = 'register key';
const CLARINET_CHALUMEAU: [string, string, string[]][] = [
  ['E3', 'T123|123-', ['E key (pinky)']],
  ['F3', 'T123|123-', ['F key (pinky)']],
  ['F#3', 'T123|123-', ['F#/C# key (pinky)']],
  ['G3', 'T123|123-', []],
  ['G#3', 'T123|123-', ['Ab/Eb key (pinky)']],
  ['A3', 'T123|12--', []],
  ['A#3', 'T123|1---', []],
  ['B3', 'T123|----', []],
  ['C4', 'T12-|----', []],
  ['C#4', 'T12-|----', ['C#/G# key (pinky)']],
  ['D4', 'T1--|----', []],
  ['D#4', 'T1--|----', ['Ab/Eb key (pinky)']],
  ['E4', 'T---|----', []],
  ['F4', '-1--|----', []],
  ['F#4', '-1--|----', ['G# throat key']],
  ['G4', '----|----', []],
  ['G#4', '-1--|----', ['G# throat key (L1)']],
  ['A4', '-1--|----', ['A throat key (L1)']],
  ['A#4', 'T1--|----', ['A throat key (L1)', REG]],
];

/** Clarion: the chalumeau fingering a twelfth below, plus the register key (the thumb
 *  stays down: it presses the key). Up to C6, the twelfth of F4. */
function clarinetClarion(): [string, string, string[]][] {
  const out: [string, string, string[]][] = [];
  const top = parseNoteName('F4')!.midi;
  for (const [n, s, k] of CLARINET_CHALUMEAU) {
    const spec = parseNoteName(n)!;
    if (spec.midi > top) break;
    out.push([midiToName(spec.midi + 19), `T${s.slice(1)}`, [REG, ...k]]);
  }
  return out;
}

export const CLARINET_CHART: FingeringChart = {
  id: 'clarinet',
  name: 'Bb clarinet (Boehm system), written',
  transposition: -2,
  fingerings: [...CLARINET_CHALUMEAU, ...clarinetClarion()].map(([n, s, k]) => f(n, s, k)),
};

// ---------------------------------------------------------------------------------------
// Alto saxophone, written. No thumb hole: the left thumb is the octave key (down in the
// second octave). The little fingers work the pinky tables (low Bb, B, C#, G#) and the Eb
// and C keys; the palm keys (D, Eb, F) at the top are the left palm, no finger, so those
// notes look like an open hand.
// ---------------------------------------------------------------------------------------

const OCT = 'octave key';
const SAX_FIRST: [string, string, string[]][] = [
  ['A#3', '-1234|1234', ['low Bb key (L4)', 'low C key (R4)']],
  ['B3', '-1234|1234', ['low B key (L4)', 'low C key (R4)']],
  ['C4', '-123|1234', ['low C key (R4)']],
  ['C#4', '-1234|123-', ['low C# key (L4)']],
  ['D4', '-123|123-', []],
  ['D#4', '-123|1234', ['Eb key (R4)']],
  ['E4', '-123|12--', []],
  ['F4', '-123|1---', []],
  ['F#4', '-123|-2--', [], ],
  ['G4', '-123|----', []],
  ['G#4', '-1234|----', ['G# key (L4)']],
  ['A4', '-12-|----', []],
  ['A#4', '-1--|1---', ['bis: L1 and R1 (or the side Bb key)']],
  ['B4', '-1--|----', []],
  ['C5', '--2-|----', []],
  ['C#5', '----|----', []],
];

function saxSecondOctave(): [string, string, string[]][] {
  const rows: [string, string, string[]][] = [];
  for (const [n, s, k] of SAX_FIRST) {
    const spec = parseNoteName(n)!;
    if (spec.midi < parseNoteName('D4')!.midi) continue;
    rows.push([`${n.slice(0, -1)}${Number(n.at(-1)) + 1}`, `T${s.slice(1)}`, [OCT, ...k]]);
  }
  rows.push(['D6', 'T---|----', [OCT, 'palm D key']]);
  rows.push(['D#6', 'T---|----', [OCT, 'palm D and Eb keys']]);
  rows.push(['E6', 'T---|----', [OCT, 'palm D, Eb and F keys', 'side E key (R1)']]);
  rows.push(['F6', 'T---|----', [OCT, 'palm D, Eb and F keys', 'side E and F keys']]);
  return rows;
}

export const ALTO_SAX_CHART: FingeringChart = {
  id: 'alto-sax',
  name: 'Alto saxophone, written',
  transposition: -9,
  fingerings: [...SAX_FIRST, ...saxSecondOctave()].map(([n, s, k]) => f(n, s, k)),
};

// ---------------------------------------------------------------------------------------
// Oboe (conservatoire system), written. No thumb hole: the left thumb works the first
// octave key (down from E5); the second octave key is under the left index. Three notes
// (C#5, D5, Eb5) half-hole the left index (a finger down with 'half-hole' named).
// ---------------------------------------------------------------------------------------

const HALF = 'L1 half-hole';
const OBOE_FIRST: [string, string, string[], AltInput[]?][] = [
  ['A#3', '-123|1234', ['low Bb key (R4)']],
  ['B3', '-123|1234', ['low B key (R4)']],
  ['C4', '-123|1234', ['low C key (R4)']],
  ['C#4', '-123|1234', ['C# key (R4)']],
  ['D4', '-123|123-', []],
  ['D#4', '-123|1234', ['Eb key (R4)']],
  ['E4', '-123|12--', []],
  ['F4', '-123|12-4', ['F key (R4)'], [{ name: 'forked F', shape: '-123|1-34', keys: ['Eb key (R4)'] }]],
  ['F#4', '-123|1---', []],
  ['G4', '-123|----', []],
  ['G#4', '-1234|----', ['G# key (L4)']],
  ['A4', '-12-|----', []],
  ['A#4', '-12-|1---', []],
  ['B4', '-1--|----', []],
  ['C5', '-1--|1---', []],
  ['C#5', '-123|123-', [HALF]],
  ['D5', '-123|123-', [HALF]],
  ['D#5', '-123|1234', [HALF, 'Eb key (R4)']],
  ['E5', 'T123|12--', ['octave key I']],
  ['F5', 'T123|12-4', ['octave key I', 'F key (R4)']],
  ['F#5', 'T123|1---', ['octave key I']],
  ['G5', 'T123|----', ['octave key I']],
  ['G#5', 'T1234|----', ['octave key I', 'G# key']],
  ['A5', '-12-|----', ['octave key II (L1 rolled)']],
  ['A#5', '-12-|1---', ['octave key II']],
  ['B5', '-1--|----', ['octave key II']],
  ['C6', '-1--|1---', ['octave key II']],
];

export const OBOE_CHART: FingeringChart = {
  id: 'oboe',
  name: 'Oboe (conservatoire system)',
  transposition: 0,
  fingerings: OBOE_FIRST.map(([n, s, k, a]) => f(n, s, k, a)),
};

// ---------------------------------------------------------------------------------------
// Tin whistle in D (and the six-hole Irish flute): six fingers, no thumb, the octave by
// breath alone. The simplest chart, and the "penny-whistle scale" every other wind's
// main line shares.
// ---------------------------------------------------------------------------------------

const WHISTLE_FIRST: [string, string][] = [
  ['D5', '-123|123-'],
  ['E5', '-123|12--'],
  ['F#5', '-123|1---'],
  ['G5', '-123|----'],
  ['A5', '-12-|----'],
  ['B5', '-1--|----'],
  ['C#6', '----|----'],
];

export const WHISTLE_D_CHART: FingeringChart = {
  id: 'whistle-d',
  name: 'Tin whistle in D',
  transposition: 0,
  fingerings: [
    ...WHISTLE_FIRST.map(([n, s]) => f(n, s)),
    ...WHISTLE_FIRST.map(([n, s]) => f(`${n.slice(0, -1)}${Number(n.at(-1)) + 1}`, s, ['overblown'])),
  ],
};

/** Every chart, by id. */
export const FINGERING_CHARTS: Record<string, FingeringChart> = Object.fromEntries(
  [FLUTE_CHART, RECORDER_BAROQUE_CHART, RECORDER_GERMAN_CHART, CLARINET_CHART, ALTO_SAX_CHART, OBOE_CHART, WHISTLE_D_CHART].map((c) => [c.id, c]),
);

export const chartById = (id: string): FingeringChart | null => FINGERING_CHARTS[id] ?? null;
