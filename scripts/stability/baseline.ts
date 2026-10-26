/**
 * The stability baseline: every instrument of the suite on every stream it is played on, measured,
 * as one table. Prints Markdown; with `--update` it writes the numbers to
 * `docs/testing/data/stability-baseline.json` (what `test/stability/stability.test.ts` ratchets
 * against) and the table into `docs/testing/stability.md` between its markers.
 *
 * Usage: npm run stability [-- --update] [--only "Chord Map"]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTENSIONS, loadExtensionNodes } from '@/extensions';
import { loadRecords, FIXTURES } from '../../test/helpers/fixtures';
import { INSTRUMENTS, measure, type CaseResult } from './suite';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export const BASELINE = join('docs', 'testing', 'data', 'stability-baseline.json');
const DOC = join('docs', 'testing', 'stability.md');
const TABLE_START = '<!-- stability:table -->';
const TABLE_END = '<!-- /stability:table -->';

const f1 = (x: number | null | undefined) => (x === null || x === undefined ? '-' : x.toFixed(x < 10 ? 2 : 0));

export function table(results: readonly CaseResult[]): string {
  const rows = [
    '| Instrument | Stream | Sounding s | Changes / held s | Flickers / min | Short chords | Entry flickers | Chords with no hand | Latency median (p90) ms | Missed | Sound blips |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    const l = r.chord.latency;
    rows.push(
      `| ${r.instrument} | ${r.stream} | ${r.chord.soundingS.toFixed(1)} | ${f1(r.chord.changesPerHeldS)} | ${f1(r.chord.flickersPerMin)} | ${r.chord.shortChords} | ${r.chord.entryFlickers} | ${r.chord.spuriousNoHand} | ${l ? `${f1(l.medianMs)} (${f1(l.p90Ms)})` : '-'} | ${l ? `${l.missed}/${l.n}` : '-'} | ${r.heard.blips} |`,
    );
  }
  return rows.join('\n');
}

async function main(): Promise<void> {
  await Promise.all(EXTENSIONS.map((e) => loadExtensionNodes(e)));
  const meta = JSON.parse(readFileSync(join(FIXTURES, 'real_hands_signs', 'meta.json'), 'utf8'));
  const only = arg('--only');
  const results: CaseResult[] = [];
  for (const [instrument, streams] of Object.entries(INSTRUMENTS)) {
    if (only && instrument !== only) continue;
    for (const stream of streams) {
      const { run: _run, timeline: _tl, ...r } = await measure(loadRecords, meta, instrument, stream);
      results.push(r);
      console.error(`${instrument} / ${stream}: done`);
    }
  }
  const md = table(results);
  console.log(md);
  if (process.argv.includes('--update')) {
    if (only) throw new Error('--update writes the whole baseline: run it without --only');
    writeFileSync(BASELINE, JSON.stringify(results, null, 2) + '\n');
    const doc = readFileSync(DOC, 'utf8');
    const start = doc.indexOf(TABLE_START);
    const end = doc.indexOf(TABLE_END);
    if (start < 0 || end < start) throw new Error(`${DOC} has no ${TABLE_START} ... ${TABLE_END} markers`);
    writeFileSync(DOC, doc.slice(0, start + TABLE_START.length) + '\n' + md + '\n' + doc.slice(end));
    console.error(`wrote ${BASELINE} and the table in ${DOC}`);
  }
}

void main();
