/**
 * Measure instruments on whole recorded clips kept OUTSIDE the repository (the app-data dir's
 * landmark streams): the long takes a fix is judged on before it is held by the committed suite.
 * Prints one row per clip and instrument; nothing is written. The streams stay where they are,
 * only the numbers may be quoted.
 *
 * Usage: npx vite-node scripts/stability/eval_clips.ts -- --instrument "Chord Map" [--instrument ...] <hands.ndjson.gz> ...
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseRecords } from '@thoremin/dag';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { EXTENSIONS, loadExtensionNodes } from '@/extensions';
import { runSeed } from './lib_run';
import { resample, handTrack, palmCentre } from './lib_streams';
import { heldFromMotion, stabilityMetrics } from './lib_metrics';
import { HELD_SPEED } from './suite';

async function main(): Promise<void> {
  await Promise.all(EXTENSIONS.map((e) => loadExtensionNodes(e)));
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const instruments: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--instrument') instruments.push(args[++i]);
    else files.push(args[i]);
  }
  console.log('| Clip | Instrument | s | Sounding s | Changes / held s | Flickers / min | Short chords | Sound blips | Two hands, one label |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const file of files) {
    const frames: HandsFrame[] = resample(parseRecords(gunzipSync(readFileSync(file)).toString('utf8')), 30);
    const t = frames.map((_, i) => i / 30);
    const heldBy = (label: 'Left' | 'Right') =>
      heldFromMotion(t, handTrack(frames, label).map((h, i) => (h ? { x: palmCentre(h).x / frames[i].width, y: palmCentre(h).y / frames[i].height } : null)), { maxSpeed: HELD_SPEED });
    const [l, r] = [heldBy('Left'), heldBy('Right')];
    const held = frames.map((f, i) => f.hands.length > 0 && f.hands.every((h) => (h.handedness === 'Left' ? l[i] : r[i])));
    const hand = frames.map((f) => f.hands.length > 0);
    const dup = frames.filter((f) => f.hands.length === 2 && f.hands[0].handedness === f.hands[1].handedness).length;
    for (const instrument of instruments) {
      const run = await runSeed(instrument, frames);
      const m = stabilityMetrics({ t: run.t, out: run.chord, hand, held });
      const h = stabilityMetrics({ t: run.t, out: run.heard, hand, held });
      console.log(`| ${basename(file).split('.')[0]} | ${instrument} | ${(frames.length / 30).toFixed(0)} | ${m.soundingS.toFixed(1)} | ${m.changesPerHeldS.toFixed(2)} | ${m.flickersPerMin.toFixed(1)} | ${m.shortChords} | ${h.blips} | ${dup} |`);
    }
  }
}

void main();
