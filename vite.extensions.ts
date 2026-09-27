/**
 * The extension list, injected at build time (seam 4 of the instruments-as-graphs ADR,
 * `docs/design/instruments-as-graphs-and-extensions.md`; PR 6).
 *
 * `extensions.json` names the extensions a build ships. This plugin turns it into two
 * virtual modules, one per half of a manifest: `virtual:thoremin/extensions` (the pure
 * `Extension`s) and `virtual:thoremin/extensions-ui` (their React halves). The app's two list
 * modules (`src/extensions/index.ts`, `src/app/extensions/index.ts`) import those, so which
 * extensions exist is DATA a build reads, not code the app hand-lists. Today the modules are
 * in-tree (`@/extensions/air`); after the repository split (PR 7) the same file names
 * registry packages.
 *
 * What this does NOT do yet: leaving `air` out of the manifest removes its nodes, branches,
 * ports and panels from the running app, but not its code from the bundle, because
 * `src/settings/schema.ts` still imports the air dial shape directly (the one named
 * exception in `test/extensions_boundary.test.ts`).
 *
 * Set `THOREMIN_EXTENSIONS` to build from another manifest file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const EXTENSIONS_MODULE = 'virtual:thoremin/extensions';
export const EXTENSIONS_UI_MODULE = 'virtual:thoremin/extensions-ui';

export interface ExtensionEntry {
  id: string;
  /** The pure manifest module (default export: an `Extension`). */
  module: string;
  /** The React half (default export: an `ExtensionUi`). */
  ui: string;
}

/** An alias (`@/x`) or a package (`x`, `@scope/x`), with an optional subpath. */
const SPECIFIER = /^(@\/|@[a-z0-9][\w.-]*\/|[a-z0-9])[\w./-]*$/i;

export function readExtensionEntries(file: string): ExtensionEntry[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { extensions?: unknown };
  if (!Array.isArray(parsed.extensions)) throw new Error(`${file}: "extensions" must be an array`);
  const seen = new Set<string>();
  return parsed.extensions.map((e, i) => {
    const entry = e as Partial<ExtensionEntry>;
    for (const key of ['id', 'module', 'ui'] as const) {
      if (typeof entry[key] !== 'string' || !entry[key]) throw new Error(`${file}: extensions[${i}].${key} must be a non-empty string`);
    }
    for (const key of ['module', 'ui'] as const) {
      // A virtual module has no directory, so a relative path cannot resolve from it.
      if (!SPECIFIER.test(entry[key] as string)) {
        throw new Error(`${file}: extensions[${i}].${key} ("${entry[key]}") must be a module specifier: an alias ("@/extensions/x") or a package ("@scope/x"), not a relative or absolute path`);
      }
    }
    if (seen.has(entry.id as string)) throw new Error(`${file}: duplicate extension id "${entry.id}"`);
    seen.add(entry.id as string);
    return entry as ExtensionEntry;
  });
}

/** The source of a virtual list module: one default import per entry, exported as an array. */
export function listModuleSource(entries: readonly ExtensionEntry[], key: 'module' | 'ui'): string {
  const imports = entries.map((e, i) => `import e${i} from ${JSON.stringify(e[key])};`).join('\n');
  return `${imports}\nexport default [${entries.map((_, i) => `e${i}`).join(', ')}];\n`;
}

export function thoreminExtensions(root: string, manifest = process.env.THOREMIN_EXTENSIONS ?? 'extensions.json'): Plugin {
  const file = path.resolve(root, manifest);
  return {
    name: 'thoremin-extensions',
    resolveId(id) {
      return id === EXTENSIONS_MODULE || id === EXTENSIONS_UI_MODULE ? `\0${id}` : undefined;
    },
    load(id) {
      if (id !== `\0${EXTENSIONS_MODULE}` && id !== `\0${EXTENSIONS_UI_MODULE}`) return undefined;
      this.addWatchFile(file);
      return listModuleSource(readExtensionEntries(file), id === `\0${EXTENSIONS_MODULE}` ? 'module' : 'ui');
    },
  };
}
