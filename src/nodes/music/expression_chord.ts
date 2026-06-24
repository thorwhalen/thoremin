/**
 * `expression-chord` node — turns a classified facial expression into the
 * diatonic triad on its confusion-aware scale degree (issue #64). It is the
 * "expression → chord" half of the face-mapping chooser: the player's expression
 * (from `face-expression`) selects a scale degree via
 * {@link DEFAULT_EXPRESSION_TO_DEGREE}, and the triad is built on the active
 * seven-note scale ({@link diatonicTriad}).
 *
 * It emits chord voices on ids ≥ {@link CHORD_VOICE_ID_BASE}, so they never
 * collide with the two hand voices (0, 1) and can be unioned into the synth
 * alongside the hand melody (see `synth-merge`). The node is the live gate for
 * the chord mode: it emits voices ONLY when `faceMapping === 'chord'`, the
 * expression is present, and the current scale has seven notes — otherwise it
 * emits nothing (silent), so timbre/none modes and pentatonic-style scales
 * degrade gracefully.
 *
 * Pure + deterministic — testable from canned expression frames via `replayNode`.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { diatonicTriad, midiToFreq, type ScaleSpec } from '@/music/theory';
import { InstrumentSchema } from '@/music/instruments';
import { DEFAULT_EXPRESSION_TO_DEGREE, type ExpressionScores } from '@/music/expression';
import type { VoiceParams } from '../domain';

/** Chord voices start at this id, above the two hand voices (0 = right, 1 = left). */
export const CHORD_VOICE_ID_BASE = 2;

/** A diatonic triad has three tones; we always emit exactly this many voices. */
const TRIAD_SIZE = 3;

const Params = z.object({
  /** Gain of each chord voice (0..1) — gentle by default so the triad supports,
   *  rather than overpowers, the hand melody. */
  gain: z.number().min(0).max(1).default(0.22),
  /** Instrument timbre for the chord voices. */
  instrument: InstrumentSchema.default('triangle'),
});
type Params = z.infer<typeof Params>;

export const expressionChordNode = defineNode<Params>({
  type: 'expression-chord',
  roles: ['music'],
  title: 'Expression Chord',
  description:
    'Facial expression → the diatonic triad on its confusion-aware scale degree (active only in face "chord" mode on seven-note scales).',
  inputs: [
    { name: 'expression', kind: 'face-expression' },
    { name: 'spec', kind: 'scale-spec' },
    { name: 'faceMapping', kind: 'face-mapping', default: 'none' },
    // Live keyboard octave shift, so the chord tracks the same register as the
    // hand melody (which also applies it). Unconnected → 0 (no shift).
    { name: 'octaveShift', kind: 'number', default: 0 },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    // The chosen triad as *un-shifted* scale MIDI notes, so the overlay highlight
    // matches the raw scale-guide lines (whose labels already include the shift —
    // so the highlighted line, its label, and the sounding pitch all agree).
    { name: 'triad', kind: 'number[]' },
  ],
  params: Params,
  process(inputs, p) {
    const expr = inputs.expression as ExpressionScores | undefined;
    const spec = inputs.spec as ScaleSpec | undefined;
    const active = inputs.faceMapping === 'chord' && !!expr && expr.present && !!spec;
    const shift = typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0;
    // diatonicTriad returns 3 notes for seven-note scales, [] otherwise. These are
    // the un-shifted scale tones (the `triad` output the overlay highlights).
    const triad = active ? diatonicTriad(spec!, DEFAULT_EXPRESSION_TO_DEGREE[expr!.label]) : [];
    // ALWAYS emit TRIAD_SIZE voices on stable ids: a present/sounding voice when
    // active, an absent (gain 0) voice when idle. The synth releases voices it
    // still sees in the array — so a vanishing voice would leave a chord stuck
    // sounding. Keeping the ids stable lets it fade the triad out cleanly. The
    // sounding pitch applies the octave shift so it stays in the melody's register.
    const voices: VoiceParams[] = [];
    for (let i = 0; i < TRIAD_SIZE; i++) {
      const midi = triad[i];
      const present = midi !== undefined;
      voices.push({
        id: CHORD_VOICE_ID_BASE + i,
        present,
        freq: midiToFreq((present ? midi : 60) + 12 * shift),
        gain: present ? p.gain : 0,
        instrument: p.instrument,
      });
    }
    return { params: { voices }, triad };
  },
});
