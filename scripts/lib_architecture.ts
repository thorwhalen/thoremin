/**
 * The architecture fitness numbers (#600 S1; `docs/design/vertical-slices.md` §3.2 and §5),
 * measured from the source alone: what `test/architecture_ratchet.test.ts` compares with the
 * committed baseline (`test/architecture.baseline.json`), and what `npm run ratchet:arch --
 * --update` writes into it.
 *
 * Each number counts one way the code falls short of the target architecture (vertical slices
 * behind one extension contract), so the refactor steps S2..S20 are measured by them falling:
 *
 *  - `nodeImplementationImports`: value imports, from a module outside `src/nodes`, of a node
 *    IMPLEMENTATION file (V3: a settings schema or a default fetched by importing the node that
 *    draws or plays it). A contract module beside a node (`*.schema.ts`, `*_contract.ts`) is not
 *    an implementation, and the app registry (`src/host/appRegistry.ts`), which imports nodes to
 *    register them, is not counted.
 *  - `extensionNamesInCore`: per shipped extension, the core files (`src/` minus the list
 *    modules, the in-tree extensions and slices, the flat-slice policy table, the frozen legacy
 *    app and tests) whose CODE names one of that extension's
 *    identifiers: its id, a node type, a branch id, a dial key or kind, a transient field or
 *    kind (V1, V4). Comments do not count; identifiers and string literals do, and a name that
 *    starts with one (`airDrumConfig` names `airDrum`) counts too.
 *  - `storeControlsPorts`: the hand-written output ports of the `store-controls` node (V2);
 *    the generated extension ports are not counted.
 *  - `useEngineReporters`: the `make*Reporter` status bridges `useEngine.ts` imports by name (V2),
 *    beside the generic extension status hooks.
 *  - `foldPoints`: the core files allowed to name the extension lists (V5), from
 *    `test/helpers/fold_points.ts`.
 *  - `importCycles` / `runtimeImportCycles`: strongly connected groups of files in the import
 *    graph of `src/` and `packages/*` (V10), outside the frozen legacy app; the runtime count
 *    leaves out type-only and dynamic imports, which cannot deadlock a module's evaluation.
 *  - `largestFiles`: the line counts of the five largest source files when the baseline was
 *    written (V8), each a ceiling.
 *
 * Measured with the TypeScript parser (no type checking), so a `type` modifier, a comment or a
 * re-export is read exactly; the whole tree parses in a couple of seconds.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import type { DialSlice } from '@thoremin/sdk/instruments/extension';
import { flatDialKeys } from '../src/host/slices';

export interface ArchitectureNumbers {
  nodeImplementationImports: number;
  extensionNamesInCore: Record<string, number>;
  storeControlsPorts: number;
  useEngineReporters: number;
  foldPoints: number;
  importCycles: number;
  runtimeImportCycles: number;
  largestFiles: Record<string, number>;
}

/** What one extension is named by in code (its manifest's identifiers). */
export interface ExtensionNames {
  id: string;
  /** Matched exactly, or as the head of a longer name (`airDrum` in `airDrumConfig`). */
  names: readonly string[];
}

/** The frozen legacy app (`CLAUDE.md`, "Two front-ends in one build"): never refactored, never measured. */
export const LEGACY = (file: string): boolean =>
  file === 'src/App.tsx' || /^src\/(components|hooks|plugins\/ai-dj)\//.test(file) || /^src\/plugins\/[^/]+\.tsx?$/.test(file);

const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file) || file.endsWith('.d.ts');

function sourceFiles(root: string, dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...sourceFiles(root, rel));
    } else if (/\.tsx?$/.test(entry.name) && !isTest(rel)) out.push(rel);
  }
  return out;
}

/** Every measured source file: `src/` and each workspace package's `src/`, root-relative. */
export function measuredFiles(root: string): string[] {
  const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => sourceFiles(root, join('packages', d.name, 'src')));
  return [...sourceFiles(root, 'src'), ...packages].map((f) => f.split('\\').join('/')).sort();
}

interface ImportEdge {
  spec: string;
  /** False for `import type`, `export type`, an import whose every binding is `type`, and `import('x')` types. */
  value: boolean;
  dynamic: boolean;
}

function parse(root: string, file: string): ts.SourceFile {
  const text = readFileSync(join(root, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function importsOf(sf: ts.SourceFile): ImportEdge[] {
  const out: ImportEdge[] = [];
  const literal = (n: ts.Node | undefined): string | null => (n && ts.isStringLiteral(n) ? n.text : null);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const spec = literal(st.moduleSpecifier);
      if (!spec) continue;
      const clause = st.importClause;
      let value = true;
      if (clause?.isTypeOnly) value = false;
      else if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const els = clause.namedBindings.elements;
        if (els.length > 0 && els.every((e) => e.isTypeOnly)) value = false;
      }
      out.push({ spec, value, dynamic: false });
    } else if (ts.isExportDeclaration(st)) {
      const spec = literal(st.moduleSpecifier);
      if (!spec) continue;
      let value = !st.isTypeOnly;
      if (value && st.exportClause && ts.isNamedExports(st.exportClause)) {
        const els = st.exportClause.elements;
        if (els.length > 0 && els.every((e) => e.isTypeOnly)) value = false;
      }
      out.push({ spec, value, dynamic: false });
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)) {
      const spec = literal(st.moduleReference.expression);
      if (spec) out.push({ spec, value: !st.isTypeOnly, dynamic: false });
    }
  }
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = literal(n.arguments[0]);
      if (spec) out.push({ spec, value: true, dynamic: true });
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      const spec = literal(n.argument.literal);
      if (spec) out.push({ spec, value: false, dynamic: false });
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** Resolves `@/x`, relative and `@thoremin/<pkg>[/sub]` specifiers to a measured file, or null (a third-party package). */
function makeResolver(root: string, files: ReadonlySet<string>) {
  const packages = new Map<string, { dir: string; exports: Record<string, string> }>();
  for (const d of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    const pj = join(root, 'packages', d.name, 'package.json');
    if (!d.isDirectory() || !existsSync(pj)) continue;
    const json = JSON.parse(readFileSync(pj, 'utf8')) as { name: string; exports?: unknown };
    const exports: Record<string, string> = {};
    if (json.exports && typeof json.exports === 'object') {
      for (const [k, v] of Object.entries(json.exports as Record<string, unknown>)) if (typeof v === 'string') exports[k] = v;
    }
    packages.set(json.name, { dir: join('packages', d.name), exports });
  }
  const asFile = (base: string): string | null => {
    const b = normalize(base).split('\\').join('/');
    for (const c of [b, `${b}.ts`, `${b}.tsx`, `${b}/index.ts`, `${b}/index.tsx`]) if (files.has(c)) return c;
    return null;
  };
  return (from: string, spec: string): string | null => {
    if (spec.startsWith('.')) return asFile(join(dirname(from), spec));
    if (spec.startsWith('@/')) return asFile(join('src', spec.slice(2)));
    const m = spec.match(/^(@thoremin\/[^/]+)(?:\/(.*))?$/);
    if (!m) return null;
    const pkg = packages.get(m[1]);
    if (!pkg) return null;
    const target = pkg.exports[m[2] ? `./${m[2]}` : '.'];
    return target ? asFile(join(pkg.dir, target)) : asFile(join(pkg.dir, 'src', m[2] ?? 'index'));
  };
}

/** The composition root that REGISTERS node implementations (#600 S6): importing a node to put
 *  it in the registry is the registry's job, not a contract fetched from an implementation. */
const REGISTERS_NODES = new Set(['src/host/appRegistry.ts']);

/** A contract module beside a node: importable without the node's implementation. */
const isNodeContract = (file: string): boolean => /\.schema\.ts$/.test(file) || /_contract\.ts$/.test(file);

/** Tarjan's strongly connected components; returns the groups of more than one file (or a file importing itself). */
function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const group: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1 || (graph.get(v) ?? []).includes(v)) out.push(group.sort());
    }
  };
  for (const v of [...graph.keys()].sort()) if (!idx.has(v)) strong(v);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/** The identifier and string-literal tokens of a file's code (comments excluded). */
function codeTokens(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) out.push(n.text);
    else if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push(...n.text.split(/[^A-Za-z0-9_-]+/).filter(Boolean));
    } else if (ts.isJsxText(n)) {
      // Display text, not code.
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

const namedBy = (token: string, name: string): boolean =>
  token === name || (token.startsWith(name) && token.length > name.length && /[A-Z_.\-0-9]/.test(token[name.length]));

/** What `measure` needs besides the tree: the shipped extensions' names and the fold-point count. */
export interface MeasureInputs {
  root: string;
  extensions: readonly ExtensionNames[];
  foldPoints: number;
  /** The files whose line counts are ceilings (the baseline's); absent: the five largest now. */
  largestFiles?: readonly string[];
}

export interface Measured {
  numbers: ArchitectureNumbers;
  /** The details behind each count, for a failure message. */
  detail: {
    nodeImplementationImports: string[];
    extensionNamesInCore: Record<string, string[]>;
    importCycles: string[][];
    runtimeImportCycles: string[][];
  };
}

export function measure({ root, extensions, foldPoints, largestFiles }: MeasureInputs): Measured {
  const files = measuredFiles(root);
  const fileSet = new Set(files);
  const resolve = makeResolver(root, fileSet);
  const parsed = new Map(files.map((f) => [f, parse(root, f)]));

  const nodeImports: string[] = [];
  const all = new Map<string, string[]>();
  const runtime = new Map<string, string[]>();
  for (const [file, sf] of parsed) {
    const edges = importsOf(sf);
    const allTargets: string[] = [];
    const runtimeTargets: string[] = [];
    for (const e of edges) {
      const target = resolve(file, e.spec);
      if (!target) continue;
      allTargets.push(target);
      if (e.value && !e.dynamic) runtimeTargets.push(target);
      const outsideNodes = file.startsWith('src/') && !file.startsWith('src/nodes/') && !REGISTERS_NODES.has(file);
      if (outsideNodes && !LEGACY(file) && e.value && target.startsWith('src/nodes/') && !isNodeContract(target)) nodeImports.push(`${file} -> ${target}`);
    }
    if (!LEGACY(file)) {
      all.set(file, [...new Set(allTargets.filter((t) => !LEGACY(t)))]);
      runtime.set(file, [...new Set(runtimeTargets.filter((t) => !LEGACY(t)))]);
    }
  }

  // In-tree extensions (`src/extensions/`, and the built-in features' slices in `src/slices/`,
  // #600 Phase E) are extensions, not core.
  const core = files.filter((f) => f.startsWith('src/') && !f.startsWith('src/extensions/') && !f.startsWith('src/slices/') && !LEGACY(f));
  const extensionFiles: Record<string, string[]> = {};
  // The flat-slice policy table (`FLAT_SLICES`, #600 S13) names the built-in features' slices BY
  // DESIGN: it is where core says which of them may keep flat keys, and who owns each.
  const named = core.filter((f) => f !== 'src/host/slices.ts');
  const tokensOf = new Map(named.map((f) => [f, codeTokens(parsed.get(f)!)]));
  for (const ext of extensions) {
    extensionFiles[ext.id] = named.filter((f) =>
      tokensOf.get(f)!.some((t) => t === ext.id || ext.names.some((n) => namedBy(t, n))),
    );
  }

  // The file that DEFINES the node (a graph that names it is not the definition).
  const storeControls = files.find((f) => {
    const text = readFileSync(join(root, f), 'utf8');
    return /\bdefineNode\b/.test(text) && /type:\s*'store-controls'/.test(text);
  });
  const storeControlsPorts = storeControls ? (readFileSync(join(root, storeControls), 'utf8').match(/\{\s*name:\s*'[^']+',\s*kind:/g) ?? []).length : 0;

  const useEngine = files.find((f) => /(^|\/)useEngine\.tsx?$/.test(f));
  const reporters = new Set<string>();
  if (useEngine) {
    const sf = parsed.get(useEngine)!;
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
      for (const el of st.importClause.namedBindings.elements) if (/^make\w+Reporter$/.test(el.name.text)) reporters.add(el.name.text);
    }
  }

  const lines = new Map(files.map((f) => [f, readFileSync(join(root, f), 'utf8').split('\n').length]));
  const ceilings = largestFiles ?? [...lines.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([f]) => f);
  const largest: Record<string, number> = {};
  for (const f of ceilings) largest[f] = lines.get(f) ?? 0;

  const allCycles = cycles(all);
  const runtimeCycles = cycles(runtime);
  return {
    numbers: {
      nodeImplementationImports: nodeImports.length,
      extensionNamesInCore: Object.fromEntries(Object.entries(extensionFiles).map(([id, fs]) => [id, fs.length])),
      storeControlsPorts,
      useEngineReporters: reporters.size,
      foldPoints,
      importCycles: allCycles.length,
      runtimeImportCycles: runtimeCycles.length,
      largestFiles: largest,
    },
    detail: {
      nodeImplementationImports: nodeImports,
      extensionNamesInCore: extensionFiles,
      importCycles: allCycles,
      runtimeImportCycles: runtimeCycles,
    },
  };
}

/** The names an extension manifest declares: what core must not spell out. */
export function extensionNames(ext: {
  id: string;
  nodes?: readonly { type: string }[];
  provides?: readonly string[];
  branches: readonly { id: string }[];
  dials: readonly { key: string; kind: string; layout?: 'object' | 'flat'; ports?: readonly { name: string }[] }[];
  transient?: readonly { field: string; kind: string }[];
}): ExtensionNames {
  const names = new Set<string>([
    ...(ext.nodes ?? []).map((n) => n.type),
    ...(ext.provides ?? []),
    ...ext.branches.map((b) => b.id),
    // A FLAT dial slice (#600 S13) is named by its member keys (`midi.enabled`), not its bare key:
    // a built-in feature's key is often a common word (`midi` is also a note number), and its
    // flat keys are what a saved instrument and a command name. Its derived ports count too.
    ...ext.dials.flatMap((d) => [...(d.layout === 'flat' ? flatDialKeys(d as DialSlice) : [d.key]), d.kind, ...(d.ports ?? []).map((p) => p.name)]),
    ...(ext.transient ?? []).flatMap((t) => [t.field, t.kind]),
  ]);
  return { id: ext.id, names: [...names].sort() };
}

