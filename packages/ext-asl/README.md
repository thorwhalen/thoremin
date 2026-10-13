# @thoremin/ext-asl

thoremin's ASL extension: American Sign Language read from the hands, and two instruments built on it.

- **ASL Viewer** (video only): the sign being made, written large, and a bar per sign (the fingerspelled alphabet, then the words), in the face-expression bar idiom.
- **ASL Chords**: the face-expression chords instrument with letters for faces. A..G play the chord of the key whose root has that letter name, with the key's accidentals applied: in D major, F plays F#m (iii) and C plays C#dim (vii°). The key, sound and voicing are the face chords' settings (`faceChord.*`), also editable in this extension's Sign language section.

Both are in the Instruments view under **Sign instruments** (🤟).

## Lazy

This is a **lazy** extension ([`docs/design/lazy-extensions.md`](../../docs/design/lazy-extensions.md)): a player who never signs downloads only its stubs (about 5 kB: the dial, the branches as data, the two instruments). The nodes, the recogniser, its weights and the panel load the first time the graph names `asl-signs` (picking ASL Viewer or ASL Chords, or switching the `asl` dial on), or when the Sign language section is opened.

## What is where

| | |
|---|---|
| `src/index.ts`, `src/ui.tsx` | The EAGER stubs: the manifest without nodes (`provides` names them), the section as data. |
| `src/lazy.ts`, `src/lazy_ui.tsx` | The DEFERRED halves (`extensions.json`'s `lazy` entry): the node definitions; the React half. |
| `src/schema.ts` | The `asl` dial's Zod schema, on its own so the stub carries the dial without the node. |
| `src/nodes/asl_signs.ts` | `asl-signs`: the hands to a reading (`reading`, by sign id; `signs`, the overlay's generic `CategoryScores`). Loads the models lazily (`@thoremin/lazy`). |
| `src/nodes/sign_chord.ts` | `sign-chord`: A..G to the key's chord, voiced and rendered like the face chords (`@thoremin/sdk/music/voicing`), on voice ids from 2,000,000 (clear of every other producer). |
| `src/branches.ts` | `asl-signs` (reader + the `categoryLabel` / `categoryBars` overlay cues) and `asl-chord` (requires it; a voice, the chord name). |
| `src/dials.ts` | The `asl` dial: on/off, movement signs, confidence, smoothing, chords, hold. |
| `src/panels/asl.tsx`, `src/app/aslStatus.ts` | The Sign language section and its live readout. |

The recogniser is the pure package [`@thoremin/asl`](../asl/README.md), usable without thoremin.
