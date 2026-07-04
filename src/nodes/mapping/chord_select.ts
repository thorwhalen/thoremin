/**
 * `chord-select` node — picks the first non-empty of two chord-tone streams into
 * one, so a single overlay `chord` input can show whichever chord instrument is
 * currently sounding. The engine forbids fan-IN to one input port, so the
 * emotion `expression-chord` (`triad`) and the head-pose `pose-chord` (`chord`)
 * cannot both wire into `overlay.chord`; this node is the join.
 *
 * The two sources are mutually exclusive by face mode (emotion `chord` vs pose
 * `controls`), and each emits `[]` while idle, so "first non-empty" cleanly
 * yields the active chord's un-voiced tones (and `[]` when neither sounds).
 * Pure + deterministic.
 */
import { defineNode } from '@/dag';

const asTones = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : []);

export const chordSelectNode = defineNode({
  type: 'chord-select',
  roles: ['mapping'],
  title: 'Chord Select',
  description: 'Pick the first non-empty of two chord-tone streams (e.g. emotion triad vs pose chord) for the overlay.',
  inputs: [
    { name: 'a', kind: 'number[]' },
    { name: 'b', kind: 'number[]' },
  ],
  outputs: [{ name: 'chord', kind: 'number[]' }],
  process(inputs) {
    const a = asTones(inputs.a);
    return { chord: a.length ? a : asTones(inputs.b) };
  },
});
