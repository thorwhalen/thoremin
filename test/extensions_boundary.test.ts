/**
 * The extension boundary (the instruments-as-graphs ADR, §4.2; PR 5a), enforced as a test
 * like the command firewall: thoremin lints with `tsc --noEmit`, so a module boundary that
 * matters is a test or it is a wish.
 *
 * Rule 1: core (everything under `src/` that is not `src/extensions`) reaches the extensions
 * only through the two list modules (`@/extensions`, `@/app/extensions`) and only from the
 * named FOLD POINTS. The pure package `src/instruments` is NOT a fold point: the derivation
 * and the spec assembly take the extension table as a parameter, bound once in `graph.ts`. Any other core file importing
 * anything under `src/extensions/` is the old hand-listing coming back in a new place.
 *
 * No named exceptions. Until the follow-up to PR 6, `src/settings/schema.ts` imported the
 * air dial shape directly so that the `Settings` TYPE knew the air keys. Now the type is
 * computed from the manifests (`npm run extensions` generates the list's declaration, a
 * tuple of each listed manifest's type) and the schema folds the list like any fold point,
 * so a build from a manifest without `air` bundles no air code.
 *
 * Rule 2, on since 5b (the physical move): an extension imports only the SDK (the
 * `@thoremin/sdk` package, and the app modules listed below as the app half), other
 * packages, and itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { SHIPPED_EXTENSION_DIRS } from './helpers/extensions';
import { dirname, join, normalize, relative } from 'node:path';

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const from = /(?:\bimport\b|\bexport\b)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const dyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const bare = /^\s*import\s+['"]([^'"]+)['"]/gm; // a side-effect import has no `from`
  for (const re of [from, dyn, bare]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs;
}

/** Everything that is not an extension is core: the whole of `src/`, minus `src/extensions`. */
const CORE_ROOT = 'src';
const isExtensionFile = (file: string): boolean => file.startsWith('src/extensions/');

/** The fold points: the only core files that may name the extension LISTS. */
const FOLD_POINTS = new Set([
  'src/nodes/browser.ts', // createAppRegistry
  'src/settings/schema.ts', // SettingsSchema = core + the extensions' dial slices
  'src/settings/dials.ts', // the dials form fields + the layer bijection
  'src/app/dials/instruments.ts', // the seeds: core's, then the extensions' instruments
  'src/app/training/routes.ts', // the extensions' training routes, then core's Trainer
  'src/app/graph.ts', // the full branch table, and the derivation and spec bound to it
  'src/app/dials/DialsControlsPanel.tsx', // the editor sections
  'src/app/dials/InstrumentsPanel.tsx', // the live readouts under the chosen row
  'src/app/useEngine.ts', // the status hooks
  'src/app/App.tsx', // the mount effects
  'src/app/extensions/index.ts', // the React-side list itself
]);
/**
 * THE SDK, AS PACKAGES. Both halves are workspace packages since the follow-ups to PR 6:
 * `@thoremin/sdk` (pure) and `@thoremin/sdk-ui` (the app half: the host's hot store and dial
 * write path by dependency inversion, the panel primitives, the extension UI types). Their
 * boundaries are `test/packages_purity.test.ts`'s. So an extension imports packages and itself,
 * nothing under `@/` but its own files; widening the contract is an edit to a package's
 * `exports`, reviewed there.
 *
 * Its PURE side (nodes, libraries, the pure manifest) is narrower still: never the app half,
 * so the real-time path cannot reach the hot store or the command dispatch.
 */
/** The PACKAGES a pure extension file may import: the pure SDK, thoremin's other pure
 *  workspace packages and the schema library. Its React side may import any package the app
 *  depends on, `@thoremin/sdk-ui` included. */
const PURE_PACKAGES = ['@thoremin/sdk', '@thoremin/dag', '@thoremin/ictus', '@thoremin/lazy', 'zod'];

/** A file of the extension's PURE side: a node, a library, or a pure manifest file at its root. */
/** A file of an extension's PURE side, by its path below the extension's source directory: a
 *  node, a library, or a pure manifest file at its root (`ui.tsx` is the React half). */
const isPureExtensionPath = (rel: string): boolean => /^(nodes|lib)\//.test(rel) || /^[^/]+\.ts$/.test(rel);
const allows = (list: readonly string[], spec: string): boolean =>
  list.some((allowed) => spec === allowed || spec.startsWith(`${allowed}/`));

const LIST_MODULES = /^@\/(extensions|app\/extensions)$/;
/** The list side's type-only files: the manifest types and the virtual module's declaration. */
const LIST_TYPE_FILES = new Set(['src/app/extensions/virtual.d.ts']);

describe('core reaches the extensions only through the lists, from the fold points', () => {
  it('no core file imports from src/extensions except as allowed', () => {
    const offenders: string[] = [];
    {
      for (const file of tsFiles(CORE_ROOT)) {
        // The list side's own type files, exempt BY NAME: any other file beside them is core.
        if (isExtensionFile(file) || LIST_TYPE_FILES.has(file)) continue;
        for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
          // Alias or relative, a directory or the list module itself (`../extensions`).
          const reachesExtensions = /^@\/extensions(\/|$)/.test(spec) || /^@\/app\/extensions(\/|$)/.test(spec) || /(^|\/)extensions(\/|$)/.test(spec);
          if (!reachesExtensions) continue;
          const isList = LIST_MODULES.test(spec) || (file.startsWith('src/app/') && /^\.\/extensions$/.test(spec));
          if (FOLD_POINTS.has(file) && isList) continue;
          offenders.push(`${file} imports ${spec}`);
        }
        // An extension that is a package is reached by its package name: never from core.
        for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
          if (/^@thoremin\/ext-/.test(spec)) offenders.push(`${file} imports the extension package ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the pure package never names the extensions (the table is a parameter)', () => {
    for (const file of tsFiles('src/instruments')) {
      const specs = importSpecifiers(readFileSync(file, 'utf8'));
      expect(specs.filter((s) => /extensions/.test(s)), file).toEqual([]);
    }
  });

  it('the list side type files import no extension, and re-export nothing from one', () => {
    for (const file of LIST_TYPE_FILES) {
      const src = readFileSync(file, 'utf8');
      expect(importSpecifiers(src).filter((s) => /^@\/extensions(\/|$)/.test(s) || /^\.{1,2}\/(.*\/)?extensions\//.test(s)), file).toEqual([]);
    }
    // The list module takes TYPES from `./types`; a value re-export would be a second list.
    expect(readFileSync('src/app/extensions/index.ts', 'utf8')).not.toMatch(/export\s*(\*|\{[^}]*\})\s*from/);
  });

  it('the list modules import only manifests (no component or store reaches in through them)', () => {
    // Since PR 6 the lists come from `extensions.json` through two virtual modules.
    const pure = importSpecifiers(readFileSync('src/extensions/index.ts', 'utf8'));
    expect(pure.sort()).toEqual(['@thoremin/sdk/instruments/extension', 'virtual:thoremin/extensions']);
    const ui = importSpecifiers(readFileSync('src/app/extensions/index.ts', 'utf8'));
    expect(ui.sort()).toEqual(['@thoremin/sdk-ui/types', 'virtual:thoremin/extensions-ui']);
  });

  it('finds the shipped extensions (a guard over no files checks nothing)', () => {
    expect(SHIPPED_EXTENSION_DIRS.length).toBeGreaterThan(0);
    for (const { id, dir } of SHIPPED_EXTENSION_DIRS) expect(tsFiles(dir).length, `${id}: ${dir}`).toBeGreaterThan(0);
  });

  it('an extension imports only the SDK, other packages and itself; its pure side only pure packages and its own pure files (rule 2)', () => {
    const offenders: string[] = [];
    for (const { id, dir } of SHIPPED_EXTENSION_DIRS) {
      const inTree = dir.startsWith('src/');
      for (const file of tsFiles(dir)) {
        const pure = isPureExtensionPath(relative(dir, file));
        for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
          let target: string | null = null;
          if (spec.startsWith('.')) target = normalize(join(dirname(file), spec));
          else if (inTree && spec.startsWith(`@/extensions/${id}/`)) target = join(dir, spec.slice(`@/extensions/${id}/`.length));
          else if (spec.startsWith('@/')) {
            offenders.push(`${file} imports the app: ${spec}`);
            continue;
          } else {
            // A package. The React side may import any the app depends on; a pure file only the pure ones.
            if (pure && !allows(PURE_PACKAGES, spec)) offenders.push(`${file} (pure) imports the package ${spec}`);
            continue;
          }
          const rel = relative(dir, target);
          if (rel.startsWith('..')) offenders.push(`${file} leaves its extension: ${spec}`);
          else if (pure && !isPureExtensionPath(rel.replace(/(\.tsx?)?$/, '.ts')) && !/^[^/]+$/.test(rel)) offenders.push(`${file} (pure) imports its own app side: ${spec}`);
          else if (pure && /^[^/]+$/.test(rel) && !existsSync(`${target}.ts`) && !existsSync(target)) offenders.push(`${file} (pure) imports its own React half: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the pure side never imports the app half of the SDK', () => {
    const offenders: string[] = [];
    for (const { dir } of SHIPPED_EXTENSION_DIRS) {
      for (const file of tsFiles(dir).filter((f) => isPureExtensionPath(relative(dir, f)))) {
        for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) if (spec.startsWith('@thoremin/sdk-ui')) offenders.push(`${file} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
