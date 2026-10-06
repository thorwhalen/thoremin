/**
 * Which extensions this test run's build lists (`extensions.json`, or the file
 * `THOREMIN_EXTENSIONS` names). The core-alone run (`npm run test:core`) lists none, so a
 * test that exercises an extension says so with `describe.runIf(AIR)` / `it.runIf(AIR)`,
 * and a core test whose expectation counts an extension's nodes or keys branches on it.
 * Core must pass with no extensions: that is the guard, and this flag is how a test opts out
 * of it honestly instead of failing there.
 */
import { EXTENSIONS } from '@/extensions';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readExtensionEntries } from '../../vite.extensions';

export const hasExtension = (id: string): boolean => EXTENSIONS.some((e) => e.id === id);

/** True when the build ships the air instruments. */
export const AIR = hasExtension('air');


/** Where an extension's source lives, found from its manifest specifier: an in-tree alias
 *  (`@/extensions/x` → `src/extensions/x`) or a workspace package (`@thoremin/ext-x` →
 *  `packages/<dir>/src`). */
export function extensionSourceDir(moduleSpec: string): string {
  if (moduleSpec.startsWith('@/')) return join('src', moduleSpec.slice(2));
  for (const d of readdirSync('packages', { withFileTypes: true })) {
    const pj = join('packages', d.name, 'package.json');
    if (d.isDirectory() && existsSync(pj) && (JSON.parse(readFileSync(pj, 'utf8')) as { name: string }).name === moduleSpec) return join('packages', d.name, 'src');
  }
  throw new Error(`no source directory for the extension module "${moduleSpec}"`);
}

/**
 * The source directories of the extensions the SHIPPED manifest (`extensions.json`) lists,
 * whatever this run's `THOREMIN_EXTENSIONS` says: the static guards (write path, layering,
 * command firewall, boundary) scan these, so moving an extension (into a package, say) moves
 * what they scan instead of leaving them green over nothing.
 */
export const SHIPPED_EXTENSION_DIRS: readonly { id: string; dir: string }[] = readExtensionEntries('extensions.json').map((e) => ({
  id: e.id,
  dir: extensionSourceDir(e.module),
}));
