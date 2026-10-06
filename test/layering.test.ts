/**
 * Layering guard (#188): the engine and node library never depend on the app shell
 * or a React plugin. `packages/dag/src`, `src/nodes`, `packages/lazy/src` and `src/keys` are the
 * Node-safe core the headless runs, the fixtures and the scripts import; one import
 * of `@/app/*` or `@/plugins/*` from there would drag React-side modules into every
 * headless test and invert the dependency direction the design docs state. The
 * command firewall guards the other direction (commands never reach the DAG); this
 * guards this one, which nothing guarded before the key store moved to `src/keys`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SHIPPED_EXTENSION_DIRS } from './helpers/extensions';

/** The nodes and libraries of every extension are Node-safe core too (they moved out of
 *  `src/nodes` and `src/music` in PR 5b of the instruments-as-graphs ADR; the rule moved with them). */
const EXTENSION_PURE_DIRS = SHIPPED_EXTENSION_DIRS.flatMap(({ dir }) => ['nodes', 'lib'].map((sub) => join(dir, sub))).filter((dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
});
// The air extension's nodes and libraries, at least: a guard that finds none checks nothing.
if (EXTENSION_PURE_DIRS.length === 0) throw new Error('layering: no extension nodes/lib directory found from extensions.json');
const CORE_DIRS = ['packages/dag/src', 'src/nodes', 'packages/lazy/src', 'src/keys', 'src/music', 'src/settings', ...EXTENSION_PURE_DIRS];
const FORBIDDEN = /from\s+['"](@\/(app|plugins)(\/|['"])|\.\.\/(\.\.\/)*(app|plugins)\/)/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('the Node-safe core never imports the app shell or a plugin', () => {
  for (const dir of CORE_DIRS) {
    it(`${dir} imports nothing from src/app or src/plugins`, () => {
      const offenders: string[] = [];
      for (const f of tsFiles(dir)) {
        const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const line of src.split('\n')) if (FORBIDDEN.test(line)) offenders.push(`${f}: ${line.trim()}`);
      }
      expect(offenders, offenders.join('\n')).toEqual([]);
    });
  }
});
