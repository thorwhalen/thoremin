/**
 * Standard MIDI file → {@link ScoreDoc}, on `@tonejs/midi` (research map §4.1: the one
 * parser that hands over tempo map, time signatures, `ppq` and per-track notes in one
 * object; 9 kB, MIT, pure JS).
 *
 * This module is the ONLY importer of `@tonejs/midi` and is itself reached only by a
 * dynamic `import()` from `./load.ts`, so the parser never sits in the main chunk (the
 * lazy-loading rule, #188). Beats are `ticks / ppq`: quarter notes, the document's unit.
 * A percussion track (channel 10, or the instrument flag) is kept as a part but marked,
 * so the orchestra can route it to the drum section rather than to a pitched one.
 */
import { Midi } from '@tonejs/midi';
import { notesLength, partId, ScoreDocSchema, type ScoreDoc, type ScorePart } from './schema';

/** GM channel 10 (0-based 9) is percussion by convention. */
const PERCUSSION_CHANNEL = 9;

export function midiToScoreDoc(bytes: Uint8Array | ArrayBuffer, title?: string): ScoreDoc {
  const midi = new Midi(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const ppq = midi.header.ppq;
  if (!(ppq > 0)) throw new Error('MIDI file has no valid ticks-per-quarter (ppq)');
  const toBeats = (ticks: number) => ticks / ppq;
  const taken = new Set<string>();
  const parts: ScorePart[] = [];
  midi.tracks.forEach((track, index) => {
    if (!track.notes.length) return; // a tempo/meta track carries no notes
    const name = track.name?.trim() || track.instrument?.name || `Track ${index + 1}`;
    parts.push({
      id: partId(name, index, taken),
      name,
      program: track.instrument?.number,
      percussion: track.channel === PERCUSSION_CHANNEL || track.instrument?.percussion === true,
      notes: track.notes.map((n) => ({
        midi: n.midi,
        start: toBeats(n.ticks),
        duration: toBeats(n.durationTicks),
        velocity: Math.max(0, Math.min(1, n.velocity)),
      })),
    });
  });
  const tempoMap = midi.header.tempos.map((t) => ({ beat: toBeats(t.ticks), bpm: t.bpm })).filter((t) => t.bpm > 0);
  const timeSignatures = midi.header.timeSignatures
    .map((ts) => ({ beat: toBeats(ts.ticks), numerator: ts.timeSignature[0] ?? 4, denominator: ts.timeSignature[1] ?? 4 }))
    .filter((ts) => ts.numerator > 0 && ts.denominator > 0);
  return ScoreDocSchema.parse({
    v: 1,
    title: title?.trim() || midi.name?.trim() || 'Untitled',
    source: 'midi',
    parts,
    tempoMap,
    timeSignatures,
    dynamics: [],
    fermatas: [],
    lengthBeats: notesLength(parts),
  });
}
