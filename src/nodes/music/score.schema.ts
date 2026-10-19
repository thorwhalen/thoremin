/**
 * The `score` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


/** The built-in demo piece: one octave of a C major scale, one note per beat over an
 *  eight-beat loop — the same piece `scripts/gen_conductor_demo.ts` renders, so a
 *  conductor with no score loaded still hears the scale follow the hand. */
export const DEMO_SCALE_NOTES = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({ midi, start: i, duration: 0.9, velocity: 1 }));

/** The demo piece's loop length in beats: every player of the demo (the `score` node's
 *  default, the default graph's score params, the orchestra's demo plan) loops it here. */
export const DEMO_LOOP_BEATS = 8;
