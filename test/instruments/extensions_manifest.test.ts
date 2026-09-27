/**
 * PR 6 of the instruments-as-graphs ADR: the extension list is data (`extensions.json`),
 * injected at build time by `vite.extensions.ts`. These tests pin the file against the
 * tree (every named module exists), the generated source, and the running lists.
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listModuleSource, readExtensionEntries } from '../../vite.extensions';
import { EXTENSIONS } from '@/extensions';

const entries = readExtensionEntries(process.env.THOREMIN_EXTENSIONS ?? 'extensions.json');
const fileOf = (spec: string, ext: string): string => `src/${spec.slice(2)}${ext}`;

describe('extensions.json', () => {
  it('names modules that exist, pure and React', () => {
    for (const e of entries) {
      if (e.module.startsWith('@/')) expect(existsSync(fileOf(e.module, '/index.ts')), e.module).toBe(true);
      if (e.ui.startsWith('@/')) expect(existsSync(fileOf(e.ui, '.tsx')), e.ui).toBe(true);
    }
  });

  it('is what the app runs: the injected list has the same ids in the same order', () => {
    expect(EXTENSIONS.map((e) => e.id)).toEqual(entries.map((e) => e.id));
  });

  it('refuses a relative or absolute module path, naming the entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ext-manifest-'));
    const write = (body: unknown): string => {
      const file = join(dir, 'extensions.json');
      writeFileSync(file, JSON.stringify(body));
      return file;
    };
    expect(() => readExtensionEntries(write({ extensions: [{ id: 'a', module: './src/extensions/a', ui: '@/extensions/a/ui' }] }))).toThrow(
      /extensions\[0\]\.module.*module specifier/,
    );
    expect(() => readExtensionEntries(write({ extensions: [{ id: 'a', module: 'pkg-a', ui: '/abs/ui' }] }))).toThrow(/extensions\[0\]\.ui/);
    expect(readExtensionEntries(write({ extensions: [{ id: 'a', module: '@scope/pkg-a', ui: 'pkg-a/ui' }] }))).toHaveLength(1);
    expect(readExtensionEntries(write({ extensions: [] }))).toEqual([]);
  });

  it('generates one default import per entry', () => {
    expect(listModuleSource([{ id: 'a', module: 'pkg-a', ui: 'pkg-a/ui' }, { id: 'b', module: 'pkg-b', ui: 'pkg-b/ui' }], 'ui')).toBe(
      'import e0 from "pkg-a/ui";\nimport e1 from "pkg-b/ui";\nexport default [e0, e1];\n',
    );
    expect(listModuleSource([], 'module')).toBe('\nexport default [];\n');
  });
});
