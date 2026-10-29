/**
 * `@thoremin/games` — the listening games without the instrument around them: lessons as data,
 * a session per game (Sing, Play along, Match the note, the calibration take, and the field games:
 * Pop the Notes and the Pitch Maze, built from a voice cursor, a loudness scale and a dwell) that is fed the
 * engine time and what the microphone heard each tick and returns a view model plus the sounds to
 * play, and the stage that draws a view model on a 2D canvas.
 *
 * Pure apart from the canvas calls in `stage`: no DAG, no React, no store, no clock of its own.
 * thoremin's games slice (`src/slices/games/`) runs these sessions inside a graph node; a
 * standalone page (`play/`) runs them in a plain animation loop over its own AudioContext.
 */
export * from './lesson';
export * from './lesson_schema';
export * from './difficulty';
export * from './lessons';
export * from './cues';
export * from './listen';
export * from './view';
export * from './sing';
export * from './play_along';
export * from './match';
export * from './calibrate';
export * from './stage';
export * from './field';
export * from './loudness';
export * from './cursor';
export * from './dwell';
export * from './pop';
export * from './maze';
export * from './field_stage';
