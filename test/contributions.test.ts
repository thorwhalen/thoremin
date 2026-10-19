/**
 * The contribution registry's combination rules (#600 S3): each keyed contribution point refuses
 * a clash ONCE, in `src/host/contributions.ts` (pure) and `src/app/host/contributions.ts` (React),
 * with an error that names both extensions, instead of every fold point re-doing (or forgetting)
 * the check. The probe extension (`test/fixtures/ext-probe/`) and a twin of it are the clashing
 * pair.
 */
import { describe, expect, it } from 'vitest';
import { defineNode, type NodeDef } from '@thoremin/dag';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { assertNoCoreClash, checkUiDecls, foldContributions, type UiDecls } from '@/host/contributions';
import { PROBE_EXTENSION } from './fixtures/ext-probe/index';
import { PROBE_LAZY_EXTENSION } from './fixtures/ext-probe/lazy_stub';

const probe = PROBE_EXTENSION as unknown as Extension;
const empty = (id: string): Extension => ({ id, branches: [], dials: [], nodes: [], derive: () => [] });
const node = (type: string) => defineNode({ type, inputs: [], outputs: [{ name: 'out', kind: 'number' }], process: () => ({ out: 1 }) }) as unknown as NodeDef<unknown>;

describe('foldContributions', () => {
  it('folds the probes in list order', () => {
    const c = foldContributions([probe, { ...PROBE_LAZY_EXTENSION, load: async () => ({ nodes: [] }) }]);
    expect(c.dialSlices.map((d) => d.key)).toEqual(['probe', 'probeLazy']);
    expect(c.nodeTypes).toEqual(['probe-tone', 'probe-lazy-tone']);
    expect(c.branches.map((b) => b.id)).toEqual(['probe-branch', 'probe-lazy-branch']);
    expect(c.transientFields).toEqual(['probeModel']);
    expect(c.instruments.map((i) => i.name)).toEqual(['Probe Instrument']);
    expect(c.trainingRoutes.map((r) => r.id)).toEqual(['probe']);
    expect(c.trainingByBranch).toEqual([['probe-branch', 'probe']]);
  });

  const twin = (over: Partial<Extension>): Extension => ({ ...empty('probe-twin'), ...over });
  const cases: { point: string; other: Extension; message: RegExp }[] = [
    { point: 'dial key', other: twin({ dials: probe.dials }), message: /extensions "probe" and "probe-twin" both declare the dial key or transient field "probe"/ },
    { point: 'node type (eager)', other: twin({ nodes: [node('probe-tone')] }), message: /extensions "probe" and "probe-twin" both declare the node type "probe-tone"/ },
    { point: 'node type (lazy)', other: twin({ nodes: undefined, provides: ['probe-tone'] }), message: /extensions "probe" and "probe-twin" both declare the node type "probe-tone"/ },
    { point: 'branch', other: twin({ branches: probe.branches }), message: /extensions "probe" and "probe-twin" both declare the branch "probe-branch"/ },
    { point: 'transient field', other: twin({ transient: probe.transient }), message: /both declare the dial key or transient field "probeModel"/ },
    { point: 'a transient named like a dial', other: twin({ transient: [{ field: 'probe', kind: 'x' }] }), message: /both declare the dial key or transient field "probe"/ },
    { point: 'instrument', other: twin({ instruments: probe.instruments }), message: /both declare the instrument "Probe Instrument"/ },
    { point: 'training route', other: twin({ training: { routes: probe.training!.routes, byBranch: [] } }), message: /both declare the training route "probe"/ },
  ];
  it.each(cases)('refuses a clashing $point, naming both extensions', ({ other, message }) => {
    expect(() => foldContributions([probe, other])).toThrow(message);
  });

  it('refuses a key one extension declares twice', () => {
    expect(() => foldContributions([twin({ nodes: [node('a'), node('a')] })])).toThrow(/extension "probe-twin" declares the node type "a" twice/);
  });

  it('assertNoCoreClash refuses an extension id core already uses', () => {
    expect(() => assertNoCoreClash('branch', ['trunk', 'face'], ['probe-branch', 'face'])).toThrow(/declares the branch "face", which core already uses/);
    expect(() => assertNoCoreClash('branch', ['trunk'], ['probe-branch'])).not.toThrow();
  });
});

describe('checkUiDecls', () => {
  const decl = (id: string, over: Partial<Omit<UiDecls, 'id'>> = {}): UiDecls => ({ id, sections: [], tools: [], entryPoints: [], ...over });
  it('accepts distinct declarations', () => {
    expect(() => checkUiDecls([decl('probe', { tools: ['probe-tool'], sections: ['probe / Probe'] }), decl('probe-lazy', { tools: ['probe-lazy-tool'] })])).not.toThrow();
  });
  it.each([
    ['tool', { tools: ['probe-tool'] }, /extensions "probe" and "probe-twin" both declare the tool "probe-tool"/],
    ['entry point', { entryPoints: ['probe-entry'] }, /both declare the entry point "probe-entry"/],
    ['editor section', { sections: ['probe / Probe'] }, /both declare the editor section "probe \/ Probe"/],
  ] as const)('refuses a clashing %s', (_name, over, message) => {
    expect(() => checkUiDecls([decl('probe', over), decl('probe-twin', over)])).toThrow(message);
  });
});
