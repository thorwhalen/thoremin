/**
 * The #239 acceptance table: the lag-gated magnet (timing plan step 3) across pipeline
 * delays and followers, on the demo clips.
 *
 * For each clip, follower and delay, the node runs at magnetism 0 and at `--magnetism`
 * (0.5), and the table prints intent MAE (ear time against the intended beat) and
 * actuality MAE (against the true impact) for both, the grid's lag the node measured,
 * and every magnet standing the status reported. The acceptance: on the conductor
 * follower, intent with the magnet no worse than without at every delay and actuality
 * within 2 ms; the trend and oracle followers bound it; at the long delays the status
 * says the pipeline is too slow.
 *
 * Usage:
 *   npx vite-node scripts/demos/magnet_sweep.ts <clip-dir>... \
 *     [--delays 0,0.027,0.04,0.15,0.25] [--followers conductor,trend,oracle] \
 *     [--magnetism 0.5] [--output-stage 0] [--prior blend]
 */
import type { RhythmPriorKind } from '@thoremin/ictus';
import { loadClip, runClip, score, type Follower } from './lib_air_drum_hits';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flags = new Set(['--delays', '--followers', '--magnetism', '--output-stage', '--prior']);
const clips = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !flags.has(all[i - 1] ?? ''));
const delays = arg('delays', '0,0.027,0.04,0.15,0.25').split(',').map(Number);
const followers = arg('followers', 'conductor,trend,oracle').split(',') as Follower[];
const magnetism = Number(arg('magnetism', '0.5'));
const outputStage = Number(arg('output-stage', '0'));
const prior = process.argv.includes('--prior') ? (arg('prior', 'blend') as RhythmPriorKind) : undefined;

const ms = (x: number) => (Number.isFinite(x) ? (1000 * x).toFixed(1) : '-');
console.log(`magnetism ${magnetism}, output stage ${ms(outputStage)} ms${prior ? `, prior ${prior}` : ''}`);
console.log('| clip | follower | delay ms | intent m=0 | intent m | actuality m=0 | actuality m | on time m=0 / m | lag ms | gate | magnet |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const dir of clips) {
  const clip = loadClip(dir);
  const kind = clip.truth.spec.kind;
  for (const follower of followers) {
    for (const latency of delays) {
      const base = { latency, outputStage, follower, prior };
      const r0 = runClip(clip, { ...base, magnetism: 0 });
      const r1 = runClip(clip, { ...base, magnetism });
      const s0 = score(clip, r0);
      const s1 = score(clip, r1);
      console.log(`| ${kind} | ${follower} | ${ms(latency)} | ${ms(s0.intentMae)} | ${ms(s1.intentMae)} | ${ms(s0.actualityMae)} | ${ms(s1.actualityMae)} | ${s0.onTime}/${s0.hits} · ${s1.onTime}/${s1.hits} | ${ms(r1.lag)} | ${r1.status.magnetGate.toFixed(2)} | ${[...r1.magnetStandings].filter((m) => m !== 'off').join(' ')} |`);
    }
  }
}
