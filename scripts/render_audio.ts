/**
 * Offline synth renderer CLI — turn a recorded `SynthParams` stream into an
 * audible WAV (no browser). The DSP lives in `lib_audio.ts` (imported by tests);
 * this is the thin command-line entry.
 *
 * Usage: vite-node scripts/render_audio.ts <map.params.ndjson> <out.wav> [fps]
 */
import { readFileSync } from 'node:fs';
import { parseRecords } from '@/dag';
import type { SynthParams } from '@/nodes';
import { render, writeWav, rms, SR } from './lib_audio';

const [src, out, fpsArg] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: render_audio.ts <map.params.ndjson> <out.wav> [fps]');
  process.exit(1);
}
const records = parseRecords(readFileSync(src, 'utf8'));
const frames = records.map((r) => r.value) as SynthParams[];
const dt =
  records.length > 1 && records[1].t > records[0].t
    ? records[1].t - records[0].t
    : 1 / (fpsArg ? Number(fpsArg) : 30);
const samples = render(frames, dt);
writeWav(out, samples);
console.log(
  `rendered ${frames.length} frames @ dt=${dt.toFixed(4)}s -> ${out} (${(samples.length / SR).toFixed(1)}s, rms=${rms(samples).toFixed(4)})`,
);
