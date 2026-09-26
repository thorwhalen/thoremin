/**
 * Summary statistics for latency samples (#227).
 *
 * Why a module of its own: the latency report states every stage as a MEAN and a
 * JITTER, separately, because jitter is judged as harshly as latency
 * (`docs/research/intent-and-subframe-timing.md` §1). A single "average lag" hides
 * the half that matters for rhythm. Percentiles rather than min/max because one
 * stalled frame (a GC pause, a tab switch) would otherwise own the whole report.
 *
 * Pure, no DOM, no clock: shared by the in-app probe, the strike test and the
 * headless measurement script, and unit-tested in Node.
 */

/** One stage's samples, summarised. All values in the samples' own unit (ms here). */
export interface Summary {
  n: number;
  mean: number;
  /** Standard deviation: the jitter. */
  sd: number;
  min: number;
  p5: number;
  p50: number;
  p95: number;
  max: number;
}

const EMPTY: Summary = { n: 0, mean: NaN, sd: NaN, min: NaN, p5: NaN, p50: NaN, p95: NaN, max: NaN };

/** Linear-interpolated quantile of an ascending-sorted array, q in [0, 1]. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Summarise finite samples; non-finite values are dropped, not counted. */
export function summarize(samples: Iterable<number>): Summary {
  const xs = [...samples].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (xs.length === 0) return { ...EMPTY };
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return {
    n: xs.length,
    mean,
    sd: Math.sqrt(variance),
    min: xs[0],
    p5: quantileSorted(xs, 0.05),
    p50: quantileSorted(xs, 0.5),
    p95: quantileSorted(xs, 0.95),
    max: xs[xs.length - 1],
  };
}

/**
 * A bounded sample buffer: keeps the most recent `capacity` values so a probe left
 * running for an hour costs a fixed amount of memory and reports the recent past.
 */
export class RingSamples {
  private readonly buf: number[] = [];
  private next = 0;

  constructor(readonly capacity: number = 2000) {
    if (!(capacity >= 1)) throw new RangeError(`RingSamples: capacity must be >= 1 (got ${capacity})`);
  }

  push(x: number): void {
    if (!Number.isFinite(x)) return;
    if (this.buf.length < this.capacity) this.buf.push(x);
    else this.buf[this.next] = x;
    this.next = (this.next + 1) % this.capacity;
  }

  get size(): number {
    return this.buf.length;
  }

  values(): number[] {
    return [...this.buf];
  }

  clear(): void {
    this.buf.length = 0;
    this.next = 0;
  }

  summary(): Summary {
    return summarize(this.buf);
  }
}

/** Format a summary as one short line: `12.3 ± 1.4 ms (p50 12.1, p95 14.9, n 300)`. */
export function formatSummary(s: Summary, unit = 'ms'): string {
  if (s.n === 0) return 'no samples';
  const f = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));
  return `${f(s.mean)} ± ${f(s.sd)} ${unit} (p50 ${f(s.p50)}, p95 ${f(s.p95)}, n ${s.n})`;
}
