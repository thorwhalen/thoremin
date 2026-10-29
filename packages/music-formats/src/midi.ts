/**
 * Standard MIDI file → {@link ScoreDoc}, on `@tonejs/midi` (research map §4.1: the one
 * parser that hands over tempo map, time signatures, `ppq` and per-track notes in one
 * object; 9 kB, MIT, pure JS).
 *
 * This module is the ONLY importer of `@tonejs/midi` and is itself reached only by a
 * dynamic `import()` (the conductor's `load.ts`, the music formats' pack), so the parser
 * never sits in the main chunk (the lazy-loading rule, #188). It also writes a song back
 * out as a one-track MIDI file (`songToMidi`). Beats are `ticks / ppq`: quarter notes, the document's unit.
 * A percussion track (channel 10, or the instrument flag) is kept as a part but marked,
 * so the orchestra can route it to the drum section rather than to a pitched one.
 */
import { Midi } from '@tonejs/midi';
import { notesLength, partId, ScoreDocSchema, type ScoreDoc, type ScorePart } from '@thoremin/sdk/score/schema';
import type { Song } from '@thoremin/sdk/score/song';

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

/** A rhythm's pitch when written to MIDI: GM percussion's hand clap, on channel 10. */
const CLAP = 39;
const DEFAULT_BPM = 100;

/**
 * A song as a one-track Standard MIDI File: its tempo and time signature, each note at its beat
 * (480 ticks per quarter). A rhythm (no pitches) is written as hand claps on the percussion channel.
 */
export function songToMidi(song: Song): Uint8Array {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  midi.header.setTempo(song.bpm ?? DEFAULT_BPM);
  if (song.beatsPerBar) midi.header.timeSignatures.push({ ticks: 0, timeSignature: [Math.round(song.beatsPerBar), 4] });
  if (song.title) midi.header.name = song.title;
  midi.header.update();
  const rhythm = song.notes.every((n) => n.midi === undefined);
  const track = midi.addTrack();
  if (rhythm) track.channel = PERCUSSION_CHANNEL;
  for (const n of song.notes) track.addNote({ midi: n.midi ?? CLAP, ticks: Math.round(n.beat * ppq), durationTicks: Math.max(1, Math.round(n.beats * ppq)), velocity: 0.8 });
  return midi.toArray();
}
