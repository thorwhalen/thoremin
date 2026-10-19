/**
 * `chord-select` node — picks the first non-empty of a POOL of chord-tone streams
 * into one, so a single overlay `chord` input can show whichever chord instrument is
 * currently sounding. The pool is allocated by the composer from the branches' declared
 * chord producers (`GraphBranch.chords`, #600 S4), as voices are allocated into the merge. The engine forbids fan-IN to one input port, so the
 * emotion `expression-chord` (`triad`) and the head-pose `pose-chord` (`chord`)
 * cannot both wire into `overlay.chord`; this node is the join.
 *
 * The two sources are mutually exclusive by face mode (emotion `chord` vs pose
 * `controls`), and each emits `[]` while idle, so "first non-empty" cleanly
 * yields the active chord's un-voiced tones (and `[]` when neither sounds).
 * Pure + deterministic.
 */
import { defineNode } from '@thoremin/dag';
import { chordPool, DEFAULT_CHORD_POOL_SIZE } from './chord_select.schema';

const asTones = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : []);

export { chordPool, DEFAULT_CHORD_POOL_SIZE } from './chord_select.schema';

/**
 * A chord selector with a pool of `size` inputs (#600 S4): the composer allocates each branch's
 * declared chord producer (`GraphBranch.chords`) to a free input by priority, highest first, and
 * the node passes on the first non-empty input in pool order. The app registry sizes it from the
 * contributions (`src/nodes/browser.ts`).
 */
export function makeChordSelectNode(size: number = DEFAULT_CHORD_POOL_SIZE) {
  const pool = chordPool(size);
  return defineNode({
    type: 'chord-select',
    roles: ['mapping'],
    title: 'Chord Select',
    description: 'Pick the first non-empty of a pool of chord-tone streams (the face chord, the pose chord, the sign chord, and any an extension declares), highest priority first, for the overlay.',
    inputs: pool.map((name) => ({ name, kind: 'number[]' })),
    outputs: [{ name: 'chord', kind: 'number[]' }],
    process(inputs) {
      for (const name of pool) {
        const tones = asTones(inputs[name]);
        if (tones.length) return { chord: tones };
      }
      return { chord: [] };
    },
  });
}

/** The default-sized selector (the core node library's). */
export const chordSelectNode = makeChordSelectNode();
