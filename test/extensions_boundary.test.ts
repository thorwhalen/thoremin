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
 * One named exception, on purpose: `src/settings/schema.ts` imports the air dial slice's
 * SHAPE directly, because the `Settings` TYPE must know the air keys statically (a hundred
 * importers read `settings.airDrum`); a generic fold would type them as `unknown`. It goes
 * when the settings type is generated from the manifests (PR 6).
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
  'src/settings/dials.ts', // the dials form fields + the layer bijection
  'src/app/graph.ts', // the full branch table, and the derivation and spec bound to it
  'src/app/dials/DialsControlsPanel.tsx', // the editor sections
  'src/app/dials/InstrumentsPanel.tsx', // the live readouts under the chosen row
  'src/app/useEngine.ts', // the status hooks
  'src/app/App.tsx', // the mount effects
  'src/app/extensions/index.ts', // the React-side list itself
]);
/**
 * THE SDK SURFACE, AS DATA: every core module an extension may import. This list is the
 * contract PR 6 cuts the `sdk` packages from (the pure half, then the app half); a new entry
 * is a decision to widen the contract, made here in review, never in passing. It was
 * computed from what the air extension actually imports, not designed in the abstract,
 * and deliberately has no barrel module: a barrel re-exporting all of this closes a module
 * cycle through the settings schema and drags JSX into the strict typecheck.
 */
const SDK_SURFACE = [
  // pure: the engine, the contracts, the manifest types
  '@/dag',
  '@/nodes/domain',
  '@/instruments/branch',
  '@/instruments/branches', // the trunk's node ids, to wire to
  '@/instruments/extension',
  '@/features/demand',
  '@/features/catalog',
  '@/ictus',
  '@/enroll',
  // pure: music theory and the two drum/wind libraries core also uses
  '@/music/theory',
  '@/music/notes',
  '@/music/fingerings', // also read by the trainer's starter sequences
  '@/music/drum_patterns', // also the hot store's pattern field
  '@/music/gm_drums',
  '@/drums/pattern_fit',
  '@/drums/pattern_play',
  '@/nodes/music/drum_pads', // also drawn by the overlay
  '@/nodes/music/drum_anchor', // also drawn by the overlay
  '@/settings/namedCollection',
  // app side: the write path, the settings hook, the panel primitives, the two singletons
  '@/app/extensions/types',
  '@/app/dispatchDial',
  '@/app/dials/useDialsSettings',
  '@/app/dials/primitives',
  '@/app/store',
  '@/app/featureDemand',
  // app side: the trainer's hooks the air instruments' training panels use
  '@/app/training/routes',
  '@/app/enroll/sequenceStore',
  '@/app/enroll/guidance',
  '@/app/enroll/click',
];

const LIST_MODULES = /^@\/(extensions|app\/extensions)$/;
const NAMED_EXCEPTIONS: Record<string, RegExp> = {
  'src/settings/schema.ts': /^@\/extensions\/air\/dials$/,
};

describe('core reaches the extensions only through the lists, from the fold points', () => {
  it('no core file imports from src/extensions except as allowed', () => {
    const offenders: string[] = [];
    {
      for (const file of tsFiles(CORE_ROOT)) {
        if (isExtensionFile(file) || file.startsWith('src/app/extensions/types')) continue;
        for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
          // Alias or relative, a directory or the list module itself (`../extensions`).
          const reachesExtensions = /^@\/extensions(\/|$)/.test(spec) || /^@\/app\/extensions(\/|$)/.test(spec) || /(^|\/)extensions(\/|$)/.test(spec);
          if (!reachesExtensions) continue;
          if (NAMED_EXCEPTIONS[file]?.test(spec)) continue;
          const isList = LIST_MODULES.test(spec) || (file.startsWith('src/app/') && /^\.\/extensions$/.test(spec));
          if (FOLD_POINTS.has(file) && (isList || (file === 'src/app/extensions/index.ts' && /^@\/extensions\/[^/]+\/ui$/.test(spec)))) continue;
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

  it('the list modules import only manifests (no component or store reaches in through them)', () => {
    const pure = importSpecifiers(readFileSync('src/extensions/index.ts', 'utf8'));
    expect(pure.every((s) => /^@\/instruments\//.test(s) || /^\.\/[a-z]+$/.test(s))).toBe(true);
  });

  it('an extension imports only the SDK surface, packages and itself (rule 2, on since 5b)', () => {
    const offenders: string[] = [];
    for (const file of tsFiles('src/extensions')) {
      const ext = file.split('/')[2]; // src/extensions/<ext>/...
      if (!ext || ext.endsWith('.ts')) continue; // the list module at the root
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('@/') && !spec.startsWith('.')) continue; // a package
        if (spec.startsWith('.')) continue; // relative: the mover left none that leave the extension (checked below)
        if (spec.startsWith(`@/extensions/${ext}/`)) continue; // itself
        if (SDK_SURFACE.some((allowed) => spec === allowed || spec.startsWith(`${allowed}/`))) continue;
        offenders.push(`${file} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
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
