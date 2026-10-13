# @thoremin/stats

The small pure statistics thoremin's timing code reads, written once: `quantileSorted` / `quantile` with the index rule stated at every call, `median` (and which middle an even sample takes), `median3`, `olsLine` (the centred least-squares line), `ewUpdate` (the NaN-seeded exponentially weighted step) and `clamp01`. A leaf package with no dependencies, imported by `@thoremin/sdk` (the timing resource, the glitch counter, the stamp de-jitter), by `@thoremin/ictus` (the impact predictor, the detector, the priors), by the air extension and by the latency probe.

```ts
import { quantile, median, olsLine } from '@thoremin/stats';

quantile([0.034, 0.033, 0.067], 0.2, { index: 'floor' }); // 0.033, a real gap
median([3, 1, 4, 2], { even: 'upper' });                 // 3
olsLine([0, 1, 2], [10, 43, 77]);                         // { intercept, slope, rss, sxx, n }
```

## Why the index rule is an option

On a window of a few dozen samples the textbook quantile rules disagree by a whole sample, and each caller chose its rule for a reason: a low quantile that must land on a real gap (`floor`), a deadline read by nearest rank (`nearestRank`), a report that interpolates (`interpolate`, the default). Their tests pin the numbers that rule gives, so the rule is named at every call site and never changed by moving the code. The rules are documented on `QuantileIndex` in `src/quantile.ts`.

## Why the centred line

Stamps in milliseconds since page load sit near a million; the raw-sums determinant cancels badly there, the centred form does not. `olsLine` returns the residual sum of squares and the x spread so each caller states its own summary (an RMS over `n`, an sd over `n - 2`) and its own degeneracy threshold.

Tests: `test/stats.test.ts`.
