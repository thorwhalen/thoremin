/**
 * A chord heard from outside the map (a MIDI keyboard, the microphone, a signed letter) as the
 * chord map plays it: its tones on the map's register, a name the guitar voicing can strum, and
 * whether its notes are a scale-chord's pitch classes. Moved out of the `chord-map` node unchanged.
 *
 * Pure.
 */
import { chordSymbol, pitchClasses, type Chord, type Key } from '@thoremin/sdk/harmony/chord';
import { parseChordName } from '@thoremin/sdk/music/guitar';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';

/** A chord's tones on the map's register, root first (a heard chord outside the key). */
export function heardChordTones(chord: Chord, spec: ScaleSpec): number[] {
  const base = (spec.baseOctave + 1) * 12 + chord.root;
  return pitchClasses(chord).map((p) => base + ((p - chord.root + 12) % 12));
}

/** The triad under each four-note quality: what is strummed when the guitar has no shape for the chord. */
const TRIAD_OF: Partial<Record<Chord['quality'], Chord['quality']>> = { maj7: 'maj', '7': 'maj', min7: 'min', hdim7: 'dim', dim7: 'dim', minmaj7: 'min', augmaj7: 'aug' };

/** A chord's name the guitar voicing can strum: its own, else its triad's (C#dim7 strums C#dim). */
export function strummable(chord: Chord, key: Key): string {
  const own = chordSymbol(chord, key);
  if (parseChordName(own)) return own;
  const triad = TRIAD_OF[chord.quality];
  return triad ? chordSymbol({ root: chord.root, quality: triad }, key) : own;
}

/** Whether a chord's notes are the same pitch classes as a set (a heard chord against a scale's own). */
export function samePitchClasses(notes: readonly number[], pcs: readonly number[]): boolean {
  const a = new Set(notes.map((n) => ((n % 12) + 12) % 12));
  const b = new Set(pcs);
  return a.size === b.size && [...a].every((p) => b.has(p));
}
