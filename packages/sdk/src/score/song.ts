/**
 * A song as the listening games read it: one line of notes, each an onset and a length in beats
 * and, when the song is pitched, a MIDI pitch. That is all a game needs (the Pitch Maze and Pop the
 * Notes read the pitches, folded to an octave; Echo reads only the onsets; Sing Along both), so
 * every richer source reduces to it: a `ScoreDoc` (MIDI, MusicXML, ABC through their parsers) by
 * `songFromScore`, the compact note text by `songFromText`.
 *
 * - A rhythm is a song with no pitches; a pitch sequence is a song whose lengths are all 1.
 * - Beats are quarter notes, as in `ScoreDoc`; `bpm` and `beatsPerBar` are the song's own when it
 *   states them, and a game uses its defaults otherwise.
 *
 * Pure, no Zod (the schema that validates a song from outside is `./song_schema`).
 */
import type { ScoreDoc, ScorePart } from './schema';

export interface SongNote {
  /** Onset, beats from the song's start. */
  beat: number;
  /** Length, beats. */
  beats: number;
  /** MIDI pitch; absent in a rhythm. */
  midi?: number;
}

export interface Song {
  title?: string;
  /** Beats (quarter notes) per minute. */
  bpm?: number;
  /** Beats per bar (the time signature's, in quarters). */
  beatsPerBar?: number;
  notes: SongNote[];
}

/** True when every note has a pitch. */
export const isPitchedSong = (song: Pick<Song, 'notes'>): boolean => song.notes.length > 0 && song.notes.every((n) => n.midi !== undefined);

/** The id of the percussion part a song's unpitched hits are written to beside its melody. */
export const CLAPS_PART = 'claps';

export interface FromScoreOptions {
  /** The part to read, by id or index; default: the pitched part with the most notes. */
  part?: string | number;
}

/** The part a song is read from: the one asked for, else the busiest pitched part. */
export function melodyPart(doc: ScoreDoc, part?: string | number): ScorePart | undefined {
  if (typeof part === 'number') return doc.parts[part];
  if (typeof part === 'string') return doc.parts.find((p) => p.id === part || p.name === part);
  const pitched = doc.parts.filter((p) => !p.percussion && p.notes.length > 0);
  return [...(pitched.length ? pitched : doc.parts)].sort((a, b) => b.notes.length - a.notes.length)[0];
}

/**
 * A score's melody as a song: one part (`melodyPart`), reduced to one line by the skyline rule
 * (of notes starting together the highest is kept; a note is cut where the next one starts), its
 * first tempo and time signature. A percussion part gives a rhythm (no pitches).
 */
export function songFromScore(doc: ScoreDoc, opts: FromScoreOptions = {}): Song {
  const part = melodyPart(doc, opts.part);
  if (!part || part.notes.length === 0) throw new Error(`songFromScore: ${doc.title} has no notes${opts.part === undefined ? '' : ` in part ${opts.part}`}`);
  const EPS = 1e-6;
  const sorted = [...part.notes].sort((a, b) => a.start - b.start || b.midi - a.midi);
  const line: SongNote[] = [];
  for (const n of sorted) {
    const prev = line[line.length - 1];
    if (prev && Math.abs(prev.beat - n.start) < EPS) continue;
    if (prev && prev.beat + prev.beats > n.start) prev.beats = n.start - prev.beat;
    line.push({ beat: n.start, beats: n.duration, ...(part.percussion ? {} : { midi: n.midi }) });
  }
  // A song's unpitched hits written beside its melody (`scoreFromSong`'s `claps` part) come back as hits.
  const claps = !part.percussion ? doc.parts.find((p) => p.percussion && p.id === CLAPS_PART) : undefined;
  if (claps) {
    for (const n of claps.notes) if (!line.some((m) => Math.abs(m.beat - n.start) < EPS)) line.push({ beat: n.start, beats: n.duration });
    line.sort((a, b) => a.beat - b.beat);
  }
  const sig = doc.timeSignatures[0];
  const bpm = doc.tempoMap[0]?.bpm;
  return {
    title: doc.title,
    ...(bpm ? { bpm: Math.round(bpm * 100) / 100 } : {}),
    ...(sig ? { beatsPerBar: (sig.numerator * 4) / sig.denominator } : {}),
    notes: line.filter((n) => n.beats > EPS),
  };
}

/**
 * Notes from the compact text: space-separated tokens, each `<pitch>[:<beats>]`, `x[:<beats>]` for
 * an unpitched hit or `-[:<beats>]` for a rest; beats default to 1. Pitches are MIDI numbers or
 * names (`C4`, `F#3`, `Bb4`). Consecutive, so `C4 D4 E4:2` is three notes on beats 0, 1, 2.
 */
export function notesFrom(text: string): SongNote[] {
  const out: SongNote[] = [];
  let beat = 0;
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const [head, len] = token.split(':');
    const beats = len === undefined ? 1 : Number(len);
    if (!(beats > 0)) throw new Error(`notes: bad length in "${token}"`);
    if (head !== '-') out.push(head === 'x' ? { beat, beats } : { beat, beats, midi: midiFromName(head) });
    beat += beats;
  }
  return out;
}

/** A song from the compact text, optionally headed by `bpm=<n>` and `bar=<beats>` tokens. */
export function songFromText(text: string, title?: string): Song {
  let bpm: number | undefined;
  let beatsPerBar: number | undefined;
  // A comment is `#` starting a token (`F#3` is a pitch, `# up` a comment).
  const body = text
    .replace(/(^|\s)#.*$/gm, '$1')
    .split(/\s+/)
    .filter((t) => {
      const m = /^(bpm|bar)=(\d+(?:\.\d+)?)$/.exec(t);
      if (!m) return true;
      if (m[1] === 'bpm') bpm = Number(m[2]);
      else beatsPerBar = Number(m[2]);
      return false;
    })
    .join(' ');
  return { ...(title ? { title } : {}), ...(bpm ? { bpm } : {}), ...(beatsPerBar ? { beatsPerBar } : {}), notes: notesFrom(body) };
}

/**
 * A song as the compact text (rests written out, `bpm=` and `bar=` first when known):
 * `songFromText`'s inverse for a single line of notes. The text is one line, so notes that overlap
 * (a chord, from a JSON song) are written as one: of notes starting together the highest, and a
 * note cut where the next starts, the same skyline as `songFromScore`. Lengths keep 6 decimals.
 */
export function songToText(song: Song): string {
  const tokens: string[] = [];
  if (song.bpm) tokens.push(`bpm=${song.bpm}`);
  if (song.beatsPerBar) tokens.push(`bar=${song.beatsPerBar}`);
  const len = (b: number) => (Math.abs(b - 1) < 1e-9 ? '' : `:${+b.toFixed(6)}`);
  const line = skyline(song.notes);
  let at = 0;
  for (const [i, n] of line.entries()) {
    if (n.beat > at + 1e-9) tokens.push(`-${len(n.beat - at)}`);
    const next = line[i + 1];
    const beats = next ? Math.min(n.beats, next.beat - n.beat) : n.beats;
    tokens.push(`${n.midi === undefined ? 'x' : nameOf(n.midi)}${len(beats)}`);
    at = n.beat + beats;
  }
  return tokens.join(' ');
}

/** One line of notes: of notes starting together the highest (a hit counts lowest), in onset order. */
function skyline(notes: readonly SongNote[]): SongNote[] {
  const sorted = [...notes].sort((a, b) => a.beat - b.beat || (b.midi ?? -1) - (a.midi ?? -1));
  return sorted.filter((n, i) => i === 0 || Math.abs(sorted[i - 1].beat - n.beat) > 1e-9);
}

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `C4` = 60, `A4` = 69, `F#3`, `Bb4`; a bare number is a MIDI number. */
export function midiFromName(name: string): number {
  if (/^\d+(\.\d+)?$/.test(name)) return Number(name);
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`notes: "${name}" is not a pitch (C4, F#3, Bb4 or a MIDI number)`);
  const pc = PITCH_CLASS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + pc;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** The nearest note's name for a (fractional) MIDI pitch: 60 -> C4. */
export function nameOf(midi: number): string {
  const r = Math.round(midi);
  return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}
