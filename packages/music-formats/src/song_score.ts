/**
 * A song as a one-part score, the way back from the games' model to the conductor's: so a song can
 * be written by any writer of scores (`scoreToMidi`), and a score read from any file reduces to a
 * song (`songFromScore`, in the SDK). A rhythm becomes a percussion part of hand claps.
 *
 * Pure: no parser.
 */
import { notesLength, ScoreDocSchema, type ScoreDoc } from '@thoremin/sdk/score/schema';
import type { Song } from '@thoremin/sdk/score/song';

/** A rhythm's pitch in a score: General MIDI percussion's hand clap. */
export const CLAP = 39;

export function scoreFromSong(song: Song): ScoreDoc {
  const rhythm = song.notes.every((n) => n.midi === undefined);
  const parts = [
    {
      id: rhythm ? 'claps' : 'melody',
      name: rhythm ? 'Claps' : 'Melody',
      percussion: rhythm,
      notes: song.notes.map((n) => ({ midi: Math.round(n.midi ?? CLAP), start: n.beat, duration: n.beats, velocity: 0.8 })),
    },
  ];
  return ScoreDocSchema.parse({
    v: 1,
    title: song.title ?? 'Untitled',
    source: 'builtin',
    parts,
    tempoMap: song.bpm ? [{ beat: 0, bpm: song.bpm }] : [],
    timeSignatures: song.beatsPerBar ? [{ beat: 0, numerator: Math.round(song.beatsPerBar), denominator: 4 }] : [],
    dynamics: [],
    fermatas: [],
    lengthBeats: notesLength(parts),
  });
}
