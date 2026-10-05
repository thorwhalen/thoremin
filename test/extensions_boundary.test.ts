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
 * Rule 2, on since 5b (the physical move): an extension imports only `SDK_SURFACE` (the
 * core modules listed below, which IS the SDK contract as data), packages, and itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  'src/app/graph.ts', // the full branch table, and the derivation and spec bound to it
  'src/app/dials/DialsControlsPanel.tsx', // the editor sections
  'src/app/dials/InstrumentsPanel.tsx', // the live readouts under the chosen row
  'src/app/useEngine.ts', // the status hooks
  'src/app/App.tsx', // the mount effects
  'src/app/extensions/index.ts', // the React-side list itself
]);
/**
 * THE SDK SURFACE, AS DATA, in two halves: every core module an extension may import. This list is the
 * contract PR 6 cuts the `sdk` packages from (the pure half, then the app half); a new entry
 * is a decision to widen the contract, made here in review, never in passing. It was
 * computed from what the air extension actually imports, not designed in the abstract,
 * and deliberately has no barrel module: a barrel re-exporting all of this closes a module
 * cycle through the settings schema and drags JSX into the strict typecheck.
 */
/** The PURE half: what an extension's nodes, libraries and pure manifest files may import.
 *  An entry allows the module and every path below it (`@/dag` allows `@/dag/engine`). */
const SDK_PURE = [
  '@/nodes/domain',
  '@/instruments/branch',
  '@/instruments/branches', // the trunk's node ids, to wire to
  '@/instruments/extension',
  '@/features/demand',
  '@/features/catalog',
  '@/enroll',
  '@/music/theory',
  '@/music/notes',
  '@/music/fingerings', // also read by the trainer's starter sequences
  '@/music/drum_patterns', // also the hot store's pattern field
  '@/music/gm_drums',
  '@/drums/pattern_fit',
  '@/drums/pattern_play',
  '@/nodes/music/drum_pads', // also drawn by the overlay
  '@/nodes/music/drum_anchor', // also drawn by the overlay
];

/** The APP half: what an extension's React side (`app/`, `panels/`, `ui.tsx`) may import on
 *  top of the pure half. Never a node, a library or a pure manifest file: the real-time path
 *  must not reach the app shell, the hot store or the command dispatch. */
const SDK_APP = [
  '@/settings/namedCollection',
  '@/app/extensions/types',
  '@/app/dispatchDial', // the write path
  '@/app/dials/useDialsSettings',
  '@/app/dials/primitives',
  '@/app/store',
  '@/app/featureDemand',
  // the trainer's hooks the air instruments' training panels use
  '@/app/training/routes',
  '@/app/enroll/sequenceStore',
  '@/app/enroll/guidance',
  '@/app/enroll/click',
];

const SDK_SURFACE = [...SDK_PURE, ...SDK_APP];

/** The PACKAGES a pure extension file may import: thoremin's own pure workspace packages
 *  (cut from the surface in PR 6) and the schema library. Its React side may import any
 *  package the app depends on. */
const PURE_PACKAGES = ['@thoremin/dag', '@thoremin/ictus', '@thoremin/lazy', 'zod'];

/** A file of the extension's PURE side: a node, a library, or a pure manifest file at its root. */
const isPureExtensionFile = (file: string): boolean =>
  /^src\/extensions\/[^/]+\/(nodes|lib)\//.test(file) || /^src\/extensions\/[^/]+\/[^/]+\.ts$/.test(file);
const allows = (list: readonly string[], spec: string): boolean =>
  list.some((allowed) => spec === allowed || spec.startsWith(`${allowed}/`));

const LIST_MODULES = /^@\/(extensions|app\/extensions)$/;
/** The list side's type-only files: the manifest types and the virtual module's declaration. */
const LIST_TYPE_FILES = new Set(['src/app/extensions/types.ts', 'src/app/extensions/virtual.d.ts']);

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
          if (FOLD_POINTS.has(file) && (isList || (file === 'src/app/extensions/index.ts' && spec === './types'))) continue;
          offenders.push(`${file} imports ${spec}`);
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
    expect(pure.sort()).toEqual(['@/instruments/extension', 'virtual:thoremin/extensions', 'zod']);
    const ui = importSpecifiers(readFileSync('src/app/extensions/index.ts', 'utf8'));
    expect(ui.sort()).toEqual(['./types', 'virtual:thoremin/extensions-ui']);
  });

  it('an extension imports only the SDK surface, packages and itself (rule 2, on since 5b)', () => {
    const offenders: string[] = [];
    for (const file of tsFiles('src/extensions')) {
      // The list module, covered below, and its generated declaration, which names exactly the
      // manifests `extensions.json` lists (pinned by `extensions_manifest.test.ts`).
      if (file === 'src/extensions/index.ts' || file === 'src/extensions/virtual.d.ts') continue;
      const ext = file.split('/')[2];
      const pure = isPureExtensionFile(file);
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) continue; // relative: checked below
        if (!spec.startsWith('@/')) {
          // A package. The React side may import any; a pure file only the pure ones.
          if (pure && !allows(PURE_PACKAGES, spec)) offenders.push(`${file} (pure) imports the package ${spec}`);
          continue;
        }
        if (spec.startsWith(`@/extensions/${ext}/`)) {
          // Itself. A pure file stays on the pure side of its own extension too.
          // A root module counts as pure only if it is a `.ts` file (`ui.tsx` is the React half).
          const ownPure =
            /^@\/extensions\/[^/]+\/(nodes|lib)\//.test(spec) ||
            (/^@\/extensions\/[^/]+\/[^/]+$/.test(spec) && existsSync(`src/${spec.slice(2)}.ts`));
          if (!pure || ownPure) continue;
          offenders.push(`${file} (pure) imports its own app side: ${spec}`);
          continue;
        }
        if (allows(pure ? SDK_PURE : SDK_SURFACE, spec)) continue;
        offenders.push(`${file}${pure ? ' (pure)' : ''} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every entry of the SDK surface is used (the contract lists nothing speculative)', () => {
    const used = new Set<string>();
    for (const file of tsFiles('src/extensions')) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        for (const allowed of SDK_SURFACE) if (spec === allowed || spec.startsWith(`${allowed}/`)) used.add(allowed);
      }
    }
    expect(SDK_SURFACE.filter((s) => !used.has(s))).toEqual([]);
  });

  it('no relative import leaves an extension', () => {
    const leaving: string[] = [];
    for (const file of tsFiles('src/extensions')) {
      const depth = file.split('/').length - 4; // directories below src/extensions/<ext>/
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('..')) continue;
        const ups = spec.split('/').filter((s) => s === '..').length;
        if (ups > Math.max(depth, 0)) leaving.push(`${file} imports ${spec}`);
      }
    }
    expect(leaving).toEqual([]);
  });
});
