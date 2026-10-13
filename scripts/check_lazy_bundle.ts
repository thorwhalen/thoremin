/**
 * A LAZY extension's code is not in the page a player first loads (`docs/design/lazy-extensions.md`).
 *
 * Builds the app from `extensions.json` into a temporary directory, reads the module graph from
 * the bundle itself, and fails unless, for every entry with a `lazy` key:
 *
 *  1. its deferred halves (`lazy.module`, `lazy.ui`) are in no INITIAL chunk (the entry chunk
 *     and what it imports statically), only in chunks the page fetches with `import()`;
 *  2. no module of a package the extension OWNS is initial, except its stubs' own static
 *     closure inside its package, which never includes its `src/nodes/` or `src/lib/`. A package is owned when every module of it that the build
 *     reaches is reached only through the extension (its package, and e.g. a recogniser it
 *     alone depends on, with that recogniser's weights); a package core imports too (the SDK,
 *     zod) is shared, not owned;
 *  3. what the stubs leave in the initial chunks stays under {@link STUB_BUDGET_BYTES};
 *  4. no node the deferred half defines is in the initial chunks, found by its own text (its
 *     description). Rule 2 cannot see a node a stub imports statically (that node is then in
 *     the stubs' closure, which rule 2 allows); this rule does, by content.
 *
 * A library only an extension uses must not be imported by core either; that is the boundary
 * test's rule (`test/extensions_boundary.test.ts`: core imports only the SDK packages), since
 * a core import would make the library look shared here.
 *
 * Generic: nothing here names an extension; it reads `extensions.json`. The cold-load half of
 * the same claim (no request for the chunk until the player asks) is the browser smoke,
 * `smoke/tests/lazy_extension.smoke.ts`.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { build, type Plugin } from 'vite';
import { readExtensionEntries } from '../vite.extensions';

/** What a lazy extension's eager stubs may add to the initial chunks (rendered bytes): its
 *  dial schema, branches as data, instrument seeds and section labels. */
const STUB_BUDGET_BYTES = 16 * 1024;

const ROOT = process.cwd();
const VIRTUAL = ['\0virtual:thoremin/extensions', '\0virtual:thoremin/extensions-ui'];

const lazyEntries = readExtensionEntries(process.env.THOREMIN_EXTENSIONS ?? 'extensions.json').filter((e) => e.lazy);
if (lazyEntries.length === 0) {
  console.log('check_lazy_bundle: no lazy extension listed, nothing to check');
  process.exit(0);
}

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
const packageName = (spec: string): string => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
/** The real directory of an installed package (a workspace link resolves to its source). */
const packageDir = (name: string): string => realpathSync(join(ROOT, 'node_modules', name));

const pkgDirCache = new Map<string, string | null>();
/**
 * The package a module belongs to (null for a virtual module): under `node_modules`, the
 * installed package's root (`node_modules/zod`, never one of its nested `package.json`
 * sub-entries); elsewhere (a workspace package, the app), the nearest `package.json` above it.
 */
function owningPackage(id: string): string | null {
  if (id.startsWith('\0')) return null;
  const nm = id.split('?')[0].match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (nm) return nm[1];
  let dir = dirname(id.split('?')[0]);
  const seen: string[] = [];
  let found: string | null = null;
  while (dir !== dirname(dir)) {
    if (pkgDirCache.has(dir)) {
      found = pkgDirCache.get(dir)!;
      break;
    }
    seen.push(dir);
    if (existsSync(join(dir, 'package.json'))) {
      found = dir;
      break;
    }
    dir = dirname(dir);
  }
  for (const d of seen) pkgDirCache.set(d, found);
  return found;
}

interface Graph {
  importers: Map<string, string[]>;
  imported: Map<string, string[]>;
  dynamic: Map<string, string[]>;
  /** chunk file -> { isEntry, imports (static), modules with rendered bytes } */
  chunks: { file: string; isEntry: boolean; imports: string[]; modules: Record<string, number> }[];
}

const graph: Graph = { importers: new Map(), imported: new Map(), dynamic: new Map(), chunks: [] };
const capture: Plugin = {
  name: 'check-lazy-bundle',
  generateBundle(_options, bundle) {
    for (const id of this.getModuleIds()) {
      const info = this.getModuleInfo(id);
      if (!info) continue;
      graph.importers.set(id, [...info.importers, ...info.dynamicImporters]);
      graph.imported.set(id, [...info.importedIds]);
      graph.dynamic.set(id, [...info.dynamicallyImportedIds]);
    }
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk') continue;
      graph.chunks.push({
        file: chunk.fileName,
        isEntry: chunk.isEntry,
        imports: chunk.imports,
        modules: Object.fromEntries(Object.entries(chunk.modules).map(([id, m]) => [id, m.renderedLength])),
      });
    }
  },
};

const out = mkdtempSync(join(tmpdir(), 'thoremin-lazy-'));
try {
  await build({ build: { outDir: out, emptyOutDir: true }, logLevel: 'warn', plugins: [capture] });

  // The initial chunks: every entry, and what they import statically.
  const byFile = new Map(graph.chunks.map((c) => [c.file, c]));
  const initial = new Set<string>();
  const stack = graph.chunks.filter((c) => c.isEntry).map((c) => c.file);
  while (stack.length) {
    const f = stack.pop()!;
    if (initial.has(f)) continue;
    initial.add(f);
    stack.push(...(byFile.get(f)?.imports ?? []));
  }
  const initialModules = new Map<string, number>();
  for (const f of initial) for (const [id, bytes] of Object.entries(byFile.get(f)!.modules)) initialModules.set(id, bytes);
  const closure = (roots: Iterable<string>, edges: (id: string) => string[], within: (id: string) => boolean = () => true): Set<string> => {
    const seen = new Set<string>();
    const todo = [...roots];
    while (todo.length) {
      const id = todo.pop()!;
      if (seen.has(id) || !within(id)) continue;
      seen.add(id);
      todo.push(...edges(id));
    }
    return seen;
  };
  const allEdges = (id: string) => [...(graph.imported.get(id) ?? []), ...(graph.dynamic.get(id) ?? [])];
  const rel = (id: string) => relative(ROOT, id).split(sep).join('/');

  const failures: string[] = [];
  for (const entry of lazyEntries) {
    const extDir = packageDir(packageName(entry.module));
    const under = (dir: string) => (id: string) => id.startsWith(dir + sep);
    const inExt = under(extDir);
    // The virtual list modules import the stubs statically and the deferred halves dynamically.
    const stubs = VIRTUAL.flatMap((v) => graph.imported.get(v) ?? []).filter(inExt);
    const halves = VIRTUAL.flatMap((v) => graph.dynamic.get(v) ?? []).filter(inExt);
    if (stubs.length !== 2 || halves.length !== 2) {
      failures.push(`${entry.id}: expected 2 stubs and 2 deferred halves from the list modules, found ${stubs.length} and ${halves.length}`);
      continue;
    }
    // 1. The deferred halves are not initial.
    for (const h of halves) if (initialModules.has(h)) failures.push(`${entry.id}: the deferred half ${rel(h)} is in an initial chunk`);

    // 2. Owned packages: every module of the package the build reaches is reached through the
    //    extension (its deferred halves, transitively, or its stubs).
    const viaExt = closure([...halves, ...stubs], allEdges);
    const packages = new Set([...viaExt].map(owningPackage).filter((d): d is string => d !== null));
    const owned = [...packages].filter((dir) => {
      if (dir === ROOT) return false;
      const mods = [...graph.imported.keys()].filter(under(dir));
      return mods.every((m) => (graph.importers.get(m) ?? []).every((i) => viaExt.has(i) || under(dir)(i)));
    });
    if (!owned.includes(extDir)) owned.push(extDir);
    // A stub's closure never reaches the extension's own nodes or libraries (`src/nodes/`,
    // `src/lib/`, the layout every extension follows): a recogniser folded into the extension's
    // package is still deferred-only, so a stub importing it fails here, not just on the budget.
    const deferredOnly = (id: string) => [join(extDir, 'src', 'lib'), join(extDir, 'src', 'nodes')].some((d) => id.startsWith(d + sep));
    const stubClosure = closure(stubs, (id) => graph.imported.get(id) ?? [], (id) => inExt(id) && !deferredOnly(id));
    let stubBytes = 0;
    for (const [id, bytes] of initialModules) {
      if (!owned.some((d) => under(d)(id))) continue;
      if (stubClosure.has(id)) {
        stubBytes += bytes;
        continue;
      }
      failures.push(`${entry.id}: ${rel(id)} (${bytes} B) is in an initial chunk but only the extension needs it`);
    }
    // 4. No deferred node's code is initial, whatever imported it.
    const deferred = (await import(/* @vite-ignore */ entry.lazy!.module)) as { default: { nodes: readonly { type: string; description?: string }[] } };
    const initialJs = [...initial].map((f) => readFileSync(join(out, f), 'utf8')).join('\n');
    for (const n of deferred.default.nodes) {
      const text = n.description ?? '';
      if (text.length < 24) {
        failures.push(`${entry.id}: node "${n.type}" needs a description of at least 24 characters (it is how this check finds its code)`);
        continue;
      }
      if (initialJs.includes(text) || initialJs.includes(JSON.stringify(text).slice(1, -1))) {
        failures.push(`${entry.id}: the code of node "${n.type}" is in an initial chunk`);
      }
    }
    // 3. The stubs stay small.
    if (stubBytes > STUB_BUDGET_BYTES) failures.push(`${entry.id}: its stubs put ${stubBytes} B in the initial chunks (budget ${STUB_BUDGET_BYTES} B)`);

    const deferredChunks = graph.chunks.filter((c) => !initial.has(c.file) && Object.keys(c.modules).some((id) => owned.some((d) => under(d)(id))));
    const deferredBytes = deferredChunks.reduce((n, c) => n + Object.values(c.modules).reduce((a, b) => a + b, 0), 0);
    console.log(
      `${entry.id}: lazy. Initial: ${stubBytes} B of stubs (${[...stubClosure].filter((id) => initialModules.has(id)).map(rel).join(', ')}). ` +
        `Deferred: ${deferredChunks.length} chunks, ${(deferredBytes / 1024).toFixed(1)} kB (${deferredChunks.map((c) => c.file).join(', ')}). ` +
        `Owned packages: ${owned.map(rel).join(', ')}.`,
    );
  }
  if (failures.length) {
    console.error(`check_lazy_bundle: FAIL\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('check_lazy_bundle: OK');
} finally {
  rmSync(out, { recursive: true, force: true });
}
