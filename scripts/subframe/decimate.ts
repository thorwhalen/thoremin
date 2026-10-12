/**
 * The slow column's decimators: a clip's observation stream thinned to a slower camera
 * or a slower machine, so every estimator can be scored where a laptop actually runs.
 *
 * `decimateToFps` is a regular slower camera. `decimateByInference` is the regime the
 * timing plan's slow-laptop review found: inference paces the samples, a frame is
 * processed only once the previous one's inference has finished, the latest captured
 * frame wins, and each processed frame keeps its own capture stamp — alternating 33 and
 * 67 ms spacings on a 30 fps camera, not a regular slower rate. Pure; the scorer and the
 * low-rate tests share it.
 */
import type { Sample } from '@thoremin/ictus';

/** A sample exactly midway between two ticks (30 fps thinned to 15) belongs to the
 *  earlier one. */
const HALF_TICK = 0.5 - 1e-9;

/** Keep the sample nearest each tick of a regular `fps` grid (one per tick at most). */
export function decimateToFps(samples: Sample[], fps: number): Sample[] {
  if (!samples.length) return samples;
  const period = 1 / fps;
  const out: Sample[] = [];
  let tick = Math.floor(samples[0].t / period);
  for (let i = 0; i < samples.length; i++) {
    const k = Math.floor(samples[i].t / period + HALF_TICK);
    if (k < tick) continue;
    out.push(samples[i]);
    tick = k + 1;
  }
  return out;
}

/** Inference-paced: process a frame when the previous inference (of `infer` seconds)
 *  has finished, taking the latest frame captured by then; each kept frame keeps its
 *  capture stamp. */
export function decimateByInference(samples: Sample[], infer: number): Sample[] {
  const out: Sample[] = [];
  let free = -Infinity;
  let i = 0;
  while (i < samples.length) {
    // The frame processed next: the latest one captured by the time the machine is
    // free, or the next to arrive if it is already idle.
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].t <= free) j++;
    out.push(samples[j]);
    free = Math.max(free, samples[j].t) + infer;
    i = j + 1;
  }
  return out;
}
