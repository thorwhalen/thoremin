/**
 * `score` node — an immutable piece (notes with musical timing). Given the
 * current `beat` (from `transport`) and a `velocityScale` (from `performance`),
 * it emits the notes sounding right now as {@link SynthParams} voices — so a
 * fixed piece is *performed* live, its tempo and dynamics directed by gesture
 * (conductor mode). Pure + deterministic.
 *
 * Each score note maps to a stable voice id (its index), so the synth manages
 * each note's voice across ticks; notes not currently sounding are emitted as
 * silent (present:false) voices so they are released.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { midiToFreq } from '@/music/theory';
import { InstrumentSchema } from '@/music/instruments';
import type { SynthParams, VoiceParams } from '../domain';

const Note = z.object({
  midi: z.number(),
  /** Start time in beats (from the loop start). */
  start: z.number(),
  /** Duration in beats. */
  duration: z.number(),
  /** 0..1. */
  velocity: z.number().min(0).max(1).default(1),
});

const Params = z.object({
  notes: z.array(Note).default([]),
  /** Loop length in beats; the beat position wraps modulo this. 0 = no loop. */
  loopBeats: z.number().min(0).default(8),
  /** Base output gain multiplier. */
  baseGain: z.number().min(0).max(1).default(0.4),
  instrument: InstrumentSchema.default('triangle'),
});
type Params = z.infer<typeof Params>;

export const scoreNode = defineNode<Params>({
  type: 'score',
  title: 'Score',
  description: 'An immutable piece performed live: beat + velocityScale → sounding synth voices.',
  inputs: [
    { name: 'beat', kind: 'number', default: 0 },
    { name: 'velocityScale', kind: 'number', default: 1 },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  params: Params,
  process(inputs, p) {
    const rawBeat = typeof inputs.beat === 'number' ? inputs.beat : 0;
    const vScale = typeof inputs.velocityScale === 'number' ? inputs.velocityScale : 1;
    const pos = p.loopBeats > 0 ? ((rawBeat % p.loopBeats) + p.loopBeats) % p.loopBeats : rawBeat;

    const voices: VoiceParams[] = p.notes.map((n, id) => {
      const sounding = pos >= n.start && pos < n.start + n.duration;
      return {
        id,
        present: sounding,
        freq: midiToFreq(n.midi),
        gain: sounding ? Math.max(0, Math.min(1, n.velocity * vScale)) * p.baseGain : 0,
        instrument: p.instrument,
      };
    });
    const out: SynthParams = { voices };
    return { params: out };
  },
});
