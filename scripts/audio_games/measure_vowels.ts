/**
 * Score the vowel cursor on sung recordings (the scorer and its terms: `lib_vowels.ts`).
 *
 *   npx vite-node scripts/audio_games/measure_vowels.ts -- <wav>... [--json]
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseWav } from '../cue/lib_pair_take';
import { calibrateFrom, scoreVowel, type VowelScore } from './lib_vowels';
import type { VoiceMap } from '@thoremin/games/vowels';

const argv = process.argv.slice(2).filter((a) => a !== '--');
main();

function main(): void {
  const json = argv.includes('--json');
  const files = argv.filter((a, i) => !a.startsWith('--') && !/^--(median|cutoff|beta)$/.test(argv[i - 1] ?? ''));
  // --calibrate: each singer (the file name's prefix before the first `_`) calibrated on their
  // `scales` takes of a, i and u, then every one of their files scored through that calibration.
  const calibrate = argv.includes('--calibrate');
  const label = (path: string) => /_([aeiou])\.wav$/.exec(basename(path))?.[1] ?? '?';
  const singer = (path: string) => basename(path).replace(/^.*__/, '').split('_')[0];
  const maps = new Map<string, VoiceMap>();
  if (calibrate) {
    for (const s of new Set(files.map(singer))) {
      const recs: Record<string, { pcm: Float32Array; sampleRate: number }> = {};
      for (const path of files.filter((f) => singer(f) === s && /scales/.test(f))) recs[label(path)] = parseWav(new Uint8Array(readFileSync(path)));
      maps.set(s, calibrateFrom(recs));
    }
  }
  const rows = files.map((path) => {
    const w = parseWav(new Uint8Array(readFileSync(path)));
    return scoreVowel(w.pcm, w.sampleRate, label(path), { calibration: maps.get(singer(path)), ...tuning() }, basename(path));
  });
  if (json) {
    console.log(JSON.stringify(rows, null, 1));
    return;
  }
  const f = (x: number, d = 2) => x.toFixed(d);
  for (const r of rows) console.log(`${r.file.padEnd(48)} ${r.vowel}  on ${f(r.on)}  step ${f(r.stepMedian, 3)} / ${f(r.stepP90, 3)}  live ${f(r.live)}`);
  const mean = (k: keyof VowelScore) => rows.reduce((s, r) => s + (r[k] as number), 0) / rows.length;
  console.log(`MEAN${' '.repeat(47)}on ${f(mean('on'))}  step ${f(mean('stepMedian'), 3)} / ${f(mean('stepP90'), 3)}  live ${f(mean('live'))}`);
}

/** `--median N --cutoff HZ --beta B`: the cursor's smoothing, for a sweep. */
function tuning() {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? Number(argv[i + 1]) : undefined;
  };
  const median = arg('--median');
  const cutoff = arg('--cutoff');
  const beta = arg('--beta');
  return { ...(median ? { medianOf: median } : {}), ...(cutoff || beta ? { smooth: { minCutoff: cutoff ?? 1.2, beta: beta ?? 0.8 } } : {}) };
}
