/**
 * Time the stages of a large categorizer (#587), to say where MAX_CATEGORIZER_SAMPLES may sit.
 * Timings vary with the machine and its load: compare stages, and run twice.
 * The forest build and the merge run in a worker in the tool (#587), so the bound is the slowest of the other stages.
 * Usage: `npx tsx scripts/bench_categorizer_size.ts [n ...]` (default 2000 3000 5000).
 * The categorizer is synthetic: `FEATURES` features, `CATS` clusters, a third of the holds
 * set aside or Neutral (the worst case for the saved view), a few pins.
 */
import { CATEGORIZER_FORMAT, CATEGORIZER_VERSION, PersonalCategorizerSchema, exportCategorizer, modelFromCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { recut, recutRange, medoidOf, setStrangers } from '@thoremin/sdk/enroll/sorting';
import { carveQuality } from '@thoremin/sdk/enroll/quality';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';

const FEATURES = 52; // the face model's blendshapes
const CATS = 6;
const PER_MERGE = 40;
const sizes = process.argv.slice(2).map(Number).filter(Boolean);

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function make(total: number): PersonalCategorizer {
  const r = rng(7);
  const features = Array.from({ length: FEATURES }, (_, i) => `f${i}`);
  const centres = Array.from({ length: CATS }, () => features.map(() => r()));
  const samples = Array.from({ length: total }, (_, i) => {
    const c = centres[i % CATS];
    return { id: `s-${i}`, vector: Object.fromEntries(features.map((f, j) => [f, c[j] + (r() - 0.5) * 0.1])), t: i, cue: 'faces' };
  });
  const third = Math.floor(total / 3);
  const kept = samples.slice(0, total - third);
  const categories = Array.from({ length: CATS }, (_, k) => ({ id: `cat-${k + 1}`, label: `c${k + 1}`, members: kept.filter((_, i) => i % CATS === k).map((s) => s.id) }));
  const rest = samples.slice(total - third);
  return {
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    neutralTrained: true,
    name: 'bench',
    features,
    weights: Object.fromEntries(features.map((f) => [f, 1])),
    strangers: 'neutral',
    rejectRadius: 1,
    samples,
    categories,
    neutral: rest.slice(0, third >> 1).map((s) => s.id),
    aside: rest.slice(third >> 1).map((s) => s.id),
    pins: Object.fromEntries(categories.flatMap((c) => c.members.slice(0, 2).map((m) => [m, c.id]))),
  } as PersonalCategorizer;
}

function time<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const out = fn();
  console.log(`  ${label.padEnd(34)} ${(performance.now() - t0).toFixed(0).padStart(7)} ms`);
  return out;
}

for (const n of sizes.length ? sizes : [2000, 3000, 5000]) {
  console.log(`n = ${n}`);
  const c = make(n);
  const text = exportCategorizer(c);
  // The schema alone: `importCategorizer` refuses past the bound this script helps to set.
  const back = time('parse + validate (schema)', () => PersonalCategorizerSchema.parse(JSON.parse(text)));
  const model = time('modelFromCategorizer', () => modelFromCategorizer(back));
  time('medoidOf (one category)', () => medoidOf(back, 'cat-1'));
  time('carveQuality', () => carveQuality(model, back.samples.map((s) => s.vector)));
  time('recutRange (forest build)', () => recutRange(back));
  time('recut k=8 (cached forest)', () => recut(back, 8));
  time('setStrangers', () => setStrangers(back, 'nearest'));
  const points = back.samples.slice(0, PER_MERGE).map((s, i) => ({ id: `new-${i}`, vector: s.vector, t: n + i, cue: 'faces' }));
  time(`mergeSession (+${PER_MERGE})`, () => mergeSession(back, points));
}
