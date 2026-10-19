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
import { PROBE_BODY_TYPE, PROBE_SENSE_BRANCH_ID, PROBE_SENSE_GROUP, probeDeriveSaw, PROBE_BRANCH_ID, PROBE_CHORD, PROBE_COMMAND_ID, PROBE_MODALITY_ID, PROBE_STORE, PROBE_ELEMENT_ID, PROBE_EXTENSION, PROBE_INSTRUMENT, PROBE_NODE_ID, PROBE_NODE_TYPE, PROBE_TOOL_ID, PROBE_VOICE_ID, probeToolNeeds } from './fixtures/ext-probe/index';
import { PROBE_UI, probeSeen } from './fixtures/ext-probe/ui';
import { makeRecordingCanvas } from './helpers/canvas';
import { PROBE_LAZY_BRANCH_ID, PROBE_LAZY_COMMAND_ID, PROBE_LAZY_ELEMENT_ID, PROBE_LAZY_KEY, PROBE_LAZY_EXTENSION, PROBE_LAZY_NODE_ID, PROBE_LAZY_NODE_TYPE, PROBE_LAZY_TOOL_ID } from './fixtures/ext-probe/lazy_stub';
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
  category: typeof import('@/app/library/category');
  commands: typeof import('@/app/commands/registry');
  keys: typeof import('@/app/keyboardShortcuts');
  modalities: typeof import('@thoremin/sdk/features/modalities');
  contributions: typeof import('@/host/contributions');
  storage: typeof import('@thoremin/sdk-ui/storage');
  storeControls: typeof import('@/host/storeControls');
  still: typeof import('@/app/stillSounding');
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
  const category = await import('@/app/library/category');
  const [commands, keys, modalities, contributions, storage] = await Promise.all([import('@/app/commands/registry'), import('@/app/keyboardShortcuts'), import('@thoremin/sdk/features/modalities'), import('@/host/contributions'), import('@thoremin/sdk-ui/storage')]);
  const [storeControls, still] = await Promise.all([import('@/host/storeControls'), import('@/app/stillSounding')]);
  app = { registry, graph, schema, seeds, routes, tools, entries, uis, store, category, commands, keys, modalities, contributions, storage, storeControls, still };
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

  it("toolDerive (#600 S15): a tool's need composes the probe's branch, even into an explicit set, after what that set implies", () => {
    const defaults = app.store.toSettings(app.store.useControls.getState()) as Record<string, unknown>;
    const needs = { ...defaults, probeModel: { gain: 0.5 } };
    expect(app.graph.branchIdsFor(needs as never)).toContain(PROBE_BRANCH_ID);
    const explicit = app.graph.branchIdsFor(needs as never, { explicit: ['field-voices'] });
    expect(explicit).toEqual(['field-voices', PROBE_BRANCH_ID]);
    expect(probeToolNeeds.composed).toEqual(['field-voices']);
    expect(app.graph.branchIdsFor({ ...defaults, probeModel: null } as never, { explicit: ['field-voices'] })).toEqual(['field-voices']);
  });

  it('slots (#600 S17): the probe\'s body source joins the shell\'s body slot and a URL picks it', () => {
    expect(app.graph.SLOTS.body.candidates).toContain(PROBE_BODY_TYPE);
    const registry = app.registry.createAppRegistry();
    expect(app.graph.resolveSlot('body', { body: PROBE_BODY_TYPE }, registry, () => {})).toBe(PROBE_BODY_TYPE);
    expect(app.graph.resolveSlot('body', undefined, registry, () => {})).toBe(app.graph.SLOTS.body.default);
  });

  it('demands (#600 S17): a claim on a group the probe\'s branch declares composes it, and the probe\'s derive is told', () => {
    expect(app.graph.branchIdsFor({} as never)).not.toContain(PROBE_SENSE_BRANCH_ID);
    expect(probeDeriveSaw.implied).toEqual([]);
    expect(app.graph.branchIdsFor({} as never, { demanded: new Set([PROBE_SENSE_GROUP]) })).toContain(PROBE_SENSE_BRANCH_ID);
    expect(probeDeriveSaw.implied).toEqual([PROBE_SENSE_BRANCH_ID]);
    // The Lab showing the group does the same while it is open, and nothing once closed.
    expect(app.graph.branchIdsFor({} as never, { featureLab: { show: true, groups: [PROBE_SENSE_GROUP] } as never })).toContain(PROBE_SENSE_BRANCH_ID);
    expect(app.graph.branchIdsFor({} as never, { featureLab: { show: false, groups: [PROBE_SENSE_GROUP] } as never })).not.toContain(PROBE_SENSE_BRANCH_ID);
  });

  it('instruments: the probe seed is seeded after core, with its patch applied', () => {
    const seed = app.seeds.SEED_INSTRUMENTS.find((i) => i.name === PROBE_INSTRUMENT);
    expect(seed).toBeDefined();
    expect(JSON.stringify(seed)).toContain('330');
  });

  it('library (#600 S8): the probe\'s class joins the classes, its row the catalog, and its instrument is listed under it', () => {
    expect(app.category.INSTRUMENT_CLASSES.map((c) => c.id)).toEqual(['field', 'probe-class']);
    expect(app.category.INSTRUMENT_CATALOG.map((r) => r.id)).toEqual(['probe']);
    const settings = { ...app.store.toSettings(app.store.useControls.getState()), probe: { enabled: true, freq: 440 } };
    expect(app.category.airInstrumentsOf(settings as never)).toEqual(['probe']);
    expect(app.category.categoryOf(settings as never)).toBe('probe-class');
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

describe('the probe derives a store-controls port and names what still sounds while muted (#600 S13)', () => {
  it('the bridge emits the derived port from the dial, and its default while the dial is absent', () => {
    const node = app.storeControls.makeStoreControlsNode(PURE);
    expect(node.outputs.map((p) => p.name)).toEqual(expect.arrayContaining(['probe', 'probeFreq']));
    const run = (controls: unknown) => node.make(node.params.parse({})).process({}, { tick: 0, time: 0, dt: 1 / 60, resources: { controls: () => controls } } as never) as Record<string, unknown>;
    const base = app.store.useControls.getState() as unknown as Record<string, unknown>;
    expect(run({ ...base, probe: { enabled: true, freq: 330 } }).probeFreq).toBe(330);
    const { probe: _omit, ...without } = base;
    expect(run(without).probeFreq).toBe(440);
  });

  it('the bridge emits a port derived from a device pref too (#600 S15), and its default while the pref is absent', () => {
    const node = app.storeControls.makeStoreControlsNode(PURE);
    expect(node.outputs.map((p) => p.name)).toContain('probeVolume');
    const run = (controls: unknown) => node.make(node.params.parse({})).process({}, { tick: 0, time: 0, dt: 1 / 60, resources: { controls: () => controls } } as never) as Record<string, unknown>;
    const base = app.store.useControls.getState() as unknown as Record<string, unknown>;
    expect(run({ ...base, probePref: { volume: 0.2 } }).probeVolume).toBe(0.2);
    const { probePref: _omit, ...without } = base;
    expect(run(without).probeVolume).toBe(0.5);
  });

  it('the muted badge names the probe while its dial is on', () => {
    expect(app.still.stillSoundingNote({ probe: { enabled: true } })).toBe(' · probe still on');
    expect(app.still.stillSoundingNote({ probe: { enabled: false } })).toBe('');
  });
});

describe('the probe declares a store (#600 S12)', () => {
  it('the storage-key registry lists it, owned by the probe, and the seam reaches its collection', async () => {
    expect(app.contributions.CONTRIBUTIONS.storageKeys).toContainEqual({ key: PROBE_STORE.legacyKey, kind: 'localStorage', owner: 'probe', purpose: PROBE_STORE.description });
    const { createInMemoryProvider } = await import('@zodal/store');
    const memory = createInMemoryProvider<{ id: string }>([]);
    const previous = app.storage.provideStorage({ collection: (key) => (key === PROBE_STORE.legacyKey ? memory : createInMemoryProvider([])) as never });
    try {
      await app.storage.storage().collection<{ id: string }>(PROBE_STORE).create({ id: 'note' });
      expect((await memory.getList({})).data).toEqual([{ id: 'note' }]);
    } finally {
      app.storage.provideStorage(previous);
    }
  });
});

describe('the probe contributes category readers (#600 S10b)', () => {
  it('the overlay\'s pools are sized for them, and the composer wires each reader and the captions into them', async () => {
    const reg = app.registry.createAppRegistry();
    await reg.ensure([PROBE_LAZY_NODE_TYPE]);
    const overlayPorts = reg.get('canvas-overlay').inputs.map((p) => p.name);
    expect(overlayPorts).toEqual(expect.arrayContaining(['classifier1', 'classifier1Captions', 'categorizer1']));
    expect(overlayPorts).not.toContain('classifier2');
    const { spec } = app.graph.composeInstrumentGraph([PROBE_BRANCH_ID, PROBE_LAZY_BRANCH_ID], { source: 'synthetic-hands' }, reg);
    const into = (port: string) => spec.edges.filter((e) => e.to.node === 'overlay' && e.to.port === port).map((e) => `${e.from.node}.${e.from.port}`);
    expect(into('classifier1')).toEqual([`${PROBE_NODE_ID}.reading`]);
    expect(into('classifier1Captions')).toEqual([`${PROBE_NODE_ID}.captions`]);
    expect(into('categorizer1')).toEqual([`${PROBE_LAZY_NODE_ID}.category`]);
  });

  it('the category cues draw the classifier while it reads, else the categorizer', async () => {
    const reg = app.registry.createAppRegistry();
    await reg.ensure([PROBE_LAZY_NODE_TYPE]);
    const composed = app.graph.composeInstrumentGraph([PROBE_BRANCH_ID, PROBE_LAZY_BRANCH_ID], { source: 'synthetic-hands' }, reg);
    const drawnWith = (gain: number) => {
      const rc = makeRecordingCanvas();
      const controls = { ...app.store.useControls.getState(), probe: { enabled: true, freq: 440 }, probeLazy: { enabled: true }, probeModel: { gain }, graphElements: [...composed.elements, 'categoryLabel', 'categoryBars'] };
      const engine = new Engine(composed.spec, reg, { resources: { controls: () => controls, canvas: rc.canvas, video: rc.video }, validatePorts: true });
      engine.tick(0);
      engine.tick(1 / 30);
      return rc.texts();
    };
    const reading = drawnWith(0.5);
    expect(reading).toContain('P');
    expect(reading).toContain('probe P');
    expect(drawnWith(0)).toContain('mine');
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

describe('the probe contributes commands, a keybinding and a carve modality (#600 S11)', () => {
  it('the palette lists the LAZY probe\'s command before its half loads, and running it loads the half', async () => {
    const listed = app.commands.registry.list().map((c) => c.id);
    expect(listed).toEqual(expect.arrayContaining([PROBE_COMMAND_ID, PROBE_LAZY_COMMAND_ID]));
    expect(app.commands.registry.get(PROBE_LAZY_COMMAND_ID)?.title).toBe('Lazy probe: ping');
    const before = lazyUi.probeLazySeen.pings;
    const result = await app.commands.registry.dispatch(PROBE_LAZY_COMMAND_ID, {});
    expect(result.ok).toBe(true);
    expect(lazyUi.probeLazySeen.pings).toBe(before + 1);
    expect(lazyUi.probeLazySeen.mounts).toBeGreaterThan(0);
  });

  it('the eager probe\'s command runs its own implementation with its parameters', async () => {
    probeSeen.pings.length = 0;
    expect((await app.commands.registry.dispatch(PROBE_COMMAND_ID, { times: 2 })).ok).toBe(true);
    expect(probeSeen.pings).toEqual([2]);
  });

  it('the keymap folds the stub\'s keybinding after core\'s: a repeat is swallowed, a press dispatches', async () => {
    const action = app.keys.DEFAULT_KEYMAP[PROBE_LAZY_KEY];
    expect(action).toBeTypeOf('function');
    const before = lazyUi.probeLazySeen.pings;
    expect(action({ repeat: true } as KeyboardEvent)).toBe(true);
    await Promise.resolve();
    expect(lazyUi.probeLazySeen.pings).toBe(before);
    expect(action({ repeat: false } as KeyboardEvent)).toBe(true);
    await vi.waitFor(() => expect(lazyUi.probeLazySeen.pings).toBe(before + 1));
  });

  it('a keybinding on a key core binds, on a key bound twice, or to no command is refused', () => {
    const { withKeybindings, DEFAULT_KEYMAP } = app.keys;
    const has = (id: string) => id === PROBE_COMMAND_ID;
    expect(() => withKeybindings(DEFAULT_KEYMAP, [{ key: 'm', command: PROBE_COMMAND_ID }], { has })).toThrow(/"m".*already bound by core/);
    expect(() => withKeybindings({}, [{ key: 'x', command: PROBE_COMMAND_ID }, { key: 'x', command: PROBE_COMMAND_ID }], { has })).toThrow(/"x".*already bound/);
    expect(() => withKeybindings({}, [{ key: 'x', command: 'nope' }], { has })).toThrow(/"nope", which no command registers/);
  });

  it('the probe\'s carve modality joins the SDK\'s', () => {
    expect(app.modalities.CARVE_MODALITIES[PROBE_MODALITY_ID]?.id).toBe(PROBE_MODALITY_ID);
    expect(Object.keys(app.modalities.CARVE_MODALITIES)).toEqual(expect.arrayContaining(['face', 'hand', 'body', PROBE_MODALITY_ID]));
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

  it('detached tools (#600 S15): the probe tool runs detached, and the bar marks it running and stops it', async () => {
    expect(app.tools.SHELL_TOOLS.find((t) => t.id === PROBE_TOOL_ID)?.runsDetached).toBe(true);
    expect(app.tools.SHELL_TOOLS.find((t) => t.id === PROBE_LAZY_TOOL_ID)?.runsDetached).toBeUndefined();
    const { default: ToolsBar } = await import('@/app/ToolsBar');
    probeSeen.running = true;
    render(<ToolsBar />);
    const stop = screen.getByLabelText('Stop Probe tool');
    expect(stop.getAttribute('title')).toContain('stop the probe');
    const before = probeSeen.stops;
    act(() => stop.click());
    expect(probeSeen.stops).toBe(before + 1);
  });

  it("tool sections (#600 S15): the probe's section shows in the Conductor's panel while its context matches, and hears its events", async () => {
    const sections = await import('@/app/toolSections');
    expect(sections.toolSectionsFrom('conductor', { 'conductor.conducts': 'recording' }).map((x) => x.id)).toEqual(['probe-section']);
    expect(sections.toolSectionsFrom('conductor', { 'conductor.conducts': 'score' })).toEqual([]);
    render(<sections.ToolSections from="conductor" context={{ 'conductor.conducts': 'recording' }} />);
    expect(screen.getByText('probe section recording')).toBeTruthy();
    // Raised whether or not the section shows: Stop after a switch of mode still reaches it.
    sections.raiseToolEvent('conductor', 'start', { 'conductor.conducts': 'recording' });
    sections.raiseToolEvent('conductor', 'stop', { 'conductor.conducts': 'score' });
    sections.raiseToolEvent('elsewhere', 'start', {});
    expect(probeSeen.events.slice(-2)).toEqual(['start:recording', 'stop:score']);
  });

  it('mount effects: the eager effect is listed for the shell, and its cleanup is returned', () => {
    expect(app.uis.EXTENSION_MOUNT_EFFECTS).toHaveLength(1);
    const before = probeSeen.mounts;
    const cleanupFn = app.uis.EXTENSION_MOUNT_EFFECTS[0]();
    expect(probeSeen.mounts).toBe(before + 1);
    expect(typeof cleanupFn).toBe('function');
  });
});
