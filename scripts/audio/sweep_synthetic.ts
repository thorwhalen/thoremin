/**
 * The sound mapper's window trade-off on synthetic taps: accuracy of the fast and the final
 * decision, and the heard latency, for each fast/refining window pair
 * (`docs/research/audio-trigger-latency.md` §4). Deterministic (seeded takes), no hardware.
 *
 * Usage: npx vite-node scripts/audio/sweep_synthetic.ts [-- --teach 8]
 */
import { synthTake, type Take } from '@thoremin/sdk/audio/synthetic_taps';
import { evaluateMapper, teachFromTake, type LabelledTake } from '@thoremin/sdk/audio/evaluate';

const SR = 48000;
const args = process.argv.slice(2).filter((a) => a !== '--');
const teachN = Number(args[args.indexOf('--teach') + 1] ?? 8) || 8;
const labelled = (t: Take): LabelledTake => ({ sampleRate: t.sampleRate, pcm: t.pcm, onsets: t.taps.map((x) => ({ frame: x.frame, label: x.surface })) });
const teach = teachFromTake(labelled(synthTake({ sampleRate: SR, seed: 1, perSurface: teachN, gapMin: 0.5, gapMax: 0.8 })));
const test = labelled(synthTake({ sampleRate: SR, seed: 7, perSurface: 40 }));
console.log(`taught ${teach.length} taps (${teachN} per surface); test ${test.onsets.length} taps\n`);
console.log('| fast / refine (ms) | detected | fast accuracy | final accuracy | revised | heard p50 / p95 (ms) | quantum p50 / p99 (us) |');
console.log('|---|---|---|---|---|---|---|');
for (const [w, r] of [[2, 0], [3, 0], [4, 0], [6, 0], [8, 0], [12, 0], [20, 0], [3, 12], [4, 12], [4, 20]]) {
  const rep = evaluateMapper(teach, test, { windowMs: w, refineMs: r });
  console.log(`| ${w} / ${r || '-'} | ${rep.detected}/${rep.taps} | ${rep.fastAccuracy.toFixed(3)} | ${rep.finalAccuracy.toFixed(3)} | ${rep.revised} | ${rep.heardMs.p50.toFixed(2)} / ${rep.heardMs.p95.toFixed(2)} | ${rep.quantumUs.p50.toFixed(1)} / ${rep.quantumUs.p99.toFixed(1)} |`);
}
