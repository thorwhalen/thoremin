/**
 * A song as a one-part score, the way back from the games' model to the conductor's: so a song can
 * be written by any writer of scores (`scoreToMidi`), and a score read from any file reduces to a
 * song (`songFromScore`, in the SDK). A rhythm becomes a percussion part of hand claps.
 *
 * Pure: no parser.
 */
import { notesLength, ScoreDocSchema, type ScoreDoc } from '@thoremin/sdk/score/schema';
import { CLAPS_PART, type Song } from '@thoremin/sdk/score/song';

/** A rhythm's pitch in a score: General MIDI percussion's hand clap. */
export const CLAP = 39;

/** A bar of `beats` quarters as a time signature: 3 is 3/4, 2.5 is 5/8, 3.75 is 15/16. */
export function signatureOf(beats: number): { beat: number; numerator: number; denominator: number } {
  for (const denominator of [4, 8, 16]) {
    const numerator = (beats * denominator) / 4;
    if (Math.abs(numerator - Math.round(numerator)) < 1e-9) return { beat: 0, numerator: Math.round(numerator), denominator };
  }
  return { beat: 0, numerator: Math.max(1, Math.round(beats)), denominator: 4 };
}

export function scoreFromSong(song: Song): ScoreDoc {
  // Pitched notes are the melody; unpitched hits a percussion part of claps (which
  // `songFromScore` folds back into the line), so a hit never becomes a pitched note.
  const note = (n: Song['notes'][number]) => ({ midi: Math.round(n.midi ?? CLAP), start: n.beat, duration: n.beats, velocity: 0.8 });
  const pitched = song.notes.filter((n) => n.midi !== undefined);
  const hits = song.notes.filter((n) => n.midi === undefined);
  const parts = [
    ...(pitched.length ? [{ id: 'melody', name: 'Melody', percussion: false, notes: pitched.map(note) }] : []),
    ...(hits.length ? [{ id: CLAPS_PART, name: 'Claps', percussion: true, notes: hits.map(note) }] : []),
  ];
  return ScoreDocSchema.parse({
    v: 1,
    title: song.title ?? 'Untitled',
    source: 'builtin',
    parts,
    tempoMap: song.bpm ? [{ beat: 0, bpm: song.bpm }] : [],
    timeSignatures: song.beatsPerBar ? [signatureOf(song.beatsPerBar)] : [],
    dynamics: [],
    fermatas: [],
    lengthBeats: notesLength(parts),
  });
}
