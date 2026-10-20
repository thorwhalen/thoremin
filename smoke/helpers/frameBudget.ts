/**
 * The frame budget's settings: which instruments are timed and how generous the gate is.
 *
 * The camera frame is ~33 ms (30 fps). The gate is set an order of magnitude above what the
 * heaviest seeds measure, on purpose (see `frame_budget.smoke.ts`); the numbers it is set against
 * are in the bench's report (`node smoke/bench/frame_budget.mjs`), which times every seed.
 */
import manifest from '../seed_instruments.json';

const ALL = (manifest.seeds as { name: string }[]).map((s) => s.name);

/** The heaviest shipped seeds by the bench (2026-10-20, headless Chromium on a shared server: the
 *  largest mean and 95th-percentile ticks, 1.2-2.2 ms and 2.1-7.3 ms; every seed's median 0.4-1.3 ms). */
const HEAVIEST = ['Chord Map + Face', 'Chord Map', 'Pentatonic Map', 'Play Along (MIDI)', 'Next-Chord Wheel'];

export const FRAME_BUDGET = {
  /** `FRAME_BUDGET_SEEDS=all` times every seed (the bench); otherwise the heaviest. */
  seeds: process.env.FRAME_BUDGET_SEEDS === 'all' ? ALL : HEAVIEST,
  /** Let the switch settle (lazy loads, the first ticks' allocations) before timing. */
  settleMs: 1_500,
  measureMs: 4_000,
  /** Fewer ticks than this in the window means the engine stalled, which fails on its own. */
  minTicks: 30,
  /** The gate, ms, on the median and the mean tick: about 8x what the heaviest measure, so only a
   *  regression of an order of magnitude trips it. The 95th percentile is reported, not gated: a
   *  garbage collection or a lazy load landing in the window moves it by several times. */
  gateMs: { p50: 10, mean: 15 },
} as const;
