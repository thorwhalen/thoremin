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
 * Key-signature meta events become the document's keys (`major` or `minor`: what the event can say),
 * and a score's keys are written back as such events (`withKeySignatures`).
 */
import { Midi } from '@tonejs/midi';
import { parseMidi, writeMidi, type MidiEvent } from 'midi-file';
import { notesLength, partId, ScoreDocSchema, type KeySignature, type ScoreDoc, type ScorePart } from '@thoremin/sdk/score/schema';
import type { Song } from '@thoremin/sdk/score/song';
import { scoreFromSong } from './song_score';

/** The keys a MIDI key-signature event names, from seven flats to seven sharps (`@tonejs/midi`'s
 *  spelling of the event's signed count, which it does not export). */
const KEY_NAMES: readonly string[] = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

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
  const keys: KeySignature[] = [];
  for (const k of [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks)) {
    const fifths = KEY_NAMES.indexOf(k.key) - 7;
    if (fifths < -7 || fifths > 7) continue;
    const key: KeySignature = { beat: toBeats(k.ticks), fifths, mode: k.scale === 'minor' ? 'minor' : 'major' };
    const last = keys[keys.length - 1];
    if (last && last.fifths === key.fifths && last.mode === key.mode) continue;
    if (last && Math.abs(last.beat - key.beat) < 1e-9) keys.pop();
    keys.push(key);
  }
  return ScoreDocSchema.parse({
    v: 1,
    title: title?.trim() || midi.name?.trim() || 'Untitled',
    source: 'midi',
    parts,
    tempoMap,
    timeSignatures,
    dynamics: [],
    fermatas: [],
    keys,
    lengthBeats: notesLength(parts),
  });
}

/**
 * A file with these key signatures on its first track. `@tonejs/midi` reads key-signature events
 * but writes their key byte wrongly, so they are added below it, with `midi-file`. A MIDI event says
 * only major or minor: the other modes are written as the major key of their signature.
 */
function withKeySignatures(bytes: Uint8Array, keys: readonly KeySignature[], ppq: number): Uint8Array {
  if (!keys.length) return bytes;
  const data = parseMidi(bytes);
  const track = data.tracks[0];
  if (!track) return bytes;
  // Absolute ticks, the new events merged in before anything else at their tick, back to deltas.
  let at = 0;
  const timed: { tick: number; event: MidiEvent; order: number }[] = track.map((event, i) => ({ tick: (at += event.deltaTime), event, order: i + keys.length }));
  keys.forEach((k, i) => {
    const event = { deltaTime: 0, meta: true, type: 'keySignature', key: k.fifths, scale: k.mode === 'minor' || k.mode === 'aeolian' ? 1 : 0 } as MidiEvent;
    timed.push({ tick: Math.round(k.beat * ppq), event, order: i });
  });
  // The end of the track stays last, at or after every event.
  const end = timed.filter((e) => e.event.type === 'endOfTrack');
  const rest = timed.filter((e) => e.event.type !== 'endOfTrack').sort((a, b) => a.tick - b.tick || a.order - b.order);
  const last = rest.length ? rest[rest.length - 1].tick : 0;
  const ordered = [...rest, ...end.map((e) => ({ ...e, tick: Math.max(e.tick, last) }))];
  let prev = 0;
  data.tracks[0] = ordered.map(({ tick, event }) => {
    const out = { ...event, deltaTime: tick - prev };
    prev = tick;
    return out;
  });
  return new Uint8Array(writeMidi(data));
}

/**
 * A score as a Standard MIDI File (480 ticks per quarter): its first tempo and time signature, a
 * track per part, a percussion part on channel 10.
 */
export function scoreToMidi(doc: ScoreDoc): Uint8Array {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  // Only a tempo the score has: one written here would come back as the song's own.
  if (doc.tempoMap[0]) midi.header.setTempo(doc.tempoMap[0].bpm);
  const sig = doc.timeSignatures[0];
  if (sig) midi.header.timeSignatures.push({ ticks: 0, timeSignature: [sig.numerator, sig.denominator] });
  midi.header.name = doc.title;
  midi.header.update();
  for (const part of doc.parts) {
    const track = midi.addTrack();
    track.name = part.name;
    if (part.percussion) track.channel = PERCUSSION_CHANNEL;
    for (const n of part.notes) track.addNote({ midi: n.midi, ticks: Math.round(n.start * ppq), durationTicks: Math.max(1, Math.round(n.duration * ppq)), velocity: n.velocity });
  }
  return withKeySignatures(midi.toArray(), doc.keys, ppq);
}

/** A song as a one-track MIDI file (a rhythm as hand claps on the percussion channel: `scoreFromSong`). */
export const songToMidi = (song: Song): Uint8Array => scoreToMidi(scoreFromSong(song));
