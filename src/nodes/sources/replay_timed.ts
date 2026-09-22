/**
 * `replay-source-timed` node — replays a recorded stream **by timestamp** (#215, the
 * third part of #101 M-E).
 *
 * `replay-source` replays by **index**: one recorded value per tick, whatever the tick's
 * time. That is canonical for CI goldens and stays so — every committed fixture and every
 * byte-identity digest depends on it. This node is the *other* reading: it honours each
 * record's `StreamRecord.t` against the engine's `ctx.time`, so a take recorded at 24 fps
 * replays at its own pace under a 60 fps engine (each frame held ~2.5 ticks) or a 12 fps
 * one (every other frame skipped), and a mixed-rate composition lines up instead of
 * drifting (design R2).
 *
 * ## A separate node, not a flag on `replay-source`
 *
 * The design is explicit that index-by-tick "stays canonical for CI goldens". A
 * `timed: true` param would put every fixture path one typo away from resampling. Two
 * node types make the choice visible in the `GraphSpec` itself.
 *
 * ## Resampling policy: hold-last, never interpolate
 *
 * On each tick the node emits the **latest record whose (relative) time is not after the
 * tick's (relative) time**. That is the same reading the Applier's pump gives a `signal`
 * source (the newest frame wins, and a frame is held until a newer one arrives), so a
 * replayed stream and a live one look the same to the graph. Interpolation is not
 * offered: it is wrong for anything nominal (a chord name, a handedness label, a gesture
 * event), and a replay that silently invents values it never recorded is not a replay.
 *
 * ## `Clock.timeScale` is honoured through `ctx.time`, deliberately not re-applied
 *
 * Under a `RealtimeClock` at speed `s` the engine is handed
 * `base + (wall - base) * s` — engine time already runs at `s` times wall time, which is
 * exactly what `Clock.timeScale` reports (#210). Reading the recording against *engine*
 * time therefore plays it at `s`x in wall time with no further work: a 5 s take replays
 * in 2.5 wall seconds at 2x. Multiplying by `ctx.resources.timeScale` here as well would
 * apply the speed twice (4x). Under a `BatchClock` (`timeScale` absent) engine time is
 * the synthesized `tick * nominalDt`, so a recording made at a different rate than the
 * batch's `nominalDt` still resamples faithfully. `test/replay_timed.test.ts` pins the
 * 1x and 2x cases through a real `Applier` + `RealtimeClock`.
 *
 * ## Time origin: the node's own first tick
 *
 * Playback position is `ctx.time - (ctx.time at this instance's first process())`, and
 * record times are taken relative to the first record's `t`. Both anchors are needed:
 * a live `RealtimeClock` starts engine time at a wall-clock value, not 0, and a source
 * swapped into a running graph (`applyGraph`, #51) must open on its first record, not
 * wherever the engine's clock happens to be — the same reason `replay-hands` counts its
 * own frames rather than reading `ctx.tick`.
 *
 * ## Tolerance
 *
 * The recorder and the committed fixtures round `t` to 6 decimals (1/24 s is stored as
 * `0.041667`), so a record can land a hair after the engine tick it was recorded on.
 * A record is due when its relative time is within `toleranceSec` of the tick's; the
 * default (1 µs) absorbs that rounding and is far below any frame period.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';

/** One recorded sample. `StreamRecord`-compatible: its `tick` is accepted and ignored. */
const TimedRecord = z.object({
  /** Time in seconds (the recorder's `ctx.time`). */
  t: z.number().finite(),
  value: z.unknown(),
  tick: z.number().optional(),
});

const Params = z.object({
  /** The recorded samples, in non-decreasing `t` order (e.g. a parsed NDJSON stream). */
  records: z
    .array(TimedRecord)
    .default([])
    .refine((rs) => rs.every((r, i) => i === 0 || r.t >= rs[i - 1].t), {
      message: 'records must be in non-decreasing `t` order (replay resamples by timestamp)',
    }),
  /**
   * Loop back to the start when exhausted (otherwise hold the last value). The loop
   * period is the recording's span plus one mean frame interval, so a uniformly sampled
   * take loops seamlessly, matching `replay-source`'s index loop at the recorded rate.
   */
  loop: z.boolean().default(false),
  /** Seconds of slack when deciding a record is due (absorbs `t` rounding; see the module docstring). */
  toleranceSec: z.number().min(0).default(1e-6),
});
type Params = z.infer<typeof Params>;

/**
 * Index of the last element of the ascending `times` that is `<= x`, or -1. A binary
 * search rather than a forward cursor, so it stays correct if engine time ever moves
 * backwards (the engine clamps `dt` to 0 but does not forbid it).
 */
function lastAtOrBefore(times: readonly number[], x: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= x) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export const replaySourceTimedNode = defineNode<Params>({
  type: 'replay-source-timed',
  roles: ['source'],
  title: 'Replay Source (timed)',
  description:
    'Emits a recorded value stream by timestamp against ctx.time (hold-last, never interpolated), so a take replays at its own pace at any tick rate or clock speed.',
  inputs: [],
  outputs: [{ name: 'value' }],
  params: Params,
  make({ records, loop, toleranceSec }) {
    const origin = records.length > 0 ? records[0].t : 0;
    const times = records.map((r) => r.t - origin);
    const span = times.length > 0 ? times[times.length - 1] : 0;
    // Uniform sampling at interval d gives span = (n-1)d, so this adds exactly one d.
    const period = times.length > 1 ? span + span / (times.length - 1) : 0;
    // Per-INSTANCE, so a replay swapped into a running graph starts at its first record.
    let start: number | undefined;
    return {
      process(_inputs, ctx) {
        if (records.length === 0) return {};
        if (start === undefined) start = ctx.time;
        // Tolerance is added BEFORE wrapping, so a tick a rounding error short of a loop
        // boundary wraps to the first record rather than re-showing the last one.
        let pos = ctx.time - start + toleranceSec;
        if (loop && period > 0) pos = ((pos % period) + period) % period;
        // Record 0 sits at relative time 0, so from the first tick there is always a due
        // record; the max() only guards a clock that has gone behind the anchor.
        const i = Math.max(0, lastAtOrBefore(times, pos));
        return { value: records[i].value };
      },
    };
  },
});
