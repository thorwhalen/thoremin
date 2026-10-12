# @thoremin/asl

American Sign Language from hand landmarks: the fingerspelled alphabet and a few common words, as a score per sign, every frame. Pure TypeScript (no DAG, no DOM, no ML runtime); give it MediaPipe hand landmarks, get a reading.

```ts
import { createSignRecognizer, parseMlpModel } from '@thoremin/asl';
import staticJson from '@thoremin/asl/models/static.json';
import motionJson from '@thoremin/asl/models/motion.json';

const reader = createSignRecognizer(parseMlpModel(staticJson), parseMlpModel(motionJson));
const r = reader.update({ width, height, hands }, tSeconds); // hands: MediaPipe HandLandmarker, keypoints in pixels
r.label;   // 'F', 'thankyou', or null
r.scores;  // one 0..1 score per sign in SIGN_IDS order (A..Z, then the words), summing to 1
```

## What it recognises

- **24 held letters** (all but J and Z), from one frame's handshape: a small classifier over 66 geometric features (finger flexion, spreads, fingertip distances, hand orientation; `features.ts`).
- **Movement signs**: J and Z (drawn in the air) and YES, NO, HELLO, THANK YOU, PLEASE, SORRY, BYE. Every one of these words is a movement, so a single frame cannot tell them apart from a letter. A second classifier reads a window of the last 0.6 to 1.8 s: the handshape over time (the letter model's posterior), the wrist path and two fingertip paths (`motion.ts`).

The two fuse into one distribution (`recognizer.ts`), with time-constant smoothing, a confidence floor, hysteresis between signs, and a short latch that keeps a word on screen after its movement ends.

## How good it is

See the model comparison in `docs/research/asl-recognition.md`. Both models were trained on public data (MIT-licensed corpora on Hugging Face) by `scripts/asl/`, which also writes the parity fixture that pins this package's featurisation to the training code (`test/asl/parity.test.ts`).

## Limits worth knowing

- Location is not used: the hand alone is read, not where it is relative to the face or body. THANK YOU (from the chin) and HELLO (from the forehead) are told apart by their movement, not by where they start.
- A relaxed hand that is not signing still looks like some letter; the confidence floor and smoothing keep that quiet, but do not remove it.
- The closed-fist letters (A, E, M, N, S, T) differ by where the thumb sits, which hand landmarks see poorly; they are the most confused.
