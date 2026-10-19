/**
 * The architecture ratchet's CLI (#600 S1): `npm run ratchet:arch` prints today's numbers
 * against the committed baseline; `npm run ratchet:arch -- --update` rewrites the baseline from
 * them (the five largest files are picked afresh). The test (`test/architecture_ratchet.test.ts`)
 * is the gate; this is how a PR that lowers a number records it. The measurement is
 * `scripts/lib_architecture.ts`.
 */
import { writeFileSync } from 'node:fs';
import { compareToBaseline, measureNow, readBaseline, BASELINE_FILE, type Baseline } from './lib_architecture_baseline';

const update = process.argv.includes('--update');
const baseline = readBaseline();
if (update) {
  const { numbers } = await measureNow();
  const next: Baseline = { '//': baseline['//'], ...numbers };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote ${BASELINE_FILE}`);
} else {
  const { numbers } = await measureNow(baseline);
  const { grew, shrank } = compareToBaseline(baseline, numbers);
  console.log(JSON.stringify(numbers, null, 2));
  for (const g of grew) console.log(`GREW: ${g}`);
  for (const s of shrank) console.log(`SHRANK (re-baseline with --update): ${s}`);
  if (grew.length || shrank.length) process.exit(1);
}
