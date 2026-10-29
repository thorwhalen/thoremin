/**
 * A standalone game page carries only what a game needs (`play/`: the pages and their code in `play/src/`).
 *
 * Builds the app (whose build also emits every page in `play/pages.ts`), reads the module graph
 * from the bundle, and fails unless every module a page loads up front (its entry chunk and the
 * chunks that imports statically) is under one of {@link ALLOWED}: the games, the judge and its
 * statistics, the SDK's pure audio and timing modules, the audio-input hub and its browser half,
 * and the page's own code (no Zod: the shipped lessons are built without it). So a page that reached the graph engine, React, the hot store, a
 * camera model or an extension fails here, by name, with the import chain that pulled it in.
 * It also prints each page's minified-by-the-build size, and fails past {@link BUDGET_BYTES}.
 *
 * The audio worklet is not a chunk of the page (a separate `?worker&url` asset, bundled on its
 * own from `src/audio/audio_in.worklet.ts`), so it is outside this check; it imports only the
 * SDK's processor core.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import { PLAY_PAGES } from '../play/pages';

const ROOT = resolve(__dirname, '..');

/** Where a page's modules may come from (relative to the repository root). */
export const ALLOWED: readonly string[] = [
  'play/',
  'src/audio/',
  'packages/games/src/',
  'packages/judge/src/',
  'packages/stats/src/',
  'packages/sdk/src/audio/',
  'packages/sdk/src/timing/input_stage.ts',
  'packages/sdk-ui/src/audio/',
];

/** The most a page may load up front, bytes as the build ships them. */
export const BUDGET_BYTES = 60_000;

interface Chunk {
  file: string;
  facade: string | null;
  imports: string[];
  modules: Record<string, number>;
}

const chunks: Chunk[] = [];
const importers = new Map<string, string[]>();
const capture: Plugin = {
  name: 'check-play-bundle',
  generateBundle(_options, bundle) {
    for (const id of this.getModuleIds()) {
      const info = this.getModuleInfo(id);
      if (info) importers.set(id, [...info.importers]);
    }
    for (const c of Object.values(bundle)) {
      if (c.type !== 'chunk') continue;
      chunks.push({ file: c.fileName, facade: c.facadeModuleId ?? null, imports: c.imports, modules: Object.fromEntries(Object.entries(c.modules).map(([id, m]) => [id, m.renderedLength])) });
    }
  },
};

const rel = (id: string) => relative(ROOT, id.replace(/^\0/, '').split('?')[0]);
const allowed = (id: string) => id.startsWith('\0vite/') || ALLOWED.some((p) => rel(id).startsWith(p));

/** The chain of importers from a page's entry to `id`, for the failure message. */
function chainTo(id: string, inPage: Set<string>): string[] {
  const chain = [id];
  const seen = new Set(chain);
  let at = id;
  for (;;) {
    const next = (importers.get(at) ?? []).find((i) => inPage.has(i) && !seen.has(i));
    if (!next) return chain.map(rel);
    chain.unshift(next);
    seen.add(next);
    at = next;
  }
}

const out = mkdtempSync(join(tmpdir(), 'thoremin-play-'));
let failed = false;
try {
  await build({ root: ROOT, logLevel: 'warn', build: { outDir: out, emptyOutDir: true }, plugins: [capture] });
  const byFile = new Map(chunks.map((c) => [c.file, c]));
  for (const page of PLAY_PAGES) {
    const html = resolve(ROOT, 'play', `${page}.html`);
    const entry = chunks.find((c) => c.facade === html);
    if (!entry) {
      console.error(`check_play_bundle: no entry chunk for play/${page}.html`);
      failed = true;
      continue;
    }
    const files = new Set<string>();
    const todo = [entry.file];
    while (todo.length) {
      const f = todo.pop()!;
      if (files.has(f)) continue;
      files.add(f);
      todo.push(...(byFile.get(f)?.imports ?? []));
    }
    const modules = new Map<string, number>();
    for (const f of files) for (const [id, n] of Object.entries(byFile.get(f)!.modules)) modules.set(id, n);
    const inPage = new Set(modules.keys());
    const strays = [...modules.keys()].filter((id) => !allowed(id));
    const bytes = [...modules.values()].reduce((a, b) => a + b, 0);
    console.log(`play/${page}.html: ${modules.size} modules, ${(bytes / 1000).toFixed(1)} kB in ${files.size} chunk(s)`);
    for (const id of strays) {
      console.error(`  NOT ALLOWED: ${rel(id)}\n    via ${chainTo(id, inPage).join(' -> ')}`);
      failed = true;
    }
    if (bytes > BUDGET_BYTES) {
      console.error(`  over budget: ${bytes} > ${BUDGET_BYTES} bytes`);
      failed = true;
    }
    if (process.argv.includes('--list')) for (const [id, n] of [...modules].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(7)}  ${rel(id)}`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log('check_play_bundle: every page carries only what a game needs');
