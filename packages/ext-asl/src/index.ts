/**
 * The ASL extension: American Sign Language read from the hands, and two instruments built on
 * it. The recogniser itself is the pure package `@thoremin/asl` (reusable without thoremin);
 * this manifest wraps it in a node, gives it a dial, a branch and a chord node.
 *
 * - **ASL Viewer**: video only. The sign being made, large, and a bar per sign (the
 *   fingerspelled alphabet, then the words), the face-expression bar idiom.
 * - **ASL Chords**: the face-expression chords instrument with letters for faces: A..G play
 *   the chord of the key whose root has that letter name, the key's accidentals applied (in
 *   D major, F plays F#m). Key, sound and voicing are the face chords' settings.
 *
 * Pure: no React (the editor section and the readout are `./ui.tsx`).
 *
 * LAZY (`docs/design/lazy-extensions.md`): this file is the EAGER STUB, so it imports no node
 * and no recogniser. It carries what the app needs before anyone signs (the dial, the
 * branches as data, the two instruments, the derivation) and names its node types in
 * `provides`; their code is `./lazy.ts`, which the host's build loads with a dynamic
 * `import()` the first time a graph names one (`extensions.json`'s `lazy` entry).
 */
import { defineExtension } from '@thoremin/sdk/instruments/extension';
import { ASL_BRANCHES } from './branches';
import { ASL_DIAL_SLICES } from './dials';

/** The theremin voices silent and its guides hidden: the hands only sign. */
const SILENT_THEREMIN = {
  handMap: { maxGain: 0 },
  overlay: { scaleGuide: { show: false }, markers: { showNotes: false } },
} as const;

const dial = (x: unknown): { enabled?: boolean; chords?: boolean } => (x && typeof x === 'object' ? (x as { enabled?: boolean; chords?: boolean }) : {});

export const ASL_EXTENSION = defineExtension({
  id: 'asl',
  // The node types `./lazy.ts` defines (the registry checks the two lists agree on load).
  provides: ['asl-signs', 'sign-chord'],
  branches: ASL_BRANCHES,
  dials: ASL_DIAL_SLICES,
  instruments: [
    // Read signs, play nothing: the sign written large and a bar per sign.
    { name: 'ASL Viewer', patch: { ...SILENT_THEREMIN, asl: { enabled: true, chords: false } } },
    // A..G play chords of D major (so F is F#m and C is C#dim: the key's own spelling).
    {
      name: 'ASL Chords',
      patch: {
        ...SILENT_THEREMIN,
        asl: { enabled: true, chords: true },
        faceChord: { chordSource: 'custom', chordRoot: 2, chordType: 'major', sound: 'warmPad', voicing: 'spread', rendering: 'sustained', volume: 0.35 },
      },
    },
  ],
  derive: (s) => {
    const a = dial((s as Record<string, unknown>).asl);
    if (!a.enabled) return [];
    return a.chords ? ['asl-signs', 'asl-chord'] : ['asl-signs'];
  },
});

export default ASL_EXTENSION;
