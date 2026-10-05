/**
 * Generate the typed declaration of the extension list (`src/extensions/virtual.d.ts`) from
 * `extensions.json`, or from the file `THOREMIN_EXTENSIONS` names. The settings type is
 * computed from it, so run this after changing the manifest (a test fails if it is stale).
 *
 *   npm run extensions
 *   THOREMIN_EXTENSIONS=extensions.core.json npm run extensions   # typecheck core alone
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DECLARATION_FILE, declarationSource, readExtensionEntries } from '../vite.extensions';

const manifest = process.env.THOREMIN_EXTENSIONS ?? 'extensions.json';
const source = declarationSource(readExtensionEntries(manifest), manifest);
let current = '';
try {
  current = readFileSync(DECLARATION_FILE, 'utf8');
} catch {
  // first generation
}
if (current === source) {
  console.log(`${DECLARATION_FILE} is up to date with ${manifest}`);
} else {
  writeFileSync(DECLARATION_FILE, source);
  console.log(`wrote ${DECLARATION_FILE} from ${manifest}`);
}
