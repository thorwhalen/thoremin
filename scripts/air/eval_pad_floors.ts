/**
 * The air drum's pads on the synthetic stick takes, through the PRODUCTION graph: how many
 * strokes land on their own pad, how many were predicted, and how far the sounding time is
 * from the impact (#353, #530, #531, #533).
 *
 * The take is `test/air/synthetic_drums.ts` (a hand gripping a stick on an arc, 30 fps),
 * run the way `test/drums/landing_arc.test.ts` runs it; the rows are the table of
 * `docs/research/subframe-impact-prediction.md` §3.1.3 plus the cases the follow-ups named:
 * a pad's first stroke (#530), strokes whose height varies on stacked pads (#533) and a
 * stroke from a high pad down to a low one (#531). Print it on main and on a branch to get
 * the before / after columns; nothing is written.
 *
 *   npx vite-node scripts/air/eval_pad_floors.ts            # the table
 *   npx vite-node scripts/air/eval_pad_floors.ts --strokes  # and every stroke off its pad
 *   ROW=tilt npx vite-node scripts/air/eval_pad_floors.ts   # only the rows whose name has "tilt"
 */
import { runHeadless } from '@thoremin/dag';
import { loadedAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import type { DrumHit } from '@thoremin/ext-air/nodes/air_drum';
import { DEFAULT_AIR_DRUM } from '@thoremin/ext-air/dials';
import type { PadId, Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { TRUE_STICK_LENGTH } from './lib_synthetic_grip';
import { DRUM_SCRIPT, DRUM_TAKE_FPS, drumTake, scoreTake, starterKitPads, type DrumStroke, type DrumTakeOptions } from '../../test/air/synthetic_drums';

const voice = { root: 4, type: 'minorPentatonic', octaves: 2, baseOctave: 2, sound: 'sine' } as const;

async function play(pads: Pads, options: DrumTakeOptions) {
  const take = drumTake(pads, options);
  const registry = await loadedAppRegistry();
  const g = defaultGraph({ source: 'replay-hands' }, registry);
  g.nodes.find((n) => n.id === 'cam')!.params = { frames: take.frames };
  const { recorder } = await runHeadless(g, registry, {
    ticks: take.frames.length,
    nominalDt: 1 / DRUM_TAKE_FPS,
    resources: {
      controls: () => ({ right: voice, left: voice, airDrum: { ...DEFAULT_AIR_DRUM, enabled: true, hand: 'right', pads, stickLength: TRUE_STICK_LENGTH } }),
      createDrumSink: () => ({ play: () => {}, close: () => {} }),
      createPluckSink: () => ({ play: () => {}, close: () => {} }),
    },
    recordOnly: ['airDrum.hits'],
  });
  const hits = (recorder.values('airDrum.hits') as DrumHit[][]).flat();
  return { score: scoreTake(hits, take.script) };
}

/** The starter kit with the kick (stacked under the snare) and the floor tom on. */
function kit(): Pads {
  const pads = starterKitPads();
  for (const id of ['p6', 'p7'] as PadId[]) pads[id] = { ...pads[id], on: true };
  return pads;
}
/** Every slot on. */
function allPads(): Pads {
  const pads = kit();
  for (const id of Object.keys(pads) as PadId[]) pads[id] = { ...pads[id], on: true };
  return pads;
}
const s = (pad: PadId, force: DrumStroke['force'] = 'hard', lift?: number): DrumStroke => ({ pad, where: 'centre', force, ...(lift !== undefined ? { lift } : {}) });
const alternate = (a: PadId, b: PadId, n = 16, stroke: (pad: PadId, k: number) => DrumStroke = (pad) => s(pad)): DrumStroke[] =>
  Array.from({ length: n }, (_, k) => stroke(k % 2 ? b : a, k));
const repeat = (pattern: DrumStroke[], n: number): DrumStroke[] => Array.from({ length: n }, (_, k) => pattern[k % pattern.length]);

interface Row {
  name: string;
  script: readonly DrumStroke[];
  options?: DrumTakeOptions;
  pads?: Pads;
}
const noisy = { noise: 0.02, seed: 3 };
const ROWS: Row[] = [
  { name: 'kick / snare alternating (stacked)', script: alternate('p1', 'p6') },
  { name: '  the same, noise 0.02', script: alternate('p1', 'p6'), options: noisy },
  { name: '  the same, noise 0.05', script: alternate('p1', 'p6'), options: { noise: 0.05, seed: 3 } },
  { name: '  soft and hard mixed', script: alternate('p1', 'p6', 16, (pad, k) => s(pad, k % 4 < 2 ? 'soft' : 'hard')) },
  { name: 'snare / kick / tom groove', script: repeat([s('p1'), s('p6'), s('p1'), s('p3')], 16) },
  { name: '  the same, noise 0.02', script: repeat([s('p1'), s('p6'), s('p1'), s('p3')], 16), options: noisy },
  { name: 'kick / snare in pairs', script: repeat([s('p6'), s('p6'), s('p1'), s('p1')], 16) },
  { name: 'tom / floor tom alternating', script: alternate('p3', 'p7') },
  { name: 'four strokes per pad (32)', script: (['p1', 'p6', 'p1', 'p7', 'p3', 'p6', 'p7', 'p5'] as PadId[]).flatMap((p) => [s(p), s(p), s(p), s(p)]) },
  { name: '  the same, noise 0.02', script: (['p1', 'p6', 'p1', 'p7', 'p3', 'p6', 'p7', 'p5'] as PadId[]).flatMap((p) => [s(p), s(p), s(p), s(p)]), options: noisy },
  { name: 'demo take (13), starter kit', script: DRUM_SCRIPT, pads: starterKitPads() },
  { name: '  the same, noise 0.02', script: DRUM_SCRIPT, pads: starterKitPads(), options: noisy },
  // #533: the review's varied lifts on the stacked pads.
  { name: '#533 snare lift 0.45 / kick 0.7', script: alternate('p1', 'p6', 16, (pad) => s(pad, 'hard', pad === 'p1' ? 0.45 : 0.7)) },
  { name: '#533 snare lift 0.5 / kick 0.7', script: alternate('p1', 'p6', 16, (pad) => s(pad, 'hard', pad === 'p1' ? 0.5 : 0.7)) },
  { name: '#533 kick kick snare, snare 0.5 or 0.9', script: Array.from({ length: 4 }, (_, k) => [s('p6'), s('p6'), s('p1', 'hard', k % 2 ? 0.9 : 0.5)]).flat().slice(0, 10) },
  { name: '#533 snare lifts 0.5..0.9 / kick 0.7', script: alternate('p1', 'p6', 16, (pad, k) => s(pad, 'hard', pad === 'p1' ? [0.5, 0.9, 0.6, 0.8][(k >> 1) % 4] : 0.7)) },
  // The #530 review: one pad played at varied heights with a stacked pad on and never struck.
  { name: 'snare only (kick on), lifts 0.7 / 0.5', script: alternate('p1', 'p1', 16, (pad, k) => s(pad, 'hard', k % 2 ? 0.5 : 0.7)) },
  { name: 'snare only (kick on), lifts 0.5..0.9', script: alternate('p1', 'p1', 16, (pad, k) => s(pad, 'hard', [0.5, 0.9, 0.6, 0.8][k % 4])) },
  { name: 'snare only (all 8 pads on), 0.7 / 0.5', script: alternate('p1', 'p1', 16, (pad, k) => s(pad, 'hard', k % 2 ? 0.5 : 0.7)), pads: allPads() },
  { name: 'kick only (snare on), lifts 0.7 / 1.0', script: alternate('p6', 'p6', 16, (pad, k) => s(pad, 'hard', k % 2 ? 1.0 : 0.7)) },
  { name: 'kick only (snare on), lifts 0.7 / 0.9', script: alternate('p6', 'p6', 16, (pad, k) => s(pad, 'hard', k % 2 ? 0.9 : 0.7)) },
  { name: 'snare soft 0.5 / hard (kick on)', script: alternate('p1', 'p1', 16, (pad, k) => (k % 2 ? s(pad, 'soft', 0.5) : s(pad))) },
  { name: 'snare soft 0.5 / kick hard', script: alternate('p1', 'p6', 16, (pad) => (pad === 'p1' ? s(pad, 'soft', 0.5) : s(pad))) },
  // The second review: the hand moving with the swing, and a lower pad reached by tilting.
  { name: 'kick only (snare on), hand raised 0.05 every 4th', script: alternate('p6', 'p6', 16, (pad, k) => ({ ...s(pad), ...(k % 4 === 3 ? { hand: -0.05 } : {}) })) },
  { name: 'kick only (snare on), hand raised 0..0.09', script: alternate('p6', 'p6', 16, (pad, k) => ({ ...s(pad), hand: -[0, 0.03, 0.06, 0.09][k % 4] })) },
  { name: 'snare only (kick on), hand raised 0..0.09', script: alternate('p1', 'p1', 16, (pad, k) => ({ ...s(pad), hand: -[0, 0.03, 0.06, 0.09][k % 4] })) },
  // The third review: a hand moved by about the pads' gap.
  { name: 'kick only (snare on), hand raised 0.07 every 4th', script: alternate('p6', 'p6', 16, (pad, k) => ({ ...s(pad), ...(k % 4 === 3 ? { hand: -0.07 } : {}) })) },
  { name: 'snare only (kick on), hand lowered 0.06 every 4th', script: alternate('p1', 'p1', 16, (pad, k) => ({ ...s(pad), ...(k % 4 === 3 ? { hand: 0.06 } : {}) })) },
  ...([[0.02, 3], [0.02, 7], [0.03, 3], [0.03, 7], [0.05, 1], [0.05, 3], [0.05, 5]] as const).map(([noise, seed]) => ({
    name: `kick by a 0.23 rad tilt / snare, noise ${noise} seed ${seed}`,
    script: alternate('p1', 'p6', 16, (pad) => ({ ...s(pad), ...(pad === 'p6' ? { tilt: 0.232 } : {}) })),
    options: { noise, seed },
  })),
  { name: 'snare / kick, no wait at the top', script: alternate('p1', 'p6', 16, (pad) => ({ ...s(pad), holdS: 0 })) },
  // #531 / #530: from a high pad down to a low one never struck.
  { name: 'crash then snare (starter kit)', script: [s('p4'), s('p4'), s('p1'), s('p1'), s('p4'), s('p1')], pads: starterKitPads() },
  { name: 'ride then floor tom', script: [s('p5'), s('p5'), s('p7'), s('p7'), s('p5'), s('p7')] },
  { name: 'crash, snare, kick, hihat, tom', script: [s('p4'), s('p1'), s('p6'), s('p2'), s('p3'), s('p4'), s('p1'), s('p6'), s('p2'), s('p3')] },
];

const showStrokes = process.argv.includes('--strokes');
const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
console.log('| take | n | on pad | first-on-pad off | predicted | missed | false | sounding MAE (ms) |');
console.log('|---|---|---|---|---|---|---|---|');
for (const row of ROWS.filter((r) => !process.env.ROW || r.name.includes(process.env.ROW))) {
  const { score } = await play(row.pads ?? kit(), { ...row.options, script: row.script });
  const struck = new Set<PadId>();
  let firstOff = 0;
  const offs: string[] = [];
  let predicted = 0;
  const errs: number[] = [];
  score.perStroke.forEach(({ stroke, hit }, k) => {
    if (hit?.pad !== stroke.pad) {
      if (!struck.has(stroke.pad)) firstOff++;
      offs.push(`${k}:${stroke.pad}->${hit?.pad ?? 'none'}`);
    }
    struck.add(stroke.pad);
    if (hit?.predicted) predicted++;
    if (hit) errs.push(Math.abs(hit.t - stroke.tLand) * 1000);
  });
  const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
  console.log(`| ${row.name} | ${row.script.length} | ${score.on} | ${firstOff} | ${predicted} | ${score.missed} | ${score.false} | ${fmt(mae)} |`);
  if (showStrokes && offs.length) console.log(`    off: ${offs.join(' ')}`);
}
