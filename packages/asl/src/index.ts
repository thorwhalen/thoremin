/**
 * `@thoremin/asl`: American Sign Language from hand landmarks.
 *
 * The fingerspelled alphabet (24 static letters from one frame, J and Z from movement) and
 * a few common words (all movements), recognised by two small MLPs over MediaPipe's 21 hand
 * landmarks. Pure: give it hand frames, get one score per sign. The weights are JSON in
 * `models/` (trained by `scripts/asl/` on public data; see the README for the numbers).
 */
export * from './labels';
export * from './features';
export * from './mlp';
export * from './motion';
export * from './recognizer';
