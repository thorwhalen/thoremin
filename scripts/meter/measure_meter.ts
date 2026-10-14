/**
 * Can the conductor's HAND pattern say 2, 3 or 4? (#187 PR 6, measured, not shipped.)
 *
 * For each committed conducting clip this runs ictus's stroke follower, gives every
 * accepted stroke an integer beat index (gaps in the median gap; a stroke closer than 0.55
 * of it is a rebound and dropped, one 1.6+ gaps away is a missed beat), and fits "one
 * strong stroke every N" to the stroke feature: the share of its variance (R^2) that the
 * split {k = p (mod N)} vs the rest explains, best phase p, with the strong class the
 * stronger one. It prints R^2 per N, whether the best N is the clip's, and the 95th
 * percentile of the same best-of-N fit on 400 shuffles of the same strokes (what chance
 * gives with this few strokes).
 *
 * Features: `strength` (the stroke's excursion over the player's envelope: the downbeat is
 * the biggest stroke) and `vertical` (1 / (1 + 3 |lateral|): the plan's "most vertical
 * approach"). Sources: `conducting_{44,34,24}` (hand tracker, one video, hands tracked by
 * continuity) and `video_body_conducting_{44,34,24}` (pose tracker's wrists, a different
 * video: right = the baton hand, left = the other).
 *
 * Usage: npx vite-node scripts/meter/measure_meter.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIctus, type Anchor, type Sample } from '@thoremin/ictus';
import { FIXTURES } from '../body/lib_clips';
import { loadStream } from '../../test/helpers/fixtures';

const TRUTH: Record<string, number> = { '44': 4, '34': 3, '24': 2 };
const CANDIDATES = [2, 3, 4];
const SHUFFLES = 400;
const REBOUND = 0.55;
const MISSED = 1.6;
const STRENGTH_CAP = 2;

const fpsOf = (sc: string) => (JSON.parse(readFileSync(join(FIXTURES, sc, 'meta.json'), 'utf8')) as { fps: number }).fps;

function handSamples(sc: string): Sample[] {
  const out: Sample[] = [];
  (loadStream(sc, 'src.hands') as any[]).forEach((f, i) => {
    if (!f.hands.length) return;
    const c = f.hands.map((h: any) => ({ x: h.keypoints[0].x / f.height, y: h.keypoints[0].y / f.height }));
    const l = out[out.length - 1];
    const w = l ? c.reduce((b: any, d: any) => (Math.hypot(d.x - l.x, d.y - l.y) < Math.hypot(b.x - l.x, b.y - l.y) ? d : b)) : c[0];
    out.push({ t: i / fpsOf(sc), x: w.x, y: w.y });
  });
  return out;
}

function poseSamples(sc: string, landmark: number): Sample[] {
  const out: Sample[] = [];
  (loadStream(sc, 'camBody.body') as any[]).forEach((f, i) => {
    if (!f.present) return;
    const p = f.landmarks[landmark];
    out.push({ t: i / fpsOf(sc), x: p.x / f.height, y: p.y / f.height });
  });
  return out;
}

interface Stroke { k: number; a: Anchor }

/** Anchors -> strokes with a beat index (first anchor dropped: the envelope is not yet the player's). */
function strokes(samples: Sample[]): Stroke[] {
  const ictus = createIctus();
  const out: Stroke[] = [];
  const gaps: number[] = [];
  let k = 0;
  let lastT = NaN;
  let seen = 0;
  for (const s of samples) {
    const a = ictus.feed(s).anchor;
    if (!a) continue;
    if (Number.isFinite(lastT)) {
      const gap = a.t - lastT;
      const med = gaps.length < 3 ? ictus.state().period : [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)];
      const spans = gap / med;
      if (spans < REBOUND) continue;
      const beats = spans >= MISSED ? Math.max(2, Math.round(spans)) : 1;
      gaps.push(gap / beats);
      if (gaps.length > 8) gaps.shift();
      k += beats;
    }
    lastT = a.t;
    if (++seen > 1) out.push({ k, a });
  }
  return out;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** R^2 of the best "strong every n" split. */
function fit(ks: number[], ss: number[], n: number): number {
  const m = ss.reduce((x, y) => x + y, 0) / ss.length;
  const total = ss.reduce((x, y) => x + (y - m) ** 2, 0);
  if (total < 1e-12) return 0;
  let best = 0;
  for (let p = 0; p < n; p++) {
    const inn = ss.filter((_, i) => mod(ks[i], n) === p);
    const out = ss.filter((_, i) => mod(ks[i], n) !== p);
    if (!inn.length || !out.length) continue;
    const mi = inn.reduce((x, y) => x + y, 0) / inn.length;
    const mo = out.reduce((x, y) => x + y, 0) / out.length;
    if (mi < mo) continue;
    best = Math.max(best, (inn.length * (mi - m) ** 2 + out.length * (mo - m) ** 2) / total);
  }
  return best;
}

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function chance95(ks: number[], ss: number[]): number {
  const maxes: number[] = [];
  for (let r = 0; r < SHUFFLES; r++) {
    const sh = [...ss];
    for (let i = sh.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [sh[i], sh[j]] = [sh[j], sh[i]];
    }
    maxes.push(Math.max(...CANDIDATES.map((n) => fit(ks, sh, n))));
  }
  return maxes.sort((x, y) => x - y)[Math.floor(0.95 * SHUFFLES)];
}

const FEATURES: Record<string, (a: Anchor) => number> = {
  strength: (a) => Math.min(STRENGTH_CAP, a.strength),
  vertical: (a) => 1 / (1 + 3 * Math.abs(a.lateral)),
};

const rows = ['| source | clip | feature | strokes | R2 N=2 | N=3 | N=4 | best N | truth | chance 95% | beats chance |', '|---|---|---|---|---|---|---|---|---|---|---|'];
const tally: Record<string, [number, number]> = {};
for (const k of Object.keys(TRUTH)) {
  const jobs: [string, string, Sample[]][] = [
    ['hand tracker', `conducting_${k}`, handSamples(`conducting_${k}`)],
    ['pose, baton wrist', `video_body_conducting_${k}`, poseSamples(`video_body_conducting_${k}`, 16)],
    ['pose, other wrist', `video_body_conducting_${k}`, poseSamples(`video_body_conducting_${k}`, 15)],
  ];
  for (const [src, sc, samples] of jobs) {
    const st = strokes(samples);
    const ks = st.map((s) => s.k);
    for (const [fname, f] of Object.entries(FEATURES)) {
      const ss = st.map((s) => f(s.a));
      const fits = CANDIDATES.map((n) => fit(ks, ss, n));
      const bi = fits.indexOf(Math.max(...fits));
      const chance = chance95(ks, ss);
      const right = CANDIDATES[bi] === TRUTH[k];
      const real = right && fits[bi] > chance;
      const key = `${src} / ${fname}`;
      tally[key] = [(tally[key]?.[0] ?? 0) + (real ? 1 : 0), (tally[key]?.[1] ?? 0) + 1];
      rows.push(`| ${src} | ${sc} | ${fname} | ${st.length} | ${fits.map((x) => x.toFixed(2)).join(' | ')} | ${CANDIDATES[bi]} | ${TRUTH[k]} | ${chance.toFixed(2)} | ${real ? 'yes' : 'no'} |`);
    }
  }
}
console.log(rows.join('\n'));
console.log('\nclips classified correctly AND above chance:');
for (const [key, [ok, n]] of Object.entries(tally)) console.log(`  ${key}: ${ok}/${n}`);
