/**
 * `synth-merge` node — unions two {@link SynthParams} voice streams into one.
 *
 * The engine forbids fan-IN to a single input port, so two producers of synth
 * params (e.g. the hand `voice-mapping` and the face `expression-chord`) cannot
 * both wire into the synth's one `params` input. This node is the merge point:
 * it takes them on distinct ports and concatenates their voices, so the player's
 * hand melody and face-driven chord sound together. Voices keep their own ids
 * (hands use 0/1, chords use ids ≥ 2), so the synth voices them independently.
 *
 * Pure + deterministic. An absent/empty input contributes no voices, so when the
 * face chord is idle the merge passes the hand voices through unchanged.
 */
import { defineNode } from '@/dag';
import type { SynthParams } from '../domain';

const EMPTY: SynthParams = { voices: [] };

const asParams = (v: unknown): SynthParams =>
  v && typeof v === 'object' && Array.isArray((v as SynthParams).voices)
    ? (v as SynthParams)
    : EMPTY;

export const synthMergeNode = defineNode({
  type: 'synth-merge',
  roles: ['mapping'],
  title: 'Synth Merge',
  description: 'Union two synth-params voice streams into one (e.g. hand voices + face-chord voices).',
  inputs: [
    { name: 'a', kind: 'synth-params' },
    { name: 'b', kind: 'synth-params' },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  process(inputs) {
    const a = asParams(inputs.a);
    const b = asParams(inputs.b);
    return { params: { voices: [...a.voices, ...b.voices] } };
  },
});
