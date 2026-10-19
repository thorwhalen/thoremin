/**
 * The lazy-loading rule as a build gate (`docs/design/lazy-loading.md`): a heavy vendor
 * library is never in the code a cold load fetches. Every `vite build` (CI, the deploy,
 * `npm run build` here) fails if a module of a package named in {@link LAZY_PACKAGES}
 * is in the entry chunk or in any chunk the entry imports statically: those are what
 * the browser downloads before the first frame. A package behind a dynamic `import()`
 * lands in its own chunk, fetched when the player asks for it, and passes.
 *
 * Read from the bundle itself (each chunk's module ids), so a static import anywhere in
 * the chain is caught, whatever the import looks like. `findEagerLeaks` is the pure half,
 * pinned by `test/lazy_bundle_guard.test.ts`.
 */
import type { Plugin } from 'vite';

/** Packages the app may only load on demand, and who loads them. */
export const LAZY_PACKAGES: readonly string[] = [
  'spessasynth_lib', // the orchestra's synth (#187 PR 5), via src/slices/conductor/app/orchestra_engine.ts
  'spessasynth_core', // its engine core, pulled in by spessasynth_lib
  '@tonejs/midi', // the MIDI score parser (#187 PR 3), via src/slices/conductor/score/midi.ts
  'musicxml-io', // the MusicXML score parser (#187 PR 3), via src/slices/conductor/score/musicxml.ts
  'signalsmith-stretch', // the song's time-stretch worklet (#187 PR 7), via src/slices/song/app/song_stretcher_signalsmith.ts
];

/** The slice of a Rollup output chunk the guard reads. */
export interface ChunkLike {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  imports?: readonly string[];
  modules?: Record<string, unknown>;
}

/** The package a module id belongs to, when it is under node_modules. */
export function packageOf(id: string): string | null {
  const parts = id.replace(/\\/g, '/').split('/node_modules/');
  if (parts.length < 2) return null;
  const rest = parts[parts.length - 1].split('/');
  return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
}

/** Every lazy package found in the entry chunks' static closure, with the chunk it is in. */
export function findEagerLeaks(bundle: Record<string, ChunkLike>, lazy: readonly string[] = LAZY_PACKAGES): { pkg: string; chunk: string }[] {
  const chunks = Object.values(bundle).filter((c): c is ChunkLike & { type: 'chunk' } => c.type === 'chunk');
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const seen = new Set<string>();
  const stack = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
  const leaks: { pkg: string; chunk: string }[] = [];
  while (stack.length) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const c = byName.get(name);
    if (!c) continue;
    const found = new Set<string>();
    for (const id of Object.keys(c.modules ?? {})) {
      const pkg = packageOf(id);
      if (pkg && lazy.includes(pkg)) found.add(pkg);
    }
    for (const pkg of found) leaks.push({ pkg, chunk: name });
    stack.push(...(c.imports ?? []));
  }
  return leaks;
}

export function lazyGuard(lazy: readonly string[] = LAZY_PACKAGES): Plugin {
  return {
    name: 'thoremin-lazy-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const leaks = findEagerLeaks(bundle as unknown as Record<string, ChunkLike>, lazy);
      if (leaks.length) {
        this.error(
          `lazy-only packages are in the code a cold load fetches: ${leaks.map((l) => `${l.pkg} (in ${l.chunk})`).join(', ')}. ` +
            'Reach them only through a dynamic import() of a browser-only module (docs/design/lazy-loading.md).',
        );
      }
    },
  };
}
