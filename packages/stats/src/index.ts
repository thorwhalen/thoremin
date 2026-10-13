/**
 * `@thoremin/stats` — the small pure statistics both the SDK's timing code and `ictus`
 * read (#392): quantiles with a stated index rule, medians, an ordinary least-squares
 * line, an exponentially weighted update and a unit clamp. A leaf package: it imports
 * nothing, so `ictus` stays extractable with it alongside.
 */
export { quantileSorted, quantile, median, median3, sortedCopy } from './quantile';
export type { QuantileIndex, QuantileOptions, MedianEven, MedianOptions } from './quantile';
export { olsLine } from './line';
export type { LineFit, LineOptions } from './line';
export { ewUpdate } from './smooth';
export { clamp01 } from './clamp';
