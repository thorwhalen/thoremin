/**
 * The built-in demo piece (#187; in the SDK since #600 S18b): what the conductor plays with no score
 * loaded, and what the orchestra's demo plan loops. Core's `score` node contract re-exports it.
 */

/** The built-in demo piece: one octave of a C major scale, one note per beat over an
 *  eight-beat loop — the same piece `scripts/gen_conductor_demo.ts` renders, so a
 *  conductor with no score loaded still hears the scale follow the hand. */
export const DEMO_SCALE_NOTES = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({ midi, start: i, duration: 0.9, velocity: 1 }));

/** The demo piece's loop length in beats: every player of the demo (the `score` node's
 *  default, the default graph's score params, the orchestra's demo plan) loops it here. */
export const DEMO_LOOP_BEATS = 8;
