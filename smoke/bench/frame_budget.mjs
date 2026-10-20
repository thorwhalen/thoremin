#!/usr/bin/env node
/**
 * The frame-budget bench: time one engine tick for EVERY shipped seed in the built bundle, under
 * the synthetic hands and body, and print a table (heaviest first) plus the JSON beside it.
 *
 * It runs the frame-budget smoke (`smoke/tests/frame_budget.smoke.ts`) with every seed instead of
 * the gated few, so the numbers are measured exactly the way the gate measures them.
 *
 *   node smoke/bench/frame_budget.mjs [--out report.json]
 *
 * From the repository root. Like the smoke, it builds and serves the bundle on SMOKE_PORT (4173 by
 * default) unless a server is already there (`npm run build` first when reusing one).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outFlag = process.argv.indexOf('--out');
const out = outFlag > 0 ? process.argv[outFlag + 1] : join(mkdtempSync(join(tmpdir(), 'frame-budget-')), 'report.json');

const run = spawnSync('npx', ['--prefix', 'smoke', 'playwright', 'test', '-c', 'smoke/playwright.config.ts', 'frame_budget'], {
  stdio: 'inherit',
  env: { ...process.env, FRAME_BUDGET_SEEDS: 'all', FRAME_BUDGET_OUT: out },
});

let report;
try {
  report = JSON.parse(readFileSync(out, 'utf8'));
} catch {
  console.error(`no report at ${out}: the run did not get as far as timing`);
  process.exit(run.status || 1);
}
const rows = [...report.rows].sort((a, b) => b.mean - a.mean);
const f = (x, d = 2) => x.toFixed(d);
console.log(`\nFrame budget, ${report.when} (tickCompute, ms; heaviest first)\n`);
console.log('| seed | ticks | mean | p50 | p95 | max | tick period |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.seed} | ${r.ticks} | ${f(r.mean)} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.max, 1)} | ${f(r.period, 1)} |`);
console.log(`\nGate (CI, the heaviest seeds): median < ${report.budget.gateMs.p50} ms, mean < ${report.budget.gateMs.mean} ms. Report: ${out}`);
process.exit(run.status ?? 0);
