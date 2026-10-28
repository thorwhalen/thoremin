/**
 * Print the physical theremin's real-hand table (`lib_theremin.ts`) at four assistance levels:
 * `npx vite-node scripts/stability/theremin.ts`. The numbers go in
 * `docs/research/theremin-physics.md` (the measurement section) and are held by
 * `test/theremin/theremin_stability.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRecords, FIXTURES } from '../../test/helpers/fixtures';
import { measureTheremin, thereminTable } from './lib_theremin';

export const THEREMIN_LEVELS = [0, 0.25, 0.5, 1] as const;

const meta = JSON.parse(readFileSync(join(FIXTURES, 'real_hands_signs', 'meta.json'), 'utf8'));
const rows = [];
for (const level of THEREMIN_LEVELS) rows.push(await measureTheremin(loadRecords, meta, level));
console.log(thereminTable(rows));
