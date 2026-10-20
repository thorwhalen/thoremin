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
import { dirname, join, normalize, sep } from 'node:path';
import { ALL_EXTENSION_DIRS } from './helpers/extensions';

/** The nodes and libraries of every extension are Node-safe core too (they moved out of
 *  `src/nodes` and `src/music` in PR 5b of the instruments-as-graphs ADR; the rule moved with them). */
const EXTENSION_PURE_DIRS = ALL_EXTENSION_DIRS.flatMap(({ dir }) => ['nodes', 'lib'].map((sub) => join(dir, sub))).filter((dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
});
// The air extension's nodes and libraries, at least: a guard that finds none checks nothing.
if (EXTENSION_PURE_DIRS.length === 0) throw new Error('layering: no extension nodes/lib directory found from extensions.json');
const CORE_DIRS = ['packages/dag/src', 'src/host', 'src/nodes', 'packages/lazy/src', 'src/keys', 'src/music', 'src/settings', ...EXTENSION_PURE_DIRS];
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

/**
 * The settings read node CONTRACTS, never node implementations (#600 S6): a settings schema that
 * imports the node that draws or plays a dial drags that node (the 2,300-line overlay, the
 * conductor) into everything that reads settings. A contract lives beside its node as
 * `<node>.schema.ts` (or a slot's `*_contract.ts`).
 */
const SETTINGS_NODE_IMPORT = /from\s+['"]@\/nodes\/([^'"]+)['"]/g;

describe('the settings import node contracts only', () => {
  it('src/settings imports no node implementation', () => {
    const offenders: string[] = [];
    for (const f of tsFiles('src/settings')) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(SETTINGS_NODE_IMPORT)) {
        const target = m[1];
        if (/\.schema$/.test(target) || /_contract$/.test(target)) continue;
        offenders.push(`${f} imports @/nodes/${target}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

/**
 * `src/plugins` is the frozen legacy app's (#128): only its entry (`src/App.tsx`, `src/components`,
 * `src/hooks`) and the plugins themselves import it (#600 S20, which moved the assistant to
 * `src/app/assistant`). A new import from anywhere else would make the frozen tree load-bearing again.
 */
const LEGACY_ENTRY = ['src/App.tsx', 'src/components/', 'src/hooks/', 'src/plugins/'];
const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

describe('nothing outside the legacy entry imports src/plugins', () => {
  it('src/ and packages/ reach src/plugins only from the legacy app', () => {
    const roots = ['src', ...readdirSync('packages').map((p) => join('packages', p, 'src')).filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    })];
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of roots) {
      for (const f of tsFiles(root)) {
        const rel = f.split(sep).join('/');
        if (LEGACY_ENTRY.some((e) => rel === e || rel.startsWith(e))) continue;
        scanned++;
        const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const m of src.matchAll(IMPORT_SPEC)) {
          const spec = m[1];
          const target = spec.startsWith('@/') ? `src/${spec.slice(2)}` : spec.startsWith('.') ? normalize(join(dirname(f), spec)).split(sep).join('/') : '';
          if (target === 'src/plugins' || target.startsWith('src/plugins/')) offenders.push(`${rel} imports ${spec}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the assistant lives in the app, not in src/plugins', () => {
    expect(statSync('src/app/assistant').isDirectory()).toBe(true);
    expect(() => statSync('src/plugins/assistant')).toThrow();
  });
});
