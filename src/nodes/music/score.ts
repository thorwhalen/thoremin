/**
 * `score` node — an immutable piece (notes with musical timing). Given the
 * current `beat` (from `transport`) and a `velocityScale` (from `performance`),
 * it emits the notes sounding right now as {@link SynthParams} voices — so a
 * fixed piece is *performed* live, its tempo and dynamics directed by gesture
 * (conductor mode). Pure + deterministic.
 *
 * Each score note maps to a stable voice id ({@link SCORE_VOICE_ID_BASE} + its index),
 * so the synth manages each note's voice across ticks; notes not currently sounding
 * are emitted as silent (present:false) voices so they are released. The base keeps
 * the ids clear of the hand voices (0, 1), the emotion chord (2..5) and the pose chord
 * (6..10) it is merged with in the default graph — the synth keys voices by id, and a
 * collision would let a score note steal a hand's voice.
 *
 * `enabled` (#187): the score is wired into the default graph behind the conductor,
 * whose `beat` is frozen while conducting is off — and a frozen beat would otherwise
 * hold whatever note sits at that position forever. With `enabled` false every voice
 * is emitted silent, so the merge passes the hand voices through untouched.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { midiToFreq } from '@/music/theory';
import { SoundSchema } from '@/music/sounds';
import { MAX_POSE_VOICES, POSE_VOICE_ID_BASE } from './pose_chord';
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
  sound: SoundSchema.default('triangle'),
});
type Params = z.infer<typeof Params>;

/** The built-in demo piece until the score pipeline lands (#187 PR 3): one octave of a
 *  C major scale, one note per beat over an eight-beat loop — the same piece
 *  `scripts/gen_conductor_demo.ts` renders, so a conductor hears the scale speed up and
 *  slow down with the hand. */
/** First voice id of the score's voices: right after the pose chord's block, derived so
 *  a change to either chord's voice count cannot silently reintroduce a collision. */
export const SCORE_VOICE_ID_BASE = POSE_VOICE_ID_BASE + MAX_POSE_VOICES;

export const DEMO_SCALE_NOTES = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({ midi, start: i, duration: 0.9, velocity: 1 }));

export const scoreNode = defineNode<Params>({
  type: 'score',
  roles: ['music'],
  title: 'Score',
  description: 'An immutable piece performed live: beat + velocityScale → sounding synth voices.',
  inputs: [
    { name: 'beat', kind: 'number', default: 0 },
    { name: 'velocityScale', kind: 'number', default: 1 },
    { name: 'enabled', kind: 'boolean', default: true },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  params: Params,
  process(inputs, p) {
    const enabled = inputs.enabled !== false;
    const rawBeat = typeof inputs.beat === 'number' ? inputs.beat : 0;
    const vScale = typeof inputs.velocityScale === 'number' ? inputs.velocityScale : 1;
    const pos = p.loopBeats > 0 ? ((rawBeat % p.loopBeats) + p.loopBeats) % p.loopBeats : rawBeat;

    const voices: VoiceParams[] = p.notes.map((n, id) => {
      const sounding = enabled && pos >= n.start && pos < n.start + n.duration;
      return {
        id: SCORE_VOICE_ID_BASE + id,
        present: sounding,
        freq: midiToFreq(n.midi),
        gain: sounding ? Math.max(0, Math.min(1, n.velocity * vScale)) * p.baseGain : 0,
        sound: p.sound,
      };
    });
    const out: SynthParams = { voices };
    return { params: out };
  },
});
