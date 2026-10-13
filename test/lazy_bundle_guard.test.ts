/**
 * The lazy-loading build gate (`vite.lazy-guard.ts`): a lazy-only vendor package in the
 * entry chunk, or in any chunk the entry imports statically, fails the build; the same
 * package in a chunk reached only by a dynamic `import()` passes. Every `vite build` runs
 * the plugin, so the real bundle is checked on every CI build and deploy; this pins the
 * walk itself, and that the orchestra's synth is on the list.
 */
import { describe, expect, it } from 'vitest';
import { findEagerLeaks, LAZY_PACKAGES, packageOf, type ChunkLike } from '../vite.lazy-guard';

const chunk = (fileName: string, modules: string[], extra: Partial<ChunkLike> = {}): ChunkLike => ({
  type: 'chunk',
  fileName,
  modules: Object.fromEntries(modules.map((m) => [m, {}])),
  ...extra,
});

describe('the lazy bundle guard', () => {
  it('names the orchestra synth and the score parsers', () => {
    expect(LAZY_PACKAGES).toEqual(expect.arrayContaining(['spessasynth_lib', 'spessasynth_core', '@tonejs/midi', 'musicxml-io']));
  });

  it('reads the package of a module id, scoped or not, through nested node_modules', () => {
    expect(packageOf('/r/node_modules/spessasynth_lib/dist/index.js')).toBe('spessasynth_lib');
    expect(packageOf('/r/node_modules/@tonejs/midi/dist/Midi.js')).toBe('@tonejs/midi');
    expect(packageOf('/r/node_modules/a/node_modules/spessasynth_core/x.js')).toBe('spessasynth_core');
    expect(packageOf('/r/src/nodes/output/orchestra.ts')).toBeNull();
  });

  it('passes a lazy package that is only in a dynamically imported chunk', () => {
    const bundle = {
      'index.js': chunk('index.js', ['/r/src/main.tsx'], { isEntry: true, imports: ['vendor.js'] }),
      'vendor.js': chunk('vendor.js', ['/r/node_modules/react/index.js']),
      'orchestra_engine.js': chunk('orchestra_engine.js', ['/r/node_modules/spessasynth_lib/dist/index.js']),
    };
    expect(findEagerLeaks(bundle)).toEqual([]);
  });

  it('fails one in the entry chunk or in a chunk the entry imports statically, however deep', () => {
    const bundle = {
      'index.js': chunk('index.js', ['/r/src/main.tsx'], { isEntry: true, imports: ['a.js'] }),
      'a.js': chunk('a.js', ['/r/src/a.ts'], { imports: ['b.js'] }),
      'b.js': chunk('b.js', ['/r/node_modules/spessasynth_lib/dist/index.js']),
    };
    expect(findEagerLeaks(bundle)).toEqual([{ pkg: 'spessasynth_lib', chunk: 'b.js' }]);
  });
});
