/**
 * Body → sound routing (#186 PR E): the pure router, the `body-route` node, the
 * `mods` input on `voice-mapping`, the slot contract, the graph wiring, and the
 * whole path headless — a synthetic body's arm raise driving brightness.
 */
import { describe, it, expect } from 'vitest';
import { Engine, runHeadless } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { createCoreRegistry, voiceMappingNode, type SynthParams } from '@/nodes';
import { bodyRouteMods, DEFAULT_BODY_MAP, NEUTRAL_MODS, BodyMapSchema, HOLD_GRACE_S, type BodyMap } from '@/nodes/mapping/body_map';
import { createFeatureDemand } from '@/features/demand';
import { bodyRouteGroups, startBodyRouteDemand } from '@/app/bodyRouteDemand';
import { MAPPING_SLOT_INPUTS } from '@/nodes/mapping/mapping_contract';
import { SLOTS, defaultGraph } from '@/app/graph';
import { SettingsSchema } from '@/settings/schema';
import { structuredLeafPaths } from '@/app/commands/paths';
import { registry } from '@/app/commands/registry';
import { dialsStore } from '@/app/dials/settingsStore';

const mapWith = (a: Partial<BodyMap['routes']['a']>): BodyMap => ({
  routes: { ...DEFAULT_BODY_MAP.routes, a: { ...DEFAULT_BODY_MAP.routes.a, feature: 'body.kin.qom', target: 'brightness', inMin: 0, inMax: 2, ...a } },
});

describe('bodyRouteMods (pure)', () => {
  it('no routes → neutral mods (byte-identical sound)', () => {
    expect(bodyRouteMods({ 'body.kin.qom': 1 }, DEFAULT_BODY_MAP).mods).toEqual(NEUTRAL_MODS);
  });

  it('normalises [inMin, inMax] to 0..1, clamps, inverts, and smooths across ticks', () => {
    const m = mapWith({ smoothing: 0 });
    expect(bodyRouteMods({ 'body.kin.qom': 1 }, m).mods.brightness).toBeCloseTo(0.5);
    expect(bodyRouteMods({ 'body.kin.qom': 5 }, m).mods.brightness).toBe(1);
    expect(bodyRouteMods({ 'body.kin.qom': -1 }, m).mods.brightness).toBe(0);
    expect(bodyRouteMods({ 'body.kin.qom': 0.5 }, mapWith({ smoothing: 0, invert: true })).mods.brightness).toBeCloseTo(0.75);
    // Smoothing: a one-pole from the previous level, stated per 60 Hz tick and
    // rate-independent: one 1/60 s step or two 1/120 s steps land in the same place.
    const slow = mapWith({ smoothing: 0.5 });
    const first = bodyRouteMods({ 'body.kin.qom': 2 }, slow);
    expect(first.mods.brightness).toBe(1); // no previous level: lands at once
    const second = bodyRouteMods({ 'body.kin.qom': 0 }, slow, first.state, 1 / 60);
    expect(second.mods.brightness).toBeCloseTo(0.5);
    const half = bodyRouteMods({ 'body.kin.qom': 0 }, slow, first.state, 1 / 120);
    const twoHalves = bodyRouteMods({ 'body.kin.qom': 0 }, slow, half.state, 1 / 120);
    expect(twoHalves.mods.brightness).toBeCloseTo(second.mods.brightness, 6);
  });

  it('an absent feature holds its level through the grace, then decays to neutral; never seen → silent', () => {
    const m = mapWith({ smoothing: 0 });
    let st = bodyRouteMods({ 'body.kin.qom': 1.4 }, m).state; // level 0.7
    // Within the grace: held.
    let out = bodyRouteMods({}, m, st, HOLD_GRACE_S / 2);
    expect(out.mods.brightness).toBeCloseTo(0.7);
    // Two seconds later: decayed to (nearly) nothing — no route is left stuck.
    st = out.state;
    for (let i = 0; i < 60; i++) {
      out = bodyRouteMods({}, m, st, 1 / 30);
      st = out.state;
    }
    expect(out.mods.brightness).toBeLessThan(0.05);
    expect(bodyRouteMods({}, m).mods.brightness).toBe(0);
  });

  it('an absent feature decays to the level whose APPLIED value is neutral: gain/gate back to 1, an inverted additive route to 0', () => {
    const gone = (m: BodyMap, present: Record<string, number>) => {
      let st = bodyRouteMods(present, m).state;
      let out = bodyRouteMods(present, m, st, 1 / 30);
      st = out.state;
      for (let i = 0; i < 90; i++) {
        out = bodyRouteMods({}, m, st, 1 / 30);
        st = out.state;
      }
      return out.mods;
    };
    for (const depth of [1, 0.5]) {
      const gain = mapWith({ target: 'gain', smoothing: 0, depth });
      expect(gone(gain, { 'body.kin.qom': 0.5 }).gain).toBeGreaterThan(0.99);
      const gate = mapWith({ target: 'gate', smoothing: 0, depth });
      expect(gone(gate, { 'body.kin.qom': 0.5 }).gate).toBeGreaterThan(0.99);
    }
    const inverted = mapWith({ target: 'vibrato', smoothing: 0, invert: true });
    expect(gone(inverted, { 'body.kin.qom': 2 }).vibrato).toBeLessThan(0.05);
  });

  it('re-targeting a slot starts it fresh instead of smoothing from the old feature', () => {
    const slow = mapWith({ smoothing: 0.9 });
    const st = bodyRouteMods({ 'body.kin.qom': 2 }, slow).state; // level 1 on qom→brightness
    const retargeted: BodyMap = { routes: { ...slow.routes, a: { ...slow.routes.a, feature: 'body.angle.elbow.left', inMin: 0, inMax: 180 } } };
    // Lands at once on the new feature's level, not 90 % of the way to the old one.
    expect(bodyRouteMods({ 'body.angle.elbow.left': 0 }, retargeted, st, 1 / 60).mods.brightness).toBe(0);
  });

  it('routes sharing a target average; gate and gain are multiplicative (1 = no change)', () => {
    const m: BodyMap = {
      routes: {
        a: { feature: 'x', target: 'pan', inMin: 0, inMax: 1, invert: false, smoothing: 0, depth: 1 },
        b: { feature: 'y', target: 'pan', inMin: 0, inMax: 1, invert: false, smoothing: 0, depth: 1 },
        c: { feature: 'z', target: 'gain', inMin: 0, inMax: 1, invert: false, smoothing: 0, depth: 1 },
        d: { ...DEFAULT_BODY_MAP.routes.d },
      },
    };
    const { mods } = bodyRouteMods({ x: 1, y: 0, z: 0.25 }, m);
    expect(mods.pan).toBeCloseTo(0.5);
    expect(mods.gain).toBeCloseTo(0.25);
    expect(mods.gate).toBe(1);
    // Depth: at half depth a resting feature leaves the volume at half, motion adds.
    m.routes.c.depth = 0.5;
    expect(bodyRouteMods({ x: 1, y: 0, z: 0 }, m).mods.gain).toBeCloseTo(0.5);
    expect(bodyRouteMods({ x: 1, y: 0, z: 1 }, m).mods.gain).toBeCloseTo(1);
  });
});

describe('voice-mapping applies mods', () => {
  const feats = {
    right: { present: true, x: 0.5, y: 0.5, wristX: 0.5, wristY: 0.5, openness: 1, pinch: 0, fingers: { index: 0, middle: 0, ring: 0, pinky: 0 } },
    left: { present: false, x: 0, y: 0, wristX: 0, wristY: 0, openness: 0, pinch: 0, fingers: { index: 0, middle: 0, ring: 0, pinky: 0 } },
  };
  const run = (mods?: unknown) => {
    const h = voiceMappingNode.make(voiceMappingNode.params.parse({}));
    const inputs: Record<string, unknown> = { features: feats };
    if (mods) inputs.mods = mods;
    return (h.process(inputs, { tick: 0, time: 0, dt: 0, resources: {} }) as { params: SynthParams }).params.voices[0];
  };
  it('declares the mods port through the slot contract; a missing OR partial mods is a no-op, never NaN', () => {
    expect(MAPPING_SLOT_INPUTS.some((p) => p.name === 'mods')).toBe(true);
    expect(voiceMappingNode.inputs.some((p) => p.name === 'mods')).toBe(true);
    expect(run()).toEqual(run(NEUTRAL_MODS));
    expect(run({})).toEqual(run());
    expect(run({ gain: 0.5 }).gain).toBeCloseTo(run().gain * 0.5);
  });
  it('gain multiplies, brightness adds (clamped), pitch bend and octave fold into the note', () => {
    const base = run();
    expect(run({ ...NEUTRAL_MODS, gain: 0.5 }).gain).toBeCloseTo(base.gain * 0.5);
    expect(run({ ...NEUTRAL_MODS, gate: 0 }).gain).toBe(0);
    expect(run({ ...NEUTRAL_MODS, brightness: -0.4 }).brightness).toBeCloseTo(Math.max(0, (base.brightness ?? 1) - 0.4));
    expect(run({ ...NEUTRAL_MODS, vibrato: 0.4 }).vibrato).toBeCloseTo(Math.min(1, (base.vibrato ?? 0) + 0.4));
    expect(run({ ...NEUTRAL_MODS, octave: 1 }).freq).toBeCloseTo(base.freq * 2);
    expect(run({ ...NEUTRAL_MODS, pitchBend: 1 }).freq).toBeGreaterThan(base.freq);
  });
});

describe('the bodyMap dial', () => {
  it('is a structured dial whose route leaves are path-addressable (dial.setIn)', () => {
    const leaves = structuredLeafPaths();
    expect(leaves).toContain('bodyMap.routes.a.target');
    expect(leaves).toContain('bodyMap.routes.a.feature');
    expect(leaves).toContain('bodyMap.routes.d.inMax');
  });
  it('defaults to no routes in the settings schema (a pre-routing preset stays valid)', () => {
    expect(SettingsSchema.shape.bodyMap.parse(undefined)).toEqual(DEFAULT_BODY_MAP);
    expect(BodyMapSchema.parse(DEFAULT_BODY_MAP)).toEqual(DEFAULT_BODY_MAP);
  });
});

describe('the routes claim the groups they read (the production gate)', () => {
  it('bodyRouteGroups: the groups of the live routes, none when nothing is routed', () => {
    expect(bodyRouteGroups(DEFAULT_BODY_MAP)).toEqual([]);
    expect(bodyRouteGroups(undefined)).toEqual([]);
    expect(bodyRouteGroups(mapWith({}))).toEqual(['body.kin']);
    const two = mapWith({});
    two.routes.b = { ...two.routes.a, feature: 'body.angle.elbow.left', target: 'pan' };
    expect(bodyRouteGroups(two)).toEqual(['body.angle', 'body.kin']);
  });

  it('startBodyRouteDemand claims on a route, releases when the last route clears, and on stop', () => {
    const demand = createFeatureDemand();
    let state: { bodyMap?: BodyMap } = { bodyMap: DEFAULT_BODY_MAP };
    const listeners: Array<(s: { bodyMap?: BodyMap }) => void> = [];
    const store = { getState: () => state, subscribe: (l: (s: { bodyMap?: BodyMap }) => void) => { listeners.push(l); return () => listeners.splice(listeners.indexOf(l), 1); } };
    const stop = startBodyRouteDemand(store, demand);
    expect(demand.groups()).toBeNull();
    state = { bodyMap: mapWith({}) };
    listeners.forEach((l) => l(state));
    expect([...(demand.groups() ?? [])]).toEqual(['body.kin']);
    state = { bodyMap: DEFAULT_BODY_MAP };
    listeners.forEach((l) => l(state));
    expect(demand.groups()).toBeNull();
    state = { bodyMap: mapWith({}) };
    listeners.forEach((l) => l(state));
    stop();
    expect(demand.groups()).toBeNull();
  });

  it('with the Lab CLOSED (production), a configured route still moves the sound — through the demand', async () => {
    // The bug this guards: body-feature-vector computes only claimed groups, and with
    // the Lab closed nothing claimed them, so the route was fed {} every tick and every
    // unit test stayed green (they ran headless, where the gate is always open).
    const demand = createFeatureDemand();
    const map = mapWith({ feature: 'body.angle.shoulder.left', target: 'vibrato', inMin: 0, inMax: 180, smoothing: 0 });
    const controls = { featureLab: { show: false, groups: [] as string[] }, bodyMap: map };
    const stop = startBodyRouteDemand({ getState: () => controls, subscribe: () => () => {} }, demand);
    const reg = createCoreRegistry();
    const spec = {
      nodes: [
        { id: 'b', type: 'synthetic-body', params: { armPeriod: 2, bounceAmount: 0 } },
        { id: 'v', type: 'body-feature-vector', params: {} },
        { id: 'r', type: 'body-route', params: { map } },
      ],
      edges: [
        { from: { node: 'b', port: 'body' }, to: { node: 'v', port: 'body' } },
        { from: { node: 'v', port: 'vector' }, to: { node: 'r', port: 'vector' } },
      ],
    };
    const engine = new Engine(spec, reg, { resources: { controls: () => controls, featureDemand: () => demand.groups() } });
    for (let i = 0; i < 30; i++) engine.tick(i / 30);
    expect((engine.getOutput('r', 'mods') as { vibrato: number }).vibrato).toBeGreaterThan(0.05);
    // And without the claim, the same graph is silent — the failure the demand exists for.
    stop();
    const silent = new Engine(spec, reg, { resources: { controls: () => controls, featureDemand: () => null } });
    for (let i = 0; i < 30; i++) silent.tick(i / 30);
    expect((silent.getOutput('r', 'mods') as { vibrato: number }).vibrato).toBe(0);
  });
});

describe('dial.patch with leaf paths (the fold is atomic and shares dial.setIn\'s rules)', () => {
  const dispatch = (writes: Array<{ key: string; value?: unknown }>) => registry.dispatch('dial.patch', { writes });
  const routeA = () => (dialsStore.getState().effective.bodyMap as BodyMap).routes.a;

  it('a mixed batch (a scalar dial + leaves of a structured dial) lands together', async () => {
    const r = await dispatch([
      { key: 'master.magnetism', value: 0.3 },
      { key: 'bodyMap.routes.a.feature', value: 'body.kin.qom' },
      { key: 'bodyMap.routes.a.target', value: 'pan' },
    ]);
    expect(r.ok).toBe(true);
    expect(dialsStore.getState().effective['master.magnetism']).toBe(0.3);
    expect(routeA()).toMatchObject({ feature: 'body.kin.qom', target: 'pan' });
  });

  it('a bad leaf VALUE anywhere in the batch writes nothing (all-or-nothing)', async () => {
    const before = { magnetism: dialsStore.getState().effective['master.magnetism'], a: routeA() };
    const r = await dispatch([
      { key: 'master.magnetism', value: 0.9 },
      { key: 'bodyMap.routes.a.target', value: 'bogus' },
    ]);
    expect(r.ok).toBe(false);
    expect(dialsStore.getState().effective['master.magnetism']).toBe(before.magnetism);
    expect(routeA()).toEqual(before.a);
  });

  it('an undeclared leaf path is refused with the same code dial.setIn uses', async () => {
    const r = await dispatch([{ key: 'bodyMap.routes.a.bogus', value: 1 }]);
    expect(r.ok).toBe(false);
    expect((r as { error: { code: string } }).error.code).toBe('unknown_path');
    const r2 = await registry.dispatch('dial.setIn', { path: 'bodyMap.routes.a.inMin', value: 'x' });
    expect(r2.ok).toBe(false);
  });

  it('two leaves of one dial fold onto each other (the second sees the first)', async () => {
    const r = await dispatch([
      { key: 'bodyMap.routes.b.inMin', value: 10 },
      { key: 'bodyMap.routes.b.inMax', value: 20 },
    ]);
    expect(r.ok).toBe(true);
    const b = (dialsStore.getState().effective.bodyMap as BodyMap).routes.b;
    expect(b.inMin).toBe(10);
    expect(b.inMax).toBe(20);
  });
});

describe('graph wiring (the reachability guards)', () => {
  it('bodyVec → bodyRoute → map.mods, and ui.bodyMap → bodyRoute.bodyMap', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(has('bodyVec', 'vector', 'bodyRoute', 'vector')).toBe(true);
    expect(has('ui', 'bodyMap', 'bodyRoute', 'bodyMap')).toBe(true);
    expect(has('bodyRoute', 'mods', 'map', 'mods')).toBe(true);
    // The mapping slot's candidate list still satisfies the (grown) contract.
    const reg = createAppRegistry();
    for (const type of SLOTS.mapping.candidates) {
      const def = reg.get(type);
      for (const name of SLOTS.mapping.contract.requiredInputs) expect(def.inputs.some((p) => p.name === name), `${type}.${name}`).toBe(true);
    }
    expect(() => new Engine(defaultGraph(), reg)).not.toThrow();
  });
});

describe('the whole path, headless: a raised arm adds vibrato to the voice', () => {
  it('synthetic body → body-feature-vector → body-route → voice-mapping', async () => {
    // Vibrato rather than brightness: an open hand already sits at full brightness, and
    // an additive mod on a clamped-at-1 base is invisible — vibrato starts from 0.
    const map = mapWith({ feature: 'body.angle.shoulder.left', target: 'vibrato', inMin: 0, inMax: 180, smoothing: 0 });
    const spec = {
      nodes: [
        { id: 'b', type: 'synthetic-body', params: { armPeriod: 2, bounceAmount: 0 } },
        { id: 'v', type: 'body-feature-vector', params: {} },
        { id: 'r', type: 'body-route', params: { map } },
        { id: 'h', type: 'synthetic-hands', params: {} },
        // The synthetic right hand must land on voice 0: no selfie handedness swap here.
        { id: 'f', type: 'hand-features', params: { mirrorHandedness: false } },
        { id: 'm', type: 'voice-mapping', params: { pinchControlsVibrato: false } },
      ],
      edges: [
        { from: { node: 'b', port: 'body' }, to: { node: 'v', port: 'body' } },
        { from: { node: 'v', port: 'vector' }, to: { node: 'r', port: 'vector' } },
        { from: { node: 'h', port: 'hands' }, to: { node: 'f', port: 'hands' } },
        { from: { node: 'f', port: 'features' }, to: { node: 'm', port: 'features' } },
        { from: { node: 'r', port: 'mods' }, to: { node: 'm', port: 'mods' } },
      ],
    };
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 60, nominalDt: 1 / 30, recordOnly: ['r.mods', 'm.params', 'v.vector'] });
    const mods = recorder.values('r.mods') as { vibrato: number }[];
    const vec = recorder.values('v.vector') as Record<string, number>[];
    // The left arm sweeps down→up over 2 s: the mod tracks the shoulder angle.
    const angle = vec.map((v) => v['body.angle.shoulder.left'] / 180);
    for (let i = 5; i < 60; i += 7) expect(mods[i].vibrato).toBeCloseTo(Math.max(0, Math.min(1, angle[i])), 6);
    const b = recorder.values('m.params') as SynthParams[];
    const vib = b.map((p) => p.voices[0].vibrato ?? 0);
    expect(Math.max(...vib) - Math.min(...vib)).toBeGreaterThan(0.3);
  });
});
