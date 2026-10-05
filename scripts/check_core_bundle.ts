/**
 * Core alone ships no extension code: build the app from `extensions.core.json` (no
 * extensions) into a temporary directory and fail if
 *
 *  1. any module under `src/extensions/` other than the list module is in the build's module
 *     graph (read from the bundle itself, so a core file importing an extension's library
 *     helper is caught even when nothing of it survives as a string), or
 *  2. any node type, branch id or dial kind of a shipped extension appears in the JS (a copy
 *     of an extension's identifiers living in core).
 *
 * The type-level half of the guard is `npm run typecheck:core`; the runtime half is the test
 * suite run with the same manifest. Together they are `npm run test:core`. Core still names a
 * few extension concepts as strings (the overlay's `airDrumConfig` port kind), which carry no
 * extension code and are listed in the ADR as the remaining hand-listed remnants.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, type Plugin } from 'vite';
import { AIR_EXTENSION } from '@/extensions/air';
import type { Extension } from '@/instruments/extension';
import { CORE_MANIFEST, readExtensionEntries } from '../vite.extensions';

const SHIPPED: readonly Extension[] = [AIR_EXTENSION];

if (readExtensionEntries(CORE_MANIFEST).length !== 0) throw new Error(`${CORE_MANIFEST} must list no extensions`);
const shippedIds = readExtensionEntries('extensions.json').map((e) => e.id);
const unchecked = shippedIds.filter((id) => !SHIPPED.some((e) => e.id === id));
if (unchecked.length) throw new Error(`check_core_bundle: add ${unchecked.join(', ')} to SHIPPED so its identifiers are checked`);

process.env.THOREMIN_EXTENSIONS = CORE_MANIFEST;
const out = mkdtempSync(join(tmpdir(), 'thoremin-core-'));
try {
  const extensionModules = new Set<string>();
  const moduleGraph: Plugin = {
    name: 'check-core-bundle',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          const rel = id.replace(/\\/g, '/').split('/src/extensions/')[1];
          if (rel !== undefined && rel !== 'index.ts') extensionModules.add(`src/extensions/${rel}`);
        }
      }
    },
  };
  await build({ build: { outDir: out, emptyOutDir: true }, logLevel: 'warn', plugins: [moduleGraph] });
  if (extensionModules.size) {
    console.error(`core-alone bundle contains extension modules: ${[...extensionModules].sort().join(', ')}`);
    process.exit(1);
  }
  const js = readdirSync(join(out, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(out, 'assets', f), 'utf8'))
    .join('\n');
  const needles = SHIPPED.flatMap((e) => [
    ...e.nodes.map((n) => `"${n.type}"`),
    ...e.branches.map((b) => `"${b.id}"`),
    ...e.dials.map((d) => `"${d.kind}"`),
  ]);
  const found = needles.filter((n) => js.includes(n));
  // A port KIND core still names as a string (the overlay reads the drum's config) is not code.
  const allowed = new Set(['"air-drum-config"']);
  const leaked = found.filter((n) => !allowed.has(n));
  if (leaked.length) {
    console.error(`core-alone bundle carries extension identifiers: ${leaked.join(', ')}`);
    process.exit(1);
  }
  console.log(`core-alone bundle: no extension module, none of ${needles.length} extension identifiers (${(js.length / 1024).toFixed(0)} kB of JS)`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
