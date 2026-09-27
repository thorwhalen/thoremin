/**
 * The extension boundary (the instruments-as-graphs ADR, §4.2; PR 5a), enforced as a test
 * like the command firewall: thoremin lints with `tsc --noEmit`, so a module boundary that
 * matters is a test or it is a wish.
 *
 * Rule 1: core reaches the extensions only through the two list modules (`@/extensions`,
 * `@/app/extensions`) and only from the named FOLD POINTS. Any other core file importing
 * anything under `src/extensions/` is the old hand-listing coming back in a new place.
 *
 * One named exception, on purpose: `src/settings/schema.ts` imports the air dial slice's
 * SHAPE directly, because the `Settings` TYPE must know the air keys statically (a hundred
 * importers read `settings.airDrum`); a generic fold would type them as `unknown`. It goes
 * when the settings type is generated from the manifests (PR 6).
 *
 * Rule 2 (the other direction, "an extension imports only the SDK") cannot hold in 5a: the
 * air files still live at their core paths and the manifest imports them there. It lands
 * with 5b, the physical move, and is written here as a pending test so the PR that moves
 * the files has to turn it on.
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
  for (const re of [from, dyn]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs;
}

const CORE_DIRS = ['src/dag', 'src/nodes', 'src/instruments', 'src/settings', 'src/app', 'src/features', 'src/music', 'src/enroll', 'src/lazy'];

/** The fold points: the only core files that may name the extension LISTS. */
const FOLD_POINTS = new Set([
  'src/nodes/browser.ts', // createAppRegistry
  'src/settings/dials.ts', // the dials form fields + the layer bijection
  'src/app/graph.ts', // the full branch table
  'src/instruments/derive.ts', // the derivation
  'src/instruments/spec.ts', // the features facet's closure
  'src/app/dials/DialsControlsPanel.tsx', // the editor sections
  'src/app/useEngine.ts', // the status hooks
  'src/app/App.tsx', // the mount effects
  'src/app/extensions/index.ts', // the React-side list itself
]);
const LIST_MODULES = /^@\/(extensions|app\/extensions)$/;
const NAMED_EXCEPTIONS: Record<string, RegExp> = {
  'src/settings/schema.ts': /^@\/extensions\/air\/dials$/,
};

describe('core reaches the extensions only through the lists, from the fold points', () => {
  it('no core file imports from src/extensions except as allowed', () => {
    const offenders: string[] = [];
    for (const dir of CORE_DIRS) {
      for (const file of tsFiles(dir)) {
        if (file.startsWith('src/app/extensions/types')) continue;
        for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
          const reachesExtensions = /^@\/extensions(\/|$)/.test(spec) || /^@\/app\/extensions(\/|$)/.test(spec) || /(^|\/)extensions\//.test(spec);
          if (!reachesExtensions) continue;
          if (NAMED_EXCEPTIONS[file]?.test(spec)) continue;
          if (FOLD_POINTS.has(file) && (LIST_MODULES.test(spec) || (file === 'src/app/extensions/index.ts' && /^@\/extensions\/[^/]+\/ui$/.test(spec)))) continue;
          offenders.push(`${file} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the list modules import only manifests (no component or store reaches in through them)', () => {
    const pure = importSpecifiers(readFileSync('src/extensions/index.ts', 'utf8'));
    expect(pure.every((s) => /^@\/instruments\//.test(s) || /^\.\/[a-z]+$/.test(s))).toBe(true);
  });

  it.todo('5b: an extension under src/extensions imports only the SDK, sdk/ui and itself (turn on with the move)');
});
