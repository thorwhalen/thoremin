/**
 * The hits the shipped `air-drum` node (#233) plays over one `an.impacts` clip, for
 * the demo page. The engine (the clip loader, the simulated pipeline and the beat
 * followers) is `lib_air_drum_hits.ts`; this is its one-run CLI.
 *
 * - `--latency S`: the pipeline delay from capture to tick (inference, scheduling).
 *   Each frame carries its capture stamp and the node sees it `S` seconds later, so the
 *   node's lead is counted from its decision, exactly as live (#226).
 * - `--output-stage S`: the audio output stage the node is told (its `timing` resource):
 *   a hit is `predicted` only if its lead covers it, and no sound reaches the ear before
 *   the decision plus it. Default 0; the measured Chromium value is 0.032.
 * - `--magnetism M`: the pull toward the beat of `--follower` (`trend` by default: the
 *   trend prior hearing the strokes' impacts; `conductor` is what the app wires; see the
 *   library for the others), `--prior` the conductor's rhythm prior.
 * - `--min-lead S`: the node's dial (default the dial's 50 ms).
 *
 * Writes JSON in the `impact_onsets.ts` shape, `onsets[<name>]` = the hits, and prints
 * how many were on time and their errors against the true impacts and intended beats.
 *
 * Usage:
 *   npx vite-node scripts/demos/air_drum_hits.ts <clip-dir> <out.json> \
 *     [--name drum] [--latency 0] [--output-stage 0] [--magnetism 0] [--min-lead 0.05] \
 *     [--follower trend] [--prior blend] [--merge]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RhythmPriorKind } from '@thoremin/ictus';
import { FOLLOWERS, loadClip, runClip, score, type Follower } from './lib_air_drum_hits';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const [clipDir, out] = process.argv.slice(2);
if (!clipDir || !out) throw new Error('usage: air_drum_hits.ts <clip-dir> <out.json>');
const name = arg('name', 'drum');
const follower = arg('follower', 'trend') as Follower;
if (!FOLLOWERS.includes(follower)) throw new Error(`--follower must be one of ${FOLLOWERS.join(', ')}`);
const settings = {
  latency: Number(arg('latency', '0')),
  magnetism: Number(arg('magnetism', '0')),
  minLead: Number(arg('min-lead', '0.05')),
  outputStage: Number(arg('output-stage', '0')),
  follower,
  prior: process.argv.includes('--prior') ? (arg('prior', 'blend') as RhythmPriorKind) : undefined,
};

const clip = loadClip(clipDir);
const run = runClip(clip, settings);
const s = score(clip, run);

const doc = existsSync(out) && process.argv.includes('--merge') ? JSON.parse(readFileSync(out, 'utf8')) : { clip: clipDir.split('/').filter(Boolean).pop(), fps: clip.truth.spec.fps, kind: clip.truth.spec.kind, events: clip.truth.events, onsets: {}, settings: {} };
doc.onsets[name] = run.hits.map((h) => ({ t: h.ear, at: h.at, impactT: h.impactT, predicted: h.predicted, onTime: h.onTime, lead: h.lead, lateBy: h.lateBy, velocity: h.velocity, pull: h.pull }));
doc.settings[name] = settings;
writeFileSync(out, JSON.stringify(doc, null, 1));

const ms = (x: number) => (1000 * x).toFixed(1);
console.log(
  `${name}: ${s.hits}/${s.events} hits, ${s.onTime} on time | actuality MAE ${ms(s.actualityMae)} | intent MAE ${ms(s.intentMae)} | mean |pull| ${ms(s.meanPull)} | lag ${ms(run.lag)} | magnet ${[...run.magnetStandings].join('/')}`,
);
