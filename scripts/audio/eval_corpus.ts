/**
 * The sound mapper on REAL struck sounds (not run in CI): a folder of labelled one-shot WAVs
 * with a `manifest.json` (`file`, `class` per entry; the layout the foley corpus was gathered in,
 * see `docs/research/audio-trigger-latency.md`), split per class into clips to teach from and
 * clips to test on, the test clips laid end to end with tails overlapping, as a player would.
 *
 * Usage: npx vite-node scripts/audio/eval_corpus.ts -- <corpus dir> [--teach 4] [--gap 0.25] [--seed 1] [--split clips|hits]
 *
 * `--split clips` (default) teaches from some clips and tests on OTHER clips of the class: a
 * different recording, often a different object, is a much harder task than the player's (one
 * microphone, one room, one table). `--split hits` teaches from the first hits of EVERY clip and
 * tests on the later hits of the same clips: the player's situation, the same object in the
 * same room.
 *
 * Real clips carry no onset annotation, so the truth is what the onset detector finds in each
 * clip ALONE (its first onset, and any later one in a multi-hit clip), labelled with the clip's
 * class: the test then measures the classifier and the latency under overlap, not the detector's
 * placement in silence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOnsetDetector } from '@thoremin/sdk/audio/onset';
import { evaluateMapper, teachFromTake, type LabelledOnset } from '@thoremin/sdk/audio/evaluate';
import { seededRandom } from '@thoremin/sdk/audio/synthetic_taps';
import { resampleLinear } from '@thoremin/sdk/audio/examples';

const SR = 48000;
const args = process.argv.slice(2).filter((a) => a !== '--');
const dir = args[0];
if (!dir) throw new Error('usage: eval_corpus.ts <corpus dir> [--teach N] [--gap S] [--seed N] [--windows 4/12,6/0,...]');
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};
const teachN = Number(opt('teach', '4'));
const gap = Number(opt('gap', '0.25'));
const rand = seededRandom(Number(opt('seed', '1')));
const windows = opt('windows', '2/0,3/0,4/0,6/0,8/0,12/0,20/0,4/12,4/20').split(',').map((w) => w.split('/').map(Number));

/** A 16-bit or float PCM WAV, mixed to mono, at SR. */
function readWav(path: string): Float32Array {
  const b = readFileSync(path);
  let p = 12;
  let fmt = { channels: 1, rate: SR, bits: 16, format: 1 };
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(p + 8), channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') {
      const bytes = fmt.bits / 8;
      const n = Math.floor(size / (bytes * fmt.channels));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const at = p + 8 + (i * fmt.channels + c) * bytes;
          s += fmt.format === 3 ? b.readFloatLE(at) : fmt.bits === 16 ? b.readInt16LE(at) / 32768 : b.readInt32LE(at) / 2147483648;
        }
        out[i] = s / fmt.channels;
      }
      return resampleLinear(out, fmt.rate, SR);
    }
    p += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${path}`);
}

function onsetsAlone(pcm: Float32Array): number[] {
  const d = createOnsetDetector({ sampleRate: SR });
  const lead = new Float32Array(SR / 4); // the detector learns the room on silence first
  const out: number[] = [];
  d.push(lead, 0, () => undefined);
  d.push(pcm, lead.length, (o) => out.push(o.frame - lead.length));
  return out;
}

interface Clip { label: string; pcm: Float32Array; onsets: number[] }
const manifest: { file: string; class: string; set?: string }[] = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const clips: Clip[] = manifest
  .filter((m) => (m.set ?? 'taps') === 'taps')
  .map((m) => {
    const pcm = readWav(join(dir, m.file));
    return { label: m.class, pcm, onsets: onsetsAlone(pcm) };
  })
  .filter((c) => c.onsets.length > 0);

function take(cs: Clip[], spacing: number) {
  const parts = cs.map((c) => c.pcm.subarray(0, Math.min(c.pcm.length, Math.round(1.5 * SR))));
  let t = SR / 2;
  const onsets: LabelledOnset[] = [];
  const at: number[] = [];
  for (let k = 0; k < cs.length; k++) {
    at.push(t);
    for (const o of cs[k].onsets) if (o < parts[k].length) onsets.push({ frame: t + o, label: cs[k].label });
    const last = cs[k].onsets[cs[k].onsets.length - 1];
    t += Math.max(last + Math.round(0.08 * SR), Math.round(spacing * SR * (0.6 + 0.8 * rand())));
  }
  const pcm = new Float32Array(t + 2 * SR);
  parts.forEach((p, k) => p.forEach((x, i) => (pcm[at[k] + i] += x)));
  for (let i = 0; i < pcm.length; i++) pcm[i] += 0.0005 * (2 * rand() - 1);
  return { sampleRate: SR, pcm, onsets };
}

const split = opt('split', 'clips');
const byLabel = new Map<string, Clip[]>();
for (const c of clips) byLabel.set(c.label, [...(byLabel.get(c.label) ?? []), c]);
const teachClips: Clip[] = [];
const testClips: Clip[] = [];
/** A clip cut at a sample: the hits before it, and the hits from it on. */
const cut = (c: Clip, at: number): [Clip, Clip] => [
  { label: c.label, pcm: c.pcm.subarray(0, at), onsets: c.onsets.filter((o) => o < at) },
  { label: c.label, pcm: c.pcm.subarray(at), onsets: c.onsets.filter((o) => o >= at).map((o) => o - at) },
];
if (split === 'hits') {
  for (const c of clips) {
    if (c.onsets.length < 2) continue;
    const k = Math.max(1, Math.floor(c.onsets.length / 2));
    const [a, b] = cut(c, c.onsets[k] - Math.round(0.002 * SR));
    teachClips.push(a);
    testClips.push(b);
  }
  console.log(`split by hits: ${teachClips.length} clips with two or more hits`);
}
else for (const [label, cs] of byLabel) {
  const shuffled = [...cs].sort(() => rand() - 0.5);
  teachClips.push(...shuffled.slice(0, teachN));
  testClips.push(...shuffled.slice(teachN));
  console.log(`${label}: ${cs.length} clips (${cs.reduce((n, c) => n + c.onsets.length, 0)} onsets), teach ${Math.min(teachN, cs.length)}`);
}
const teach = teachFromTake(take(teachClips, 1.0));
const order = [...testClips].sort(() => rand() - 0.5);
const test = take(order, gap);
console.log(`taught ${teach.length} snippets; test ${test.onsets.length} onsets`);
console.log('fast/refine ms | detected | false | fast acc | final acc | revised | heard p50/p95 ms | quantum p50/p99 us');
for (const [w, r] of windows) {
  const rep = evaluateMapper(teach, test, { windowMs: w, refineMs: r });
  console.log(`${w}/${r} | ${rep.detected}/${rep.taps} | ${rep.falseOnsets} | ${rep.fastAccuracy.toFixed(3)} | ${rep.finalAccuracy.toFixed(3)} | ${rep.revised} | ${rep.heardMs.p50.toFixed(2)}/${rep.heardMs.p95.toFixed(2)} | ${rep.quantumUs.p50.toFixed(1)}/${rep.quantumUs.p99.toFixed(1)}`);
  if (w === 4 && r === 12) console.log('confusion (final):', JSON.stringify(rep.confusion));
}
