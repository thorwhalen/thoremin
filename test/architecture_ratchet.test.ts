/**
 * The architecture fitness ratchet (#600 S1; `docs/design/vertical-slices.md` §5): the numbers
 * that measure how far the code is from vertical slices behind one extension contract may only
 * go down. `scripts/lib_architecture.ts` says what each number counts; the committed baseline is
 * `test/architecture.baseline.json`.
 *
 *  - a number that GREW fails, with what grew (the offending imports, files or cycles);
 *  - a number that SHRANK fails too, as a stale baseline, until the PR that lowered it runs
 *    `npm run ratchet:arch -- --update` and commits the result (the React type ratchet's rule:
 *    a shrink left in the baseline is slack that hides the next regression);
 *  - the largest files' line counts are ceilings only: a smaller file passes.
 */
import { describe, expect, it } from 'vitest';
import { compareToBaseline, measureNow, readBaseline } from '../scripts/lib_architecture_baseline';

describe('the architecture ratchet', () => {
  it('no number grew past the baseline, and none shrank without a re-baseline', async () => {
    const baseline = readBaseline();
    const { numbers, detail } = await measureNow(baseline);
    const { grew, shrank } = compareToBaseline(baseline, numbers);
    const why = [
      ...grew.map((g) => `GREW ${g}`),
      ...shrank.map((s) => `SHRANK ${s}: run \`npm run ratchet:arch -- --update\` and commit the baseline`),
      grew.length ? `details: ${JSON.stringify(detail, null, 1)}` : '',
    ].filter(Boolean);
    expect(why, why.join('\n')).toEqual([]);
  }, 60_000);

  it('the measurement sees the tree (a ratchet over nothing checks nothing)', async () => {
    const { numbers } = await measureNow();
    expect(numbers.storeControlsPorts).toBeGreaterThan(0);
    expect(numbers.foldPoints).toBeGreaterThan(0);
    expect(Object.keys(numbers.extensionNamesInCore).length).toBeGreaterThan(0);
    expect(Object.keys(numbers.largestFiles)).toHaveLength(5);
  }, 60_000);
});
