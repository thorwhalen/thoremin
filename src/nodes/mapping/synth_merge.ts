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
 * Because it is the single convergence point downstream of EVERY sound producer,
 * it also carries the master `mute`: when the `mute` input is true every merged
 * voice is silenced (gain 0, present false), so muting covers the hands AND both
 * face-chord instruments AND any future producer that merges here — fixing the
 * bug (#91) where the chords bypassed the hand-voice mute. The synth ramps a
 * gain-0 voice down over its per-voice release, so the mute is click-free.
 *
 * Pure + deterministic. An absent/empty input contributes no voices, so the third
 * port `c` is fully back-compatible (graphs wiring only `a`/`b` are unchanged) and
 * an idle chord source simply passes the other streams through unchanged; an
 * absent `mute` is treated as false (passthrough), so pre-mute graphs are unchanged.
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
  description: 'Union up to three synth-params voice streams into one (hand voices + emotion chord + pose chord); master mute.',
  inputs: [
    { name: 'a', kind: 'synth-params' },
    { name: 'b', kind: 'synth-params' },
    // Optional third stream (e.g. the head-pose chord); absent → contributes nothing.
    { name: 'c', kind: 'synth-params' },
    // Master mute: true → silence every merged voice at this single convergence
    // point (all producers pass through here). Absent → false (passthrough).
    { name: 'mute', kind: 'boolean', default: false },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  process(inputs) {
    const a = asParams(inputs.a);
    const b = asParams(inputs.b);
    const c = asParams(inputs.c);
    const voices = [...a.voices, ...b.voices, ...c.voices];
    // Master mute: zero every voice (and mark it absent) so hands + both chord
    // instruments go quiet together. The synth's per-voice release ramp makes
    // this a smooth, click-free fade rather than an abrupt cut.
    if (inputs.mute === true) {
      return { params: { voices: voices.map((v) => ({ ...v, gain: 0, present: false })) } };
    }
    return { params: { voices } };
  },
});
