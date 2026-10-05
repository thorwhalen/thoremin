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
 * The pure list's TYPE is generated from the same file (`npm run extensions` writes
 * `src/extensions/virtual.d.ts`, {@link declarationSource}): a tuple of the listed manifests'
 * types, from which the `Settings` type is computed. So core never imports an extension to
 * know its settings keys, and a manifest without `air` builds a bundle without the air code.
 *
 * Set `THOREMIN_EXTENSIONS` to build from another manifest file (and run `npm run extensions`
 * with the same variable to typecheck against it).
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

/** Where the generated declaration of the pure list lives (relative to the root). */
export const DECLARATION_FILE = 'src/extensions/virtual.d.ts';
/** The core-alone manifest (no extensions) and its declaration, which `tsconfig.core.json`
 *  reads instead of {@link DECLARATION_FILE}: core typechecks with no extension listed. */
export const CORE_MANIFEST = 'extensions.core.json';
export const CORE_DECLARATION_FILE = 'extensions.core.d.ts';

/**
 * The declaration of `virtual:thoremin/extensions`: a readonly tuple of the listed pure
 * manifests' own types (`typeof import('@/extensions/air').default`), in manifest order. The
 * settings type folds over it (`ExtensionsSettingsShape`), so it is typed per build and the
 * import is type-only: erased from the bundle.
 */
export function declarationSource(entries: readonly ExtensionEntry[], manifest = 'extensions.json'): string {
  // The header names the manifest by its file name only: a committed file never carries a
  // local absolute path, whatever `THOREMIN_EXTENSIONS` pointed at.
  manifest = path.basename(manifest);
  const members = entries.map((e) => `typeof import(${JSON.stringify(e.module)}).default`).join(', ');
  return `/**
 * GENERATED from ${manifest} by \`npm run extensions\` (scripts/gen_extensions.ts); do not edit.
 *
 * The virtual module \`vite.extensions.ts\` generates: the pure manifests of the extensions this
 * build ships, typed as a tuple of each listed manifest's own type, so the \`Settings\` type is
 * computed from the manifests (\`src/settings/schema.ts\`) without core importing an extension.
 * (The React halves' module is declared next to their list, in \`src/app/extensions/virtual.d.ts\`,
 * so that the strict, React-free typecheck never reads a React type.)
 */
declare module 'virtual:thoremin/extensions' {
  const extensions: readonly [${members}];
  export default extensions;
}
`;
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
