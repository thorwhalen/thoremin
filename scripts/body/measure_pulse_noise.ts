/**
 * Red noise against the real body streams, through the whole pulse follower (#339 item 2):
 * the numbers of `docs/research/body-conducting-and-pose-categories.md` §5.4. A pulse-side
 * gate is worth shipping only if it cuts the ticks red noise is trusted in WITHOUT cutting
 * the real dancers' and conductors' trusted ticks, so both are counted under the same
 * options: trusted = confidence at or above `PULSE_TRUSTED_CONFIDENCE`, after the first 6 s.
 *
 * Usage: npx vite-node scripts/body/measure_pulse_noise.ts -- [--long S] [--long-level S] [--speed X]
 *        (`--long 0` is the follower without the long-level window; the default is the
 *        package's own default)
 */
import { createPulseFollower, PULSE_TRUSTED_CONFIDENCE, type PulseOptions, type PulseState } from '@thoremin/ictus';
import type { BodyFrame } from '@/nodes';
import { pulseChannelValue, createYawUnwrapper, AUTO_PULSE_CHANNELS } from '@/slices/body/nodes/body_pulse';
import { loadStream } from '../../test/helpers/fixtures';

const HZ = 30;
const SKIP_S = 6;
const CLIPS = ['video_body_que_calor', 'video_body_budots', 'video_body_conducting_44', 'video_body_conducting_34', 'video_body_conducting_24'];

const arg = (name: string): number | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : undefined;
};
const opts: PulseOptions = {};
if (arg('--long') !== undefined) opts.longWindowS = arg('--long');
if (arg('--long-level') !== undefined) opts.longLevelS = arg('--long-level');
const speed = arg('--speed') ?? 1;

const run = (xs: readonly number[]): PulseState[] => {
  const p = createPulseFollower(opts);
  return xs.map((v, i) => p.feed(i / HZ, v));
};
const trustedOf = (states: readonly PulseState[]) => states.slice(SKIP_S * HZ).filter((s) => s.confidence >= PULSE_TRUSTED_CONFIDENCE);
/** Trusted runs at one level (within 6 %) of at least `PERSIST_S`: what the pace
 *  controller's persistence would follow (it acts on a new level only after 3 s). */
const PERSIST_S = 3;
const persistentRuns = (states: readonly PulseState[]): number => {
  let runs = 0;
  let start = -1;
  let level = NaN;
  const close = (i: number) => {
    if (start >= 0 && i - start >= PERSIST_S * HZ) runs++;
    start = -1;
  };
  states.slice(SKIP_S * HZ).forEach((s, i) => {
    const ok = s.confidence >= PULSE_TRUSTED_CONFIDENCE;
    if (ok && start >= 0 && Math.abs(s.level / level - 1) < 0.06) return;
    close(i);
    if (ok) {
      start = i;
      level = s.level;
    }
  });
  close(states.length - SKIP_S * HZ);
  return runs;
};

// Red noise: the generator of `test/ictus_pulse.test.ts`, 16 runs of 40 s per smoothness.
for (const a of [0.8, 0.95]) {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  let trusted = 0;
  let slow = 0;
  let ticks = 0;
  let runs = 0;
  for (let k = 0; k < 16; k++) {
    let y = 0;
    const states = run(Array.from({ length: 40 * HZ }, () => (y = a * y + rand())));
    const tr = trustedOf(states);
    trusted += tr.length;
    slow += tr.filter((s) => s.level >= 1.5).length;
    runs += persistentRuns(states);
    ticks += states.length - SKIP_S * HZ;
  }
  console.log(`red noise a=${a}: trusted ${((100 * trusted) / ticks).toFixed(2)} % (${trusted} of ${ticks}), at a level of 1.5 s or more ${slow}; runs of ${PERSIST_S} s or more ${runs}`);
}

// The body fixtures, the four channels `auto` chooses among, resampled by `speed`.
let total = 0;
let ticksAll = 0;
let runsAll = 0;
for (const clip of CLIPS) {
  const frames = loadStream(clip, 'camBody.body') as BodyFrame[];
  const row: string[] = [];
  for (const ch of AUTO_PULSE_CHANNELS) {
    const unwrap = createYawUnwrapper();
    const raw = frames.map((f) => (ch === 'yaw' ? unwrap(pulseChannelValue(f, ch)) : pulseChannelValue(f, ch)));
    // A faster replay: the same samples on a compressed clock (no interpolation).
    const p = createPulseFollower(opts);
    const states = raw.map((v, i) => p.feed(i / (HZ * speed), v));
    const tr = trustedOf(states);
    total += tr.length;
    ticksAll += states.length - SKIP_S * HZ;
    runsAll += persistentRuns(states);
    const lv = tr.length ? tr.reduce((m, s) => m + s.level, 0) / tr.length : NaN;
    row.push(`${ch} ${tr.length} (${Number.isFinite(lv) ? lv.toFixed(2) : '-'} s)`);
  }
  console.log(`${clip}: ${row.join(', ')}`);
}
console.log(`real fixtures at ${speed}x: trusted ticks ${total} of ${ticksAll}; runs of ${PERSIST_S} s or more ${runsAll}`);

// A step INTO and OUT OF the long levels on a clean cosine with noise: seconds after the
// step until every later tick is within 5 % of the new period and trusted.
const steps: Array<[number, number]> = [[1.2, 1.9], [1.9, 1.2], [1.86, 2.4], [2.4, 1.86], [1.6, 1.8]];
for (const [p0, p1] of steps) {
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  let phase = 0;
  const xs = Array.from({ length: 50 * HZ }, (_, i) => {
    phase += (2 * Math.PI) / ((i / HZ < 20 ? p0 : p1) * HZ);
    return Math.cos(phase) + 0.3 * rand();
  });
  const states = run(xs);
  let bad = 20 * HZ;
  for (let i = 20 * HZ; i < states.length; i++) if (!(Math.abs(states[i].period / p1 - 1) < 0.05 && states[i].confidence >= PULSE_TRUSTED_CONFIDENCE)) bad = i;
  const untrusted = states.slice(20 * HZ).filter((s) => s.confidence < PULSE_TRUSTED_CONFIDENCE).length / HZ;
  console.log(`step ${p0} -> ${p1} s: settled ${((bad + 1) / HZ - 20).toFixed(1)} s, untrusted ${untrusted.toFixed(1)} s`);
}
