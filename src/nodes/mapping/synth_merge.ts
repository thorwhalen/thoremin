/**
 * `synth-merge` node — unions up to three {@link SynthParams} voice streams into one.
 *
 * The engine forbids fan-IN to a single input port, so several producers of synth
 * params (the hand `voice-mapping`, the emotion `expression-chord`, and the head-
 * pose `pose-chord`) cannot each wire into the synth's one `params` input. This
 * node is the merge point: it takes them on distinct ports and concatenates their
 * voices, so hand melody + face-driven chords sound together. Voices keep their
 * own ids (hands 0/1, emotion chord 2..5, pose chord ≥ 6), so the synth voices
 * them independently.
 *
 * Pure + deterministic. An absent/empty input contributes no voices, so the third
 * port `c` is fully back-compatible (graphs wiring only `a`/`b` are unchanged) and
 * an idle chord source simply passes the other streams through unchanged.
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
  description: 'Union up to three synth-params voice streams into one (hand voices + emotion chord + pose chord).',
  inputs: [
    { name: 'a', kind: 'synth-params' },
    { name: 'b', kind: 'synth-params' },
    // Optional third stream (e.g. the head-pose chord); absent → contributes nothing.
    { name: 'c', kind: 'synth-params' },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  process(inputs) {
    const a = asParams(inputs.a);
    const b = asParams(inputs.b);
    const c = asParams(inputs.c);
    return { params: { voices: [...a.voices, ...b.voices, ...c.voices] } };
  },
});
