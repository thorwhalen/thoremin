/**
 * The React layer's calls into `src/dag/` still typecheck against the current API.
 *
 * This exists because a real regression got through. #192 removed the `resources` option
 * from `ApplierOptions` — the Applier takes them from the engine now — and left
 * `useEngine` passing it. That is a type error, and **nothing could see it**:
 *
 *  - `npm run typecheck` uses `tsconfig.dag.json`, which deliberately EXCLUDES the React
 *    layer (the repo ships no `@types/react`), so `src/app/useEngine.ts` is not in it.
 *  - `npm run build` is Vite/esbuild, which type-ERASES rather than checking.
 *  - `npm run lint` (loose `tsc` over everything) is known-red with ~21 pre-existing
 *    React-layer errors, and `docs/TESTING.md` says gating on it would train everyone to
 *    ignore the X — which is correct, and is exactly why one more error hid in it.
 *
 * So the gap is structural: **any `src/dag` API change can break a React-layer caller
 * with every gate green.** Closing it in general means either adopting `@types/react` or
 * fixing 21 errors, which is a decision for the maintainer (filed separately). This
 * guards the specific seam that broke, in the idiom the repo already uses for exactly
 * this class (`engine_wiring.test.ts`, `dials_write_path.test.ts`): read the source, and
 * check the connection rather than the computation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const parse = (p: string) =>
  ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** The property names an exported interface declares (optional ones included). */
function interfaceKeys(file: string, name: string): Set<string> {
  const src = parse(file);
  const keys = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === name) {
      for (const m of n.members) {
        if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) keys.add(m.name.text);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(src);
  return keys;
}

/** The property names passed in the FIRST object literal argument of `new <ctor>({...})`. */
function newExpressionKeys(file: string, ctor: string): Set<string> {
  const src = parse(file);
  const keys = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === ctor &&
      n.arguments?.length &&
      ts.isObjectLiteralExpression(n.arguments[0])
    ) {
      for (const p of n.arguments[0].properties) {
        if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) keys.add(p.name.text);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(src);
  return keys;
}

describe('useEngine constructs an Applier with options that actually exist', () => {
  const declared = interfaceKeys('src/dag/applier.ts', 'ApplierOptions');
  const passed = newExpressionKeys('src/app/useEngine.ts', 'Applier');

  it('finds both sides (the guard is not vacuous)', () => {
    // If either extractor silently returned nothing, the subset assertion below would
    // pass trivially — which is how a guard becomes decoration.
    expect(declared.size).toBeGreaterThan(3);
    expect(passed.size).toBeGreaterThan(3);
    expect([...declared]).toContain('engine');
    expect([...passed]).toContain('engine');
  });

  it('passes no option ApplierOptions does not declare', () => {
    const unknown = [...passed].filter((k) => !declared.has(k));
    expect(
      unknown,
      `src/app/useEngine.ts passes Applier options that no longer exist: ${unknown.join(', ')}. ` +
        `This file is NOT in tsconfig.dag.json, so tsc will not tell you.`,
    ).toEqual([]);
  });

  it('still passes the options that carry the live loop', () => {
    // A dropped `clock` or `sinks` would not be a type error (both are optional-ish in
    // shape terms) but would silently change what the instrument does.
    for (const required of ['engine', 'clock', 'sinks', 'shouldStop', 'onError']) {
      expect(passed, `useEngine stopped passing "${required}" to the Applier`).toContain(required);
    }
  });
});
