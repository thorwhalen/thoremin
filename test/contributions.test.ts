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
import { assertNoCoreClash, checkUiDecls, foldContributions, loadExtensionNodes, overlayConfigEdges, type UiDecls } from '@/host/contributions';
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
    { point: 'dial key', other: twin({ dials: probe.dials }), message: /extensions "probe" and "probe-twin" both declare the dial key, pref or transient field "probe"/ },
    { point: 'node type (eager)', other: twin({ nodes: [node('probe-tone')] }), message: /extensions "probe" and "probe-twin" both declare the node type "probe-tone"/ },
    { point: 'node type (lazy)', other: twin({ nodes: undefined, provides: ['probe-tone'] }), message: /extensions "probe" and "probe-twin" both declare the node type "probe-tone"/ },
    { point: 'branch', other: twin({ branches: probe.branches }), message: /extensions "probe" and "probe-twin" both declare the branch "probe-branch"/ },
    { point: 'transient field', other: twin({ transient: probe.transient }), message: /both declare the dial key, pref or transient field "probeModel"/ },
    { point: 'a transient named like a dial', other: twin({ transient: [{ field: 'probe', kind: 'x' }] }), message: /both declare the dial key, pref or transient field "probe"/ },
    { point: 'instrument', other: twin({ instruments: probe.instruments }), message: /both declare the instrument "Probe Instrument"/ },
    { point: 'training route', other: twin({ training: { routes: probe.training!.routes, byBranch: [] } }), message: /both declare the training route "probe"/ },
  ];
  it.each(cases)('refuses a clashing $point, naming both extensions', ({ other, message }) => {
    expect(() => foldContributions([probe, other])).toThrow(message);
  });

  it('folds the overlay elements with their ports, kinds and config (#600 S5)', () => {
    const [meter] = foldContributions([probe]).overlayElements;
    expect(meter).toMatchObject({ id: 'probe/meter', extension: 'probe', ports: { level: 'probe.meter.level', config: 'probe.meter.config' }, kinds: { level: 'number', config: 'probe-config' } });
    expect(meter.impl()?.name).toBe('meter');
  });

  it('refuses an overlay element declared twice, and one whose config dial is not its own', () => {
    const element = probe.overlay![0];
    expect(() => foldContributions([probe, twin({ id: 'probe', overlay: [element], overlayElements: probe.overlayElements })])).toThrow(/declares the overlay element "probe\/meter"/);
    expect(() => foldContributions([twin({ overlay: [{ ...element, config: { dialKey: 'probe' } }], overlayElements: probe.overlayElements })])).toThrow(/reads its config from the dial "probe", which is not one of its own/);
  });

  it('refuses overlay names that would build clashing ports, a reserved `config` input and an input declared twice', () => {
    const el = { name: 'bar', category: 'output' as const, inputs: [{ name: 'x', kind: 'number' }] };
    const impl = { name: 'bar', draw: () => undefined };
    expect(() => foldContributions([twin({ overlay: [{ ...el, name: 'b.ar' }], overlayElements: [{ ...impl, name: 'b.ar' }] })])).toThrow(/may not contain "\." or "\/": "b\.ar"/);
    expect(() => foldContributions([twin({ id: 'a/b', overlay: [el], overlayElements: [impl] })])).toThrow(/may not contain/);
    expect(() => foldContributions([twin({ overlay: [{ ...el, inputs: [{ name: 'config', kind: 'x' }] }], overlayElements: [impl] })])).toThrow(/"config", which is reserved/);
    expect(() => foldContributions([twin({ overlay: [{ ...el, inputs: [el.inputs[0], el.inputs[0]] }], overlayElements: [impl] })])).toThrow(/declares an input twice/);
  });

  it('refuses an eager extension whose drawing code does not match its declarations', () => {
    const el = { name: 'bar', category: 'output' as const, inputs: [] };
    expect(() => foldContributions([twin({ overlay: [el] })])).toThrow(/"bar" is declared but has no implementation/);
    expect(() => foldContributions([twin({ overlay: [el], overlayElements: [{ name: 'baz', draw: () => undefined }, { name: 'bar', draw: () => undefined }] })])).toThrow(/"baz" matches no declared element/);
  });

  it('a lazy element has no drawing code until its half loads, then has it; a half missing one fails to load and can be retried', async () => {
    const el = { name: 'bar', category: 'output' as const, inputs: [] };
    let good = false;
    const lazy: Extension = {
      ...empty('lazy-overlay-probe'),
      nodes: undefined,
      provides: [],
      overlay: [el],
      load: async () => ({ nodes: [], overlayElements: good ? [{ name: 'bar', draw: () => undefined }] : [] }),
    };
    const [contributed] = foldContributions([lazy]).overlayElements;
    expect(contributed.impl()).toBeUndefined();
    await expect(loadExtensionNodes(lazy)).rejects.toThrow(/"bar" is declared but has no implementation/);
    expect(contributed.impl()).toBeUndefined();
    good = true;
    await loadExtensionNodes(lazy);
    expect(contributed.impl()?.name).toBe('bar');
  });

  it('delivers a composed element\'s config from its own dial, and refuses a branch edge into a config port', () => {
    const [meter] = foldContributions([probe]).overlayElements;
    const nodes = { ui: 'ui', overlay: 'overlay' };
    expect(overlayConfigEdges({ elements: ['probe/meter'], edges: [] }, [meter], nodes)).toEqual([{ from: { node: 'ui', port: 'probe' }, to: { node: 'overlay', port: 'probe.meter.config' } }]);
    expect(overlayConfigEdges({ elements: [], edges: [] }, [meter], nodes)).toEqual([]);
    const stray = { from: { node: 'ui', port: 'overlay' }, to: { node: 'overlay', port: 'probe.meter.config' } };
    expect(() => overlayConfigEdges({ elements: ['probe/meter'], edges: [stray] }, [meter], nodes)).toThrow(/feeds the overlay element config port "probe\.meter\.config"/);
  });

  it('folds classes and catalog rows (#600 S8), and refuses a class core owns, a row twice, or a row of an unknown class', () => {
    const c = foldContributions([probe]);
    expect(c.classes.map((k) => k.id)).toEqual(['probe-class']);
    expect(c.catalog.map((r) => r.id)).toEqual(['probe']);
    const field = { id: 'field', label: 'F', emoji: 'f', colour: 'red' };
    expect(() => foldContributions([twin({ classes: [field] })])).toThrow(/declares the instrument class "field", which core already declares/);
    expect(() => foldContributions([probe, twin({ catalog: probe.catalog })])).toThrow(/both declare the catalog row "probe"/);
    expect(() => foldContributions([twin({ catalog: [{ ...probe.catalog![0], id: 'x', class: 'brass' }] })])).toThrow(/the class "brass", which no extension and not core declares/);
  });

  it('core names no extension\'s library rows: an extension that declares none contributes none (#600 S8, the contract step)', () => {
    const asl = (over: Partial<Extension> = {}): Extension => ({ ...empty('asl'), ...over });
    expect(foldContributions([asl()]).classes).toEqual([]);
    expect(foldContributions([asl()]).catalog).toEqual([]);
    const own = foldContributions([asl({ classes: [{ id: 'sign', label: 'Signs', emoji: 's', colour: 'x' }], catalog: [] })]);
    expect(own.classes.map((k) => k.label)).toEqual(['Signs']);
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
