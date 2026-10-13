/**
 * Write the demo shared categorizer (#330 P5) and its index entry under `public/categorizers/`.
 * The logic is `lib_demo_categorizer.ts`. Run: `npm run faces:demo`.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SharedIndex } from '@thoremin/ext-faces/lib/shared';
import { buildDemoCategorizer, DEMO_ENTRY, indexWithDemo, SHARED_PUBLIC_DIR, toJson } from './lib_demo_categorizer';

mkdirSync(SHARED_PUBLIC_DIR, { recursive: true });
const indexPath = join(SHARED_PUBLIC_DIR, 'index.json');
const existing = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, 'utf8')) as SharedIndex) : null;
writeFileSync(join(SHARED_PUBLIC_DIR, `${DEMO_ENTRY.name}.json`), toJson(buildDemoCategorizer()));
writeFileSync(indexPath, toJson(indexWithDemo(existing)));
console.log(`wrote ${SHARED_PUBLIC_DIR}/{${DEMO_ENTRY.name},index}.json`);
