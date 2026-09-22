/**
 * Time scale — how fast engine time runs against wall time (#101 M-G, boundary B).
 *
 * Control-rate parameters scale for free: a node reads `ctx.time`, so running the engine
 * at 2x simply advances that value twice as fast and every mapping follows. **Audio does
 * not.** A Web Audio graph rides `AudioContext.currentTime`, which is wall time and
 * cannot be multiplied — so an engine at 2x driving a live synth does not produce "the
 * same music, faster". It produces the same music at the same rate with the control
 * stream sliding underneath it: pitches and gains arriving twice as fast at oscillators
 * that keep running in real time.
 *
 * The design calls the honest reading of that boundary (B):
 *
 * > real-time = live audio; accelerated/slowed = control-rate preview with audio muted,
 * > plus an explicit "render at speed" action on demand. **Never silently pitch-shift.**
 * > Live/streaming/generative audio (Lyria) cannot be scaled at all.
 *
 * So this module is the mechanism for the "with audio muted" half. The Applier publishes
 * the running clock's scale onto `ctx.resources`, and every node that produces real-time
 * output consults {@link realtimeOutputAllowed} before making a sound.
 *
 * ## Absent means allowed, deliberately
 *
 * A missing scale is **not** treated as "not real time". Two callers depend on that:
 * `replayNode` passes whatever resources a test hands it (usually none), and a batch run
 * has no `AudioContext` at all, so the synth already self-no-ops. Making absence mute
 * would change nothing about safety and would break every existing node test. Only an
 * explicitly non-unity scale silences anything.
 */
import type { NodeContext } from './types';

/** The `ctx.resources` key the Applier publishes the running clock's scale under. */
export const TIME_SCALE_KEY = 'timeScale';

/**
 * May a node emit real-time output (audio, MIDI, a generative stream) on this tick?
 *
 * False only when the host has declared a scale that is not real time. See the module
 * docstring for why absence means yes.
 */
export function realtimeOutputAllowed(ctx: NodeContext): boolean {
  const scale = (ctx.resources as Record<string, unknown> | undefined)?.[TIME_SCALE_KEY];
  return scale === undefined || scale === 1;
}
