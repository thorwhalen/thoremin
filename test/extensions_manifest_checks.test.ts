/**
 * The manifest checks `src/extensions/index.ts` runs on the list `extensions.json` injects
 * (#391 item 1). The virtual module's type is only a declaration, so a malformed entry reaches
 * the app at run time; `checked()` must refuse it at import with a message that names the
 * entry and what is wrong, never let it through to fail later somewhere obscure.
 *
 * Each case replaces the virtual list with one malformed entry and imports the module afresh.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineNode } from '@thoremin/dag';
import { defineExtension, type Extension } from '@thoremin/sdk/instruments/extension';

const base = (id: string) => defineExtension({ id, branches: [], dials: [] as const, derive: () => [] });
const node = (type: string) => defineNode({ type, inputs: [], outputs: [{ name: 'out', kind: 'number' }], process: () => ({ out: 1 }) });
const load = async () => ({ nodes: [] });

/** Import `src/extensions` with `listed` as the build's extension list. */
async function importWith(listed: readonly unknown[]): Promise<{ EXTENSIONS: readonly Extension[] }> {
  vi.resetModules();
  vi.doMock('virtual:thoremin/extensions', () => ({ default: listed }));
  return import('@/extensions');
}

afterEach(() => {
  vi.doUnmock('virtual:thoremin/extensions');
});

describe('checked(): a malformed extensions.json entry is refused at import', () => {
  const cases: { name: string; listed: readonly unknown[]; error: RegExp }[] = [
    { name: 'a listed module with no default export', listed: [undefined], error: /entry 0 does not default-export an Extension \(id, branches, dials\)/ },
    { name: 'an entry missing its branches', listed: [{ id: 'nobranches', dials: [], nodes: [] }], error: /entry 0 does not default-export an Extension/ },
    {
      name: 'a "lazy" entry whose manifest names no `provides`',
      listed: [{ ...base('lazy-no-provides'), load }],
      error: /"lazy-no-provides" has a "lazy" entry but its manifest names no `provides`/,
    },
    {
      name: '`provides` with no "lazy" entry to load them from',
      listed: [{ ...base('provides-no-lazy'), provides: ['x'] }],
      error: /"provides-no-lazy" names `provides` \(a lazy extension's stub\) but has no "lazy" entry/,
    },
    {
      name: 'a lazy stub that also carries `nodes`',
      listed: [{ ...base('lazy-with-nodes'), provides: ['x'], load, nodes: [node('x')] }],
      error: /"lazy-with-nodes" must have either `nodes` \(eager\) or `provides` and no `nodes` \(lazy\)/,
    },
    {
      name: 'an eager extension with no `nodes`',
      listed: [{ ...base('eager-no-nodes'), nodes: undefined }],
      error: /"eager-no-nodes" must have either `nodes` \(eager\) or `provides` and no `nodes` \(lazy\)/,
    },
  ];

  it.each(cases)('$name', async ({ listed, error }) => {
    await expect(importWith(listed)).rejects.toThrow(error);
  });

  it('names the offending entry by its position', async () => {
    await expect(importWith([{ ...base('fine'), nodes: [] }, null])).rejects.toThrow(/entry 1 /);
  });

  it('accepts a well-formed eager and a well-formed lazy (tool-only) extension', async () => {
    const eager = { ...base('eager-ok'), nodes: [node('eager-ok-node')] };
    const lazy = { ...base('lazy-ok'), provides: [], load };
    const { EXTENSIONS } = await importWith([eager, lazy]);
    expect(EXTENSIONS.map((e) => e.id)).toEqual(['eager-ok', 'lazy-ok']);
  });
});
