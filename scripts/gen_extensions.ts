/**
 * Generate the typed declaration of the extension list (`src/extensions/virtual.d.ts`) from
 * `extensions.json`, or from the file `THOREMIN_EXTENSIONS` names, and the core-alone one
 * (`extensions.core.d.ts`, from `extensions.core.json`, read by `tsconfig.core.json`). The
 * settings type is computed from them, so run this after changing a manifest (a test fails if
 * either is stale).
 *
 *   npm run extensions
 *   THOREMIN_EXTENSIONS=other.json npm run extensions   # then typecheck against that set
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CORE_DECLARATION_FILE, CORE_MANIFEST, DECLARATION_FILE, declarationSource, readExtensionEntries } from '../vite.extensions';

function generate(manifest: string, out: string): void {
  const source = declarationSource(readExtensionEntries(manifest), manifest);
  let current = '';
  try {
    current = readFileSync(out, 'utf8');
  } catch {
    // first generation
  }
  if (current === source) {
    console.log(`${out} is up to date with ${manifest}`);
  } else {
    writeFileSync(out, source);
    console.log(`wrote ${out} from ${manifest}`);
  }
}

generate(process.env.THOREMIN_EXTENSIONS ?? 'extensions.json', DECLARATION_FILE);
generate(CORE_MANIFEST, CORE_DECLARATION_FILE);
