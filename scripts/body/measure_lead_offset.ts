/**
 * The body conductor's lead offset on A1's conductor fixtures (#427): the numbers in
 * the #427 PR.
 *
 * On each clip the grid IS the beating wrist's strokes (A1), the stand-in for the click
 * a player conducts against. The calibration (`createLeadCalibration`: each joint with a
 * detector of its own, its period from the grid) reads one span of the clip; the offsets
 * it learns are applied to the body conductor's follower with that joint ALONE followed
 * (`createLeadCorrector`), and the follower's anchors are scored against the grid on a
 * span: the whole clip after calibrating on the whole clip (in-sample: what the mechanism
 * reaches), and each half after calibrating on the other (held out: whether the lag is a
 * property of the player that survives the next half minute). Columns: the calibrated
 * lag (ms), its R and anchor count; the offset kept (`none`: refused, the joint does not
 * keep the click); the follower's lag before and after, in ms.
 *
 * Usage: npx vite-node scripts/body/measure_lead_offset.ts -- [scenario ...]
 */
import { loadClip } from './lib_clips';
import { scoreLevel } from './lib_channels';
import { calibrate, followAnchors } from './lib_impact';

const CLIPS = ['video_body_conducting_44', 'video_body_conducting_34', 'video_body_conducting_24'];
const ms = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? String(Math.round(x * 1000)) : '-');

const names = process.argv.slice(2).filter((a) => a !== '--');
console.log('| clip | joint | test span | calibrated on | lag, R, n | offset | lag before | lag after | F before | F after |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const name of names.length ? names : CLIPS) {
  const clip = loadClip(name);
  const dur = clip.frames.length / clip.fps;
  const h = dur / 2;
  const runs: Array<[string, [number, number], string, [number, number]]> = [
    ['whole', [0, dur], 'whole', [0, dur]],
    ['2nd half', [h, dur], '1st half', [0, h]],
    ['1st half', [0, h], '2nd half', [h, dur]],
  ];
  for (const joint of ['trunk', 'elbow', 'wrist']) {
    const raw = followAnchors(clip, [joint]);
    for (const [test, span, calName, calSpan] of runs) {
      const cal = calibrate(clip, calSpan[0], calSpan[1]);
      const l = cal.lags[joint];
      const before = scoreLevel(raw, clip.grid, 1, [span]);
      const after = scoreLevel(followAnchors(clip, [joint], cal.offsets), clip.grid, 1, [span]);
      console.log(`| ${name.replace('video_body_', '')} | ${joint} | ${test} | ${calName} | ${ms(l.lagS)}, ${l.r.toFixed(2)}, ${l.n} | ${cal.offsets[joint] === undefined ? 'none' : ms(cal.offsets[joint])} | ${ms(before.lagS)} | ${ms(after.lagS)} | ${before.f.toFixed(2)} | ${after.f.toFixed(2)} |`);
    }
  }
}
