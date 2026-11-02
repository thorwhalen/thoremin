/**
 * `@thoremin/stats` — the small pure statistics both the SDK's timing code and `ictus`
 * read (#392): quantiles with a stated index rule, medians, an ordinary least-squares
 * line, an exponentially weighted update, the 1-euro filter (scalar and 2-D), a unit clamp, and one option helper (`definedOnly`). A leaf package: it imports
 * nothing, so `ictus` stays extractable with it alongside.
 */
export { quantileSorted, quantile, median, median3, sortedCopy } from './quantile';
export type { QuantileIndex, QuantileOptions, MedianEven, MedianOptions } from './quantile';
export { olsLine } from './line';
export type { LineFit, LineOptions } from './line';
export { ewUpdate, createOneEuro, ONE_EURO_DEFAULTS, oneEuroAlpha, createOneEuro2D, ONE_EURO_2D_DEFAULTS } from './smooth';
export type { OneEuro, OneEuroOptions, OneEuro2D, OneEuro2DOptions, OneEuro2DOutput, Point2 } from './smooth';
export { clamp01 } from './clamp';
export { definedOnly } from './options';
