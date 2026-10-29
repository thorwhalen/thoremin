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
  // The song model and its note text (pure: arithmetic and a type import of the score schema).
  'packages/sdk/src/score/song.ts',
  'packages/sdk-ui/src/audio/',
];

/**
 * What one page may load beyond {@link ALLOWED}, and its own budget. The Sound mapper keeps the
 * player's sounds (a Zod-checked record in a zodal collection, held by a vanilla zustand store), so
 * it carries its package, the SDK's named-collection store and those three libraries; still nothing
 * of the app (docs/design/apps.md).
 */
export const PAGE_EXTRAS: Readonly<Record<string, { allowed: readonly string[]; budgetBytes: number }>> = {
  'sound-mapper': {
    allowed: [
      'packages/sound-mapper/src/',
      'packages/sdk-ui/src/namedCollection.ts',
      'packages/sdk-ui/src/storage.ts',
      'packages/sdk/src/util/ids.ts',
      'node_modules/zod/',
      'node_modules/zustand/',
      'node_modules/@zodal/store/',
      'node_modules/@zodal/store-localstorage/',
    ],
    // Zod is most of it (about 190 kB as rendered, before gzip); the app it guards against is megabytes.
    budgetBytes: 300_000,
  },
};

/**
 * The most a page may load up front, bytes as the build ships them. Raised from 60 kB when the field
 * games' stage learned the road (the Pitch Maze's higher levels): a page now carries one or two
 * stages and its game, 40 to 65 kB; what this guards against is the app (megabytes) leaking in.
 */
export const BUDGET_BYTES = 80_000;

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
const allowed = (id: string, page: string) => id.startsWith('\0vite/') || [...ALLOWED, ...(PAGE_EXTRAS[page]?.allowed ?? [])].some((p) => rel(id).startsWith(p));

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
    const strays = [...modules.keys()].filter((id) => !allowed(id, page));
    const budget = PAGE_EXTRAS[page]?.budgetBytes ?? BUDGET_BYTES;
    const bytes = [...modules.values()].reduce((a, b) => a + b, 0);
    console.log(`play/${page}.html: ${modules.size} modules, ${(bytes / 1000).toFixed(1)} kB in ${files.size} chunk(s)`);
    for (const id of strays) {
      console.error(`  NOT ALLOWED: ${rel(id)}\n    via ${chainTo(id, inPage).join(' -> ')}`);
      failed = true;
    }
    if (bytes > budget) {
      console.error(`  over budget: ${bytes} > ${budget} bytes`);
      failed = true;
    }
    if (process.argv.includes('--list')) for (const [id, n] of [...modules].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(7)}  ${rel(id)}`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log('check_play_bundle: every page carries only what a game needs');
