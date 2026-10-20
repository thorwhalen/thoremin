/**
 * The frame budget: how long one engine tick takes, in the built bundle, for the heaviest shipped
 * instruments under the synthetic hands (and body), and a generous gate on it.
 *
 * The camera delivers a frame about every 33 ms; everything the engine does with it (features,
 * mapping, music, the audio scheduling, the overlay's inputs) runs in one synchronous tick on the
 * main thread, beside React and the browser's own work. A tick that grows towards the frame period
 * drops frames and delays every note. The latency probe (`?probe=latency`, #227) already times the
 * tick (`tickCompute`: from the tick's start to its last node); this test reads it per instrument,
 * prints a table (and writes it as JSON when `FRAME_BUDGET_OUT` names a file: the bench,
 * `node smoke/bench/frame_budget.mjs`, times every seed that way), and fails only when the median or
 * mean tick takes a large share of the frame: the gate catches a regression of an
 * order of magnitude (a per-tick allocation storm, an accidental O(n^2) over a buffer), not a
 * few percent, because a shared CI runner's timings move by tens of percent from run to run.
 */
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { boot, bootUrl, collectErrors, play } from '../helpers/boot';
import { FRAME_BUDGET } from '../helpers/frameBudget';

interface Stage {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

declare global {
  interface Window {
    thoreminLatency?: { snapshot(): { stages: Record<string, Stage> }; reset(): void };
  }
}

const rows: { seed: string; ticks: number; mean: number; p50: number; p95: number; max: number; period: number }[] = [];
let page: Page;
let errors: string[];

test.describe('the frame budget', () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    errors = collectErrors(page);
    await boot(page, `${bootUrl({ hands: 'synthetic', body: true })}&probe=latency`);
    // The probe's panel sits over the instruments list; its numbers are read through the handle.
    await page.addStyleTag({ content: '[data-testid="latency-probe"] { display: none !important; }' });
  });

  test.afterAll(async () => {
    const table = rows.map((r) => `${r.seed.padEnd(24)} ticks ${String(r.ticks).padStart(4)}  mean ${r.mean.toFixed(2)} ms  p50 ${r.p50.toFixed(2)}  p95 ${r.p95.toFixed(2)}  max ${r.max.toFixed(1)}  period ${r.period.toFixed(1)} ms`);
    console.log(`frame budget (tickCompute, ms):\n${table.join('\n')}`);
    if (process.env.FRAME_BUDGET_OUT) writeFileSync(process.env.FRAME_BUDGET_OUT, JSON.stringify({ when: new Date().toISOString(), budget: FRAME_BUDGET, rows }, null, 2));
    await page.close();
  });

  for (const seed of FRAME_BUDGET.seeds) {
    test(`${seed}: one tick stays inside the frame`, async () => {
      await play(page, seed);
      await page.waitForTimeout(FRAME_BUDGET.settleMs);
      await page.evaluate(() => window.thoreminLatency!.reset());
      await page.waitForTimeout(FRAME_BUDGET.measureMs);
      const s = await page.evaluate(() => window.thoreminLatency!.snapshot().stages);
      const t = s.tickCompute;
      rows.push({ seed, ticks: t.n, mean: t.mean, p50: t.p50, p95: t.p95, max: t.max, period: s.tickPeriod.mean });
      expect(t.n, `${seed} ticked`).toBeGreaterThan(FRAME_BUDGET.minTicks);
      expect(t.p50, `${seed}: the median tick`).toBeLessThan(FRAME_BUDGET.gateMs.p50);
      expect(t.mean, `${seed}: the mean tick`).toBeLessThan(FRAME_BUDGET.gateMs.mean);
      expect(errors).toEqual([]);
    });
  }
});
