// @vitest-environment jsdom
/**
 * An extension from OUTSIDE the shipped list reaches every contribution point (#600 S1).
 *
 * The shipped extensions are tested through the points they happen to use; nothing proved that
 * a new extension, listed in a build's manifest, is folded in at each of them. The probe
 * (`test/fixtures/ext-probe/`) uses all of them, eager and lazy, and this file replaces the
 * build's two lists with the probes alone (`vi.doMock` after `vi.resetModules`, the pattern of
 * `lazy_extensions_failures.test.tsx`), then asks each fold point in turn: the node registry,
 * the settings schema, the derivation, the composed graph run headlessly (its voice reaches the
 * synth merge, its transient reaches its node), the seeds, the training routes, the shell tools,
 * the entry points, the editor sections (rendered), the tool panels (rendered), the status hooks
 * (ticked) and the mount effects. Its bundle half is `scripts/check_core_bundle.ts`, which builds
 * a manifest listing only the probes.
 *
 * Later steps of the refactor add each new contribution point to the probe first.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Engine, type NodeRegistry } from '@thoremin/dag';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import type { ExtensionUi, ExtensionUiStub } from '@thoremin/sdk-ui/types';
import { PROBE_BRANCH_ID, PROBE_CHORD, PROBE_ELEMENT_ID, PROBE_EXTENSION, PROBE_INSTRUMENT, PROBE_NODE_ID, PROBE_NODE_TYPE, PROBE_TOOL_ID, PROBE_VOICE_ID } from './fixtures/ext-probe/index';
import { PROBE_UI, probeSeen } from './fixtures/ext-probe/ui';
import { makeRecordingCanvas } from './helpers/canvas';
import { PROBE_LAZY_BRANCH_ID, PROBE_LAZY_ELEMENT_ID, PROBE_LAZY_EXTENSION, PROBE_LAZY_NODE_ID, PROBE_LAZY_NODE_TYPE, PROBE_LAZY_TOOL_ID } from './fixtures/ext-probe/lazy_stub';
import { PROBE_LAZY_UI_STUB } from './fixtures/ext-probe/lazy_ui_stub';

afterEach(cleanup);

const PURE: readonly Extension[] = [
  PROBE_EXTENSION,
  { ...PROBE_LAZY_EXTENSION, load: () => import('./fixtures/ext-probe/lazy').then((m) => m.default) },
];
const UIS: readonly (ExtensionUi | (ExtensionUiStub & { load: () => Promise<ExtensionUi> }))[] = [
  PROBE_UI,
  { ...PROBE_LAZY_UI_STUB, load: () => import('./fixtures/ext-probe/lazy_ui').then((m) => m.default) },
];

type App = {
  registry: typeof import('@/nodes/browser');
  graph: typeof import('@/app/graph');
  schema: typeof import('@/settings/schema');
  seeds: typeof import('@/app/dials/instruments');
  routes: typeof import('@/app/training/routes');
  tools: typeof import('@/app/shellTools');
  entries: typeof import('@/app/entryPoints');
  uis: typeof import('@/app/extensions');
  store: typeof import('@/app/store');
};
let app: App;
/** The lazy probe's React half, as the host loads it (one module instance after the reset). */
let lazyUi: typeof import('./fixtures/ext-probe/lazy_ui');

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('virtual:thoremin/extensions', () => ({ default: PURE }));
  vi.doMock('virtual:thoremin/extensions-ui', () => ({ default: UIS }));
  lazyUi = await import('./fixtures/ext-probe/lazy_ui');
  const [registry, graph, schema, seeds, routes, tools, entries, uis, store] = await Promise.all([
    import('@/nodes/browser'),
    import('@/app/graph'),
    import('@/settings/schema'),
    import('@/app/dials/instruments'),
    import('@/app/training/routes'),
    import('@/app/shellTools'),
    import('@/app/entryPoints'),
    import('@/app/extensions'),
    import('@/app/store'),
  ]);
  app = { registry, graph, schema, seeds, routes, tools, entries, uis, store };
});

describe('the probe reaches every pure contribution point', () => {
  it('nodes: the eager type is registered, the lazy one declared and loaded on demand', async () => {
    const reg: NodeRegistry = app.registry.createAppRegistry();
    expect(reg.get(PROBE_NODE_TYPE).type).toBe(PROBE_NODE_TYPE);
    expect(reg.pending([PROBE_LAZY_NODE_TYPE, PROBE_NODE_TYPE])).toEqual([PROBE_LAZY_NODE_TYPE]);
    await reg.ensure([PROBE_LAZY_NODE_TYPE]);
    expect(reg.pending([PROBE_LAZY_NODE_TYPE])).toEqual([]);
    expect(reg.get(PROBE_LAZY_NODE_TYPE).type).toBe(PROBE_LAZY_NODE_TYPE);
  });

  it('dials: the settings schema and the hot store know the probe dials, with their defaults', () => {
    const shape = app.schema.SettingsSchema.shape as Record<string, { parse: (v: unknown) => unknown }>;
    expect(shape.probe.parse(undefined)).toEqual({ enabled: false, freq: 440 });
    expect(shape.probeLazy.parse(undefined)).toEqual({ enabled: false });
    const settings = app.store.toSettings(app.store.useControls.getState()) as Record<string, unknown>;
    expect(settings.probe).toEqual({ enabled: false, freq: 440 });
    expect(settings.probeLazy).toEqual({ enabled: false });
  });

  it('derive: the probe dials imply their branches, and the branch table lists them', () => {
    expect(app.graph.ALL_BRANCH_IDS).toEqual(expect.arrayContaining([PROBE_BRANCH_ID, PROBE_LAZY_BRANCH_ID]));
    const defaults = app.store.toSettings(app.store.useControls.getState()) as Record<string, unknown>;
    const off = app.graph.branchIdsFor(defaults as never);
    expect(off).not.toContain(PROBE_BRANCH_ID);
    const on = app.graph.branchIdsFor({ ...defaults, probe: { enabled: true, freq: 440 }, probeLazy: { enabled: true } } as never);
    expect(on).toEqual(expect.arrayContaining([PROBE_BRANCH_ID, PROBE_LAZY_BRANCH_ID]));
  });

  it('instruments: the probe seed is seeded after core, with its patch applied', () => {
    const seed = app.seeds.SEED_INSTRUMENTS.find((i) => i.name === PROBE_INSTRUMENT);
    expect(seed).toBeDefined();
    expect(JSON.stringify(seed)).toContain('330');
  });

  it('training: the probe route is known, and its branch leads to it', () => {
    expect(app.routes.routeById('probe')?.tool).toBe(PROBE_TOOL_ID);
    expect(app.routes.trainingRouteFor({ training: undefined, branches: [PROBE_BRANCH_ID], features: [] } as never).id).toBe('probe');
  });
});

describe('the composed graph runs the probe headlessly', () => {
  it("its voice reaches the merge, its dial and its transient reach its node, and the status hooks tick", async () => {
    const reg = app.registry.createAppRegistry();
    await reg.ensure([PROBE_LAZY_NODE_TYPE]);
    const { spec } = app.graph.composeInstrumentGraph([PROBE_BRANCH_ID, PROBE_LAZY_BRANCH_ID], { source: 'synthetic-hands' }, reg);
    expect(spec.nodes.map((n) => n.type)).toEqual(expect.arrayContaining([PROBE_NODE_TYPE, PROBE_LAZY_NODE_TYPE]));

    // The host's hot store, with the probe's dial and transient set the way the app sets them.
    const controls = { ...app.store.useControls.getState(), probe: { enabled: true, freq: 550 }, probeLazy: { enabled: true }, probeModel: { gain: 0.25 } };
    const engine = new Engine(spec, reg, { resources: { controls: () => controls }, validatePorts: true });
    await app.uis.loadExtensionUi('probe-lazy');
    const sinks = app.uis.makeExtensionSinks(engine);
    for (let i = 0; i < 5; i++) {
      engine.tick(i / 30);
      sinks();
    }

    const merged = engine.getOutput('merge', 'params') as { voices: { id: number; freq: number; gain: number }[] };
    const probeVoice = merged.voices.find((v) => v.id === PROBE_VOICE_ID);
    expect(probeVoice).toMatchObject({ freq: 550, gain: 0.25 });
    expect(engine.getOutput(PROBE_NODE_ID, 'level')).toBe(0.25);
    expect(probeSeen.levels.slice(-5)).toEqual([0.25, 0.25, 0.25, 0.25, 0.25]);
    expect(lazyUi.probeLazySeen.ticks.slice(-1)).toEqual([engine.getOutput(PROBE_LAZY_NODE_ID, 'ticks')]);
    expect(lazyUi.probeLazySeen.mounts).toBe(1);
  });
});

describe('the probe contributes a chord producer (#600 S4)', () => {
  it('alone, the composer adds the chord selector and the probe takes its first input', async () => {
    const reg = app.registry.createAppRegistry();
    const { spec } = app.graph.composeInstrumentGraph([PROBE_BRANCH_ID], { source: 'synthetic-hands' }, reg);
    expect(spec.edges).toContainEqual({ from: { node: PROBE_NODE_ID, port: 'chord' }, to: { node: 'chordSel', port: 'a' } });
    expect(spec.edges).toContainEqual({ from: { node: 'chordSel', port: 'chord' }, to: { node: 'overlay', port: 'chord' } });
    const controls = { ...app.store.useControls.getState(), probe: { enabled: true, freq: 440 }, probeModel: { gain: 0.5 } };
    const engine = new Engine(spec, reg, { resources: { controls: () => controls }, validatePorts: true });
    engine.tick(0);
    expect(engine.getOutput('chordSel', 'chord')).toEqual(PROBE_CHORD);
  });

  it('beside the face chords, it takes the next input after them (no core edit)', () => {
    const reg = app.registry.createAppRegistry();
    const { spec } = app.graph.composeInstrumentGraph(['face-chord', 'face-controls', PROBE_BRANCH_ID], { source: 'synthetic-hands' }, reg);
    const into = (from: string) => spec.edges.find((e) => e.from.node === from && e.to.node === 'chordSel')?.to.port;
    expect([into('exprChord'), into('poseChord'), into(PROBE_NODE_ID)]).toEqual(['a', 'b', 'c']);
    // The registry sized the selector for every producer there is (two core, the probe, one spare).
    expect(reg.get('chord-select').inputs.map((p) => p.name)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the probe draws overlay elements (#600 S5)', () => {
  it('the overlay grows the probes\' ports, and both elements draw in the composed graph from their own inputs', async () => {
    const reg = app.registry.createAppRegistry();
    await reg.ensure([PROBE_LAZY_NODE_TYPE]);
    const overlayPorts = reg.get('canvas-overlay').inputs.map((p) => p.name);
    expect(overlayPorts).toEqual(expect.arrayContaining(['probe.meter.level', 'probe.meter.config', 'probe-lazy.badge.ticks']));
    const composed = app.graph.composeInstrumentGraph([PROBE_BRANCH_ID, PROBE_LAZY_BRANCH_ID], { source: 'synthetic-hands' }, reg);
    expect(composed.elements).toEqual(expect.arrayContaining([PROBE_ELEMENT_ID, PROBE_LAZY_ELEMENT_ID]));
    // The meter's config dial arrives from the host, not from the probe's branch.
    expect(composed.spec.edges).toContainEqual({ from: { node: 'ui', port: 'probe' }, to: { node: 'overlay', port: 'probe.meter.config' } });
    const rc = makeRecordingCanvas();
    const controls = { ...app.store.useControls.getState(), probe: { enabled: true, freq: 440 }, probeLazy: { enabled: true }, probeModel: { gain: 0.5 }, graphElements: composed.elements };
    const engine = new Engine(composed.spec, reg, { resources: { controls: () => controls, canvas: rc.canvas, video: rc.video }, validatePorts: true });
    engine.tick(0);
    engine.tick(1 / 30);
    // The meter: a bar half the frame wide (level 0.5) in the probe's colour.
    expect(rc.calls.some((c) => c.m === 'fillRect' && c.args[2] === 640 && c.fill === '#a855f7')).toBe(true);
    // The lazy badge: a cue, laid out on the left edge with the tick count.
    expect(rc.texts().some((t) => /^probe \d+$/.test(t))).toBe(true);
  });

  it('an element the composed set leaves out is never drawn', async () => {
    const reg = app.registry.createAppRegistry();
    const composed = app.graph.composeInstrumentGraph([PROBE_BRANCH_ID], { source: 'synthetic-hands' }, reg);
    const rc = makeRecordingCanvas();
    const controls = { ...app.store.useControls.getState(), probe: { enabled: true, freq: 440 }, probeModel: { gain: 0.5 }, graphElements: composed.elements.filter((e) => e !== PROBE_ELEMENT_ID) };
    const engine = new Engine(composed.spec, reg, { resources: { controls: () => controls, canvas: rc.canvas, video: rc.video } });
    engine.tick(0);
    expect(rc.calls.some((c) => c.fill === '#a855f7')).toBe(false);
  });
});

describe('the probe reaches every React contribution point', () => {
  it('tools and entry points: the shell lists both probe tools, and the entry point is offered in its context', () => {
    const ids = app.tools.SHELL_TOOLS.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([PROBE_TOOL_ID, PROBE_LAZY_TOOL_ID]));
    expect(app.entries.entryPointsFrom(PROBE_TOOL_ID, { probe: true }).map((e) => e.id)).toEqual(['probe-entry']);
    expect(app.entries.entryPointsFrom(PROBE_TOOL_ID, { probe: false })).toEqual([]);
  });

  it('panels: the eager section renders at once, the lazy one after its half loads', async () => {
    const eager = app.uis.EXTENSION_PANELS.find((p) => p.section === 'Probe')!;
    render(<eager.Controls />);
    expect(screen.getByText('probe controls')).toBeTruthy();
    const lazy = app.uis.EXTENSION_PANELS.find((p) => p.section === 'Lazy probe')!;
    await act(async () => {
      render(<lazy.Controls />);
    });
    expect(await screen.findByText('lazy probe controls')).toBeTruthy();
  });

  it('tool panels: both render in the host frame props', async () => {
    const panels = Object.fromEntries(app.uis.EXTENSION_TOOL_PANELS.map((t) => [t.id, t.Panel]));
    const Eager = panels[PROBE_TOOL_ID];
    const Lazy = panels[PROBE_LAZY_TOOL_ID];
    render(<Eager close={() => undefined} />);
    expect(screen.getByText('probe tool panel')).toBeTruthy();
    await act(async () => {
      render(<Lazy close={() => undefined} />);
    });
    expect(await screen.findByText('lazy probe tool panel')).toBeTruthy();
  });

  it('mount effects: the eager effect is listed for the shell, and its cleanup is returned', () => {
    expect(app.uis.EXTENSION_MOUNT_EFFECTS).toHaveLength(1);
    const before = probeSeen.mounts;
    const cleanupFn = app.uis.EXTENSION_MOUNT_EFFECTS[0]();
    expect(probeSeen.mounts).toBe(before + 1);
    expect(typeof cleanupFn).toBe('function');
  });
});
