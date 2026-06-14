/**
 * `chord` node — music-logic layer (tonal guidance for harmony). Turns a chord
 * symbol (e.g. "Cmaj7", "Am7") into voiced {@link SynthParams} — one voice per
 * chord tone, stacked ascending from a base octave — so it drives the existing
 * `webaudio-synth` directly (each chord tone is a synth voice; chord changes
 * glide via the synth's per-voice smoothing = simple voice-leading).
 *
 * Pure + deterministic (uses Tonal.js, no DOM/audio), so it's unit-testable.
 * Lets you *express harmony* directly; pair with `progression` to drive chord
 * selection from a gesture.
 */
import { z } from 'zod';
import { Chord, Note } from 'tonal';
import { defineNode } from '@/dag';
import { midiToFreq } from '@/music/theory';
import type { SynthParams, VoiceParams } from '../domain';

const Params = z.object({
  /** Octave of the lowest chord tone. */
  baseOctave: z.number().int().min(0).max(7).default(4),
  /** Cap the number of voices (chord tones) emitted. */
  maxVoices: z.number().int().min(1).max(8).default(4),
  instrument: z.enum(['sine', 'square', 'sawtooth', 'triangle']).default('sine'),
});
type Params = z.infer<typeof Params>;

/** Stack chord pitch-classes ascending from `baseOctave` into MIDI notes. */
export function voiceChord(symbol: string, baseOctave: number, maxVoices: number): number[] {
  const chord = Chord.get(symbol);
  if (chord.empty || chord.notes.length === 0) return [];
  const out: number[] = [];
  let octave = baseOctave;
  let prev = -Infinity;
  for (const pc of chord.notes.slice(0, maxVoices)) {
    let midi = Note.midi(`${pc}${octave}`);
    if (midi !== null && midi <= prev) {
      octave += 1;
      midi = Note.midi(`${pc}${octave}`);
    }
    if (midi === null) continue; // unparseable note name — skip
    prev = midi;
    out.push(midi);
  }
  return out;
}

export const chordNode = defineNode<Params>({
  type: 'chord',
  title: 'Chord',
  description: 'Chord symbol (e.g. Cmaj7) → voiced synth params (one voice per chord tone).',
  inputs: [
    { name: 'chord', kind: 'chord-symbol', default: 'C' },
    { name: 'gain', kind: 'number', default: 0.3 },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  params: Params,
  process(inputs, p) {
    const symbol = typeof inputs.chord === 'string' && inputs.chord ? inputs.chord : 'C';
    const gain = typeof inputs.gain === 'number' ? inputs.gain : 0.3;
    const midis = voiceChord(symbol, p.baseOctave, p.maxVoices);
    const voices: VoiceParams[] = midis.map((midi, id) => ({
      id,
      present: true,
      freq: midiToFreq(midi),
      gain,
      instrument: p.instrument,
    }));
    const out: SynthParams = { voices };
    return { params: out };
  },
});
