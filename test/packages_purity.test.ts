/**
 * The workspace packages stay packages (PR 6 of the instruments-as-graphs ADR).
 *
 * `packages/*` are consumed as TypeScript source, so the app's `@/` alias (Vite) and `paths`
 * (tsconfig) still resolve from inside them: a package file importing `@/app/store` would
 * build, typecheck and pass every other test, and the package would stop being one. A
 * package imports only its own files (relative, never leaving its directory) and the
 * packages its own `package.json` declares. Every file of the package is read, not only
 * `src/`, so a file beside it cannot be the way out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import ts from 'typescript';

const PACKAGES_ROOT = 'packages';

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...tsFiles(p));
    }
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** Read by the TypeScript scanner, so a `/*` inside a string cannot hide an import. */
function importSpecifiers(src: string): string[] {
  return ts.preProcessFile(src, true, true).importedFiles.map((f) => f.fileName);
}

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
const packageOf = (spec: string): string => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

const packages = readdirSync(PACKAGES_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PACKAGES_ROOT, d.name, 'package.json')))
  .map((d) => d.name);

describe('a workspace package imports only itself and its declared dependencies', () => {
  it('finds the packages', () => {
    expect(packages).toEqual(expect.arrayContaining(['dag', 'ictus', 'lazy', 'taglog']));
  });

  for (const name of packages) {
    const root = join(PACKAGES_ROOT, name);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);

    it(`${manifest.name}`, () => {
      const offenders: string[] = [];
      for (const file of tsFiles(root)) {
        for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
          if (spec.startsWith('.')) {
            const target = normalize(join(dirname(file), spec));
            if (!target.startsWith(`${normalize(root)}/`)) offenders.push(`${file} leaves the package: ${spec}`);
            continue;
          }
          if (spec.startsWith('node:')) {
            offenders.push(`${file} imports ${spec} (a package runs in the browser)`);
            continue;
          }
          if (spec.startsWith('@/')) {
            offenders.push(`${file} imports the app through the alias: ${spec}`);
            continue;
          }
          if (!declared.has(packageOf(spec))) offenders.push(`${file} imports ${spec}, which ${manifest.name} does not declare`);
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([]);
    });
  }

  it('the guard sees what it must refuse', () => {
    expect(importSpecifiers(`import { a } from '@/app/store';\nexport * from "../x";\n// import z from 'ignored';`)).toEqual(['@/app/store', '../x']);
    expect(importSpecifiers(`const glob = 'src/*';\nimport { b } from '@/app/store'; // */\nconst c = import('./lazy');`)).toEqual(['@/app/store', './lazy']);
    expect(packageOf('@thoremin/dag/engine')).toBe('@thoremin/dag');
    expect(packageOf('zod/v4')).toBe('zod');
  });
});
