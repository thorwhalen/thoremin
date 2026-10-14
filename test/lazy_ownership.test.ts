/**
 * Package ownership for the lazy-bundle check (#342): a library reached through a shared
 * module (an SDK barrel's re-export) that core imports on its own is shared, not the
 * extension's; a library only the extension's own modules import is still owned.
 */
import { describe, expect, it } from 'vitest';
import { closureOf, ownedPackages } from '../scripts/lazy_ownership';

const R = '/r';
const dirOf = (id: string) => (id.startsWith('/r/ext/') ? '/r/ext' : id.startsWith('/r/sdk/') ? '/r/sdk' : id.startsWith('/r/node_modules/') ? id.split('/').slice(0, 4).join('/') : R);
const inPackage = (dir: string, id: string) => dirOf(id) === dir;

/** importer -> imported edges; the helper derives both directions like the build's module graph. */
function graphOf(edges: Record<string, string[]>) {
  const importers = new Map<string, string[]>();
  for (const [from, tos] of Object.entries(edges)) {
    if (!importers.has(from)) importers.set(from, []);
    for (const to of tos) importers.set(to, [...(importers.get(to) ?? []), from]);
  }
  return { importers, edges: (id: string) => edges[id] ?? [] };
}

/** The extension's own package is always owned (the script adds it itself), so it is left out here. */
function owned(edges: Record<string, string[]>, entry: string, extRoots: string[]) {
  const { importers, edges: out } = graphOf(edges);
  const viaExt = closureOf(extRoots, out);
  const coreReach = closureOf([entry], out, (id) => dirOf(id) !== '/r/ext');
  const candidates = new Set([...viaExt].map(dirOf));
  return ownedPackages({ candidates, importersOf: importers, viaExt, coreReach, inPackage, root: R }).filter((d) => d !== '/r/ext').sort();
}

describe('lazy extension package ownership', () => {
  it('a library only the extension imports is owned', () => {
    const edges = {
      '/r/main.ts': ['/r/ext/list.ts'],
      '/r/ext/list.ts': ['/r/ext/nodes/n.ts'],
      '/r/ext/nodes/n.ts': ['/r/node_modules/weights/index.js'],
    };
    expect(owned(edges, '/r/main.ts', ['/r/ext/nodes/n.ts'])).toEqual(['/r/node_modules/weights']);
  });

  it('a library behind a shared module core also imports is shared, even when the extension imports that module through a barrel', () => {
    const edges = {
      '/r/main.ts': ['/r/ext/list.ts', '/r/trainer.ts'],
      '/r/trainer.ts': ['/r/sdk/projection.ts'],
      '/r/sdk/projection.ts': ['/r/node_modules/umap-js/index.js'],
      '/r/ext/list.ts': ['/r/ext/nodes/n.ts'],
      '/r/ext/nodes/n.ts': ['/r/sdk/barrel.ts'],
      '/r/sdk/barrel.ts': ['/r/sdk/projection.ts', '/r/sdk/carve.ts'],
    };
    expect(owned(edges, '/r/main.ts', ['/r/ext/nodes/n.ts'])).toEqual([]);
  });

  it('a library behind a shared module only the extension reaches stays owned with it', () => {
    const edges = {
      '/r/main.ts': ['/r/ext/list.ts'],
      '/r/ext/list.ts': ['/r/ext/nodes/n.ts'],
      '/r/ext/nodes/n.ts': ['/r/ext/lib/x.ts'],
      '/r/ext/lib/x.ts': ['/r/node_modules/ml-matrix/index.js'],
    };
    expect(owned(edges, '/r/main.ts', ['/r/ext/nodes/n.ts'])).toContain('/r/node_modules/ml-matrix');
  });
});
