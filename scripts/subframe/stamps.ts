/**
 * The bench's stamp regimes: what a clip's observation stream looks like through a
 * browser that polls the video at the display rate (`raf-poll`), and through the frame
 * pump's gated de-jitter (step 9 of the 2026-10-05 timing plan). Pure; the scorer and
 * the de-jitter tests share them, and `decimate.ts` is the slow column's half.
 *
 * `pollAtVsync` is Safari before the pump fix (the timing plan's step 0): positions are
 * HELD from the latest camera frame and sampled at vsync, each sample stamped with the
 * vsync time, so a 30 fps clip under a 60 Hz poll becomes sample-and-hold pairs with
 * regular clock stamps. It is the regression guard for two things: the pump no longer
 * producing it, and the de-jitter never fitting a line through it (its stamps already
 * sit on a grid, so the jitter gate stays shut).
 *
 * `dejitterStamps` runs the SDK's de-jitter over the stream with the source the regime
 * stands for: the bench's `exact` and `capture-jitter-actual` regimes report the
 * camera's own times (`capture`, the post-#226 world), `capture-jitter` (nominal) and
 * `stamp-noise` report a clock's (`clock`, the pre-#226 stamp), and `raf-poll` a vsync
 * clock's. A sample the de-jitter passed through is the input sample, the same object,
 * so a capture regime's stream is byte-identical before and after (asserted in
 * `test/subframe/stamp_dejitter.test.ts`, and checked again by the scorer).
 */
import type { Sample } from '@thoremin/ictus';
import { createStampDejitter, type DejitterStampSource, type StampDejitterOptions } from '@thoremin/sdk/timing/stamp_dejitter';

/** The display rate a `raf-poll` stands for, Hz. */
export const DEFAULT_POLL_HZ = 60;

/** The stamp source a bench timing regime's stream stands for. */
export function stampSourceOfRegime(timing: string): DejitterStampSource {
  switch (timing) {
    case 'exact':
    case 'capture-jitter-actual':
      return 'capture';
    case 'capture-jitter':
    case 'stamp-noise':
    case 'raf-poll':
      return 'clock';
    default:
      throw new Error(`unknown capture-timing regime: ${timing}`);
  }
}

/** Positions held from the latest frame, sampled at a `hz` vsync from the first
 *  sample's time: every vsync tick emits the latest sample captured by then, stamped
 *  with the tick's time. The first sample starts the grid. */
export function pollAtVsync(samples: Sample[], hz: number = DEFAULT_POLL_HZ): Sample[] {
  if (!samples.length) return samples;
  const period = 1 / hz;
  const out: Sample[] = [];
  const t0 = samples[0].t;
  const last = samples[samples.length - 1].t;
  let i = 0;
  for (let k = 0; ; k++) {
    const t = t0 + k * period;
    if (t > last + period) break;
    while (i + 1 < samples.length && samples[i + 1].t <= t) i++;
    out.push({ t, x: samples[i].x, y: samples[i].y });
  }
  return out;
}

/** The stream through the de-jitter, every stamp declared to be of `source`. */
export function dejitterStamps(samples: Sample[], source: DejitterStampSource, options: StampDejitterOptions = {}): Sample[] {
  const dj = createStampDejitter(options);
  return samples.map((s) => {
    const r = dj.push(1000 * s.t, source);
    // The module's output whenever it differs from the input: a replaced stamp, or a
    // pass-through it floored after one (so the stream never steps back).
    return r.tMs !== 1000 * s.t ? { t: r.tMs / 1000, x: s.x, y: s.y } : s;
  });
}
