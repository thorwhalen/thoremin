/**
 * PR 5a of the instruments-as-graphs ADR: the app's registries are folds over the extension
 * manifests. Without the air extension there is no air node, no air branch, no air port and
 * no air dial; with it, every one of them is there, from one object.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Engine } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { makeStoreControlsNode } from '@/nodes/sources/store_controls';
import { EXTENSIONS, EXTENSION_DIAL_SLICES, EXTENSION_BRANCHES } from '@/extensions';
import { AIR_EXTENSION } from '@/extensions/air';
import { composeInstrumentGraph, ALL_BRANCH_IDS } from '@/app/graph';
import { branchIdsFor } from '@/app/graph';
import { SettingsSchema, type Settings, type ExtensionDials } from '@/settings/schema';
import type { AirDrumSettings, AirFluteSettings } from '@/extensions/air/dials';
import { thoreminDials } from '@/settings/dials';
import { SEED_INSTRUMENTS, settingsWithPatch } from '@/app/dials/instruments';
import { TRAINING_ROUTES } from '@/app/training/routes';
import { settingsFromLayer } from '@/app/library/derive';
import { useControls } from '@/app/store';
import { deriveBranchIds } from '@/instruments/derive';
import type { Extension, ExtensionsSettingsShape, LooseExtensionDials } from '@thoremin/sdk/instruments/extension';
import type { BreathStatus } from '@/nodes/output/canvas_overlay';
import { IDLE_AIR_FLUTE_STATUS } from '@/extensions/air/nodes/air_flute';
import { AIR } from '../helpers/extensions';

// The overlay reads the flute's status through a structural slice (it names no extension);
// this pins, at typecheck time, that the flute's status still has those fields.
const _breath: BreathStatus = IDLE_AIR_FLUTE_STATUS;
void _breath;

describe('the extension list', () => {
  it.runIf(AIR)('ships the air extension, whose four instruments are four branches and four dial slices', () => {
    expect(EXTENSIONS.map((e) => e.id)).toEqual(['air']);
    expect(EXTENSION_BRANCHES.map((b) => b.id)).toEqual(['air-drum', 'air-bass', 'air-guitar', 'air-flute']);
    expect(EXTENSION_DIAL_SLICES.map((s) => s.key)).toEqual(['airDrum', 'airBass', 'airGuitar', 'airFlute']);
    expect(ALL_BRANCH_IDS).toEqual(expect.arrayContaining(['trunk', 'field-voices', 'air-drum', 'air-flute']));
  });
});

describe('the registry folds over the extensions', () => {
  it.runIf(AIR)('with the extensions: every air node and the generated ports; without: none of them', () => {
    const withAir = createAppRegistry();
    for (const type of ['air-drum', 'air-bass', 'air-guitar', 'air-flute', 'drum-out', 'pluck-out']) expect(withAir.has(type)).toBe(true);
    const ports = withAir.get('store-controls').outputs.map((p) => p.name);
    expect(ports).toEqual(expect.arrayContaining(['airDrum', 'airBass', 'airGuitar', 'airFlute', 'airGuitarModel', 'airFluteFingerModel', 'airFluteMouthModel']));

    const bare = createAppRegistry([]);
    for (const type of ['air-drum', 'drum-out', 'pluck-out']) expect(bare.has(type)).toBe(false);
    const barePorts = bare.get('store-controls').outputs.map((p) => p.name);
    expect(barePorts).not.toContain('airDrum');
    expect(barePorts).toContain('scaleRight'); // the trunk's hand-written ports stay
  });

  it('the generated ports carry the slice kinds and the transient kinds', () => {
    const node = makeStoreControlsNode([AIR_EXTENSION]);
    const kinds = Object.fromEntries(node.outputs.map((p) => [p.name, p.kind]));
    expect(kinds.airDrum).toBe('air-drum-config');
    expect(kinds.airFlute).toBe('air-flute-config');
    expect(kinds.airGuitarModel).toBe('shape-model');
  });

  it.runIf(AIR)('the settings schema and the dials form carry the extension slices', () => {
    expect(Object.keys(SettingsSchema.shape)).toEqual(expect.arrayContaining(['airDrum', 'airBass', 'airGuitar', 'airFlute']));
    const parsed = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Pentatonic')!.layer);
    expect(parsed.airDrum.enabled).toBe(false);
    expect(parsed.airFlute).toBeDefined();
    void thoreminDials;
  });

  it('the Settings TYPE is computed from the manifests: the air keys, typed by their own schemas', () => {
    // Checked by the strict typecheck (`npm run typecheck` covers test/): the generated list
    // declaration carries each manifest's type, so these hold with no import of air in core.
    expectTypeOf<Settings['airDrum']>().toEqualTypeOf<AirDrumSettings>();
    expectTypeOf<Settings['airFlute']>().toEqualTypeOf<AirFluteSettings>();
    expectTypeOf<keyof ExtensionDials>().toEqualTypeOf<'airDrum' | 'airBass' | 'airGuitar' | 'airFlute'>();
    // @ts-expect-error a key no listed extension declares is not a settings key
    expectTypeOf<Settings['airKazoo']>().toBeNever();
    // A manifest typed loosely (`const x: Extension = ...`) widens its keys to `string`; the fold
    // refuses it as a type rather than letting `Settings` collapse to `unknown`.
    expectTypeOf<ExtensionsSettingsShape<readonly [Extension]>>().toEqualTypeOf<LooseExtensionDials>();
    expectTypeOf<ExtensionsSettingsShape<readonly []>>().toEqualTypeOf<Record<never, never>>();
    expect(Object.keys(SettingsSchema.shape)).toEqual(expect.arrayContaining(EXTENSION_DIAL_SLICES.map((s) => s.key)));
  });

  it('every dial slice of every extension is a key of the settings schema AND of the hot store', () => {
    // The schema, the dials form, store-controls and the hot store all fold over the slices:
    // this pins that they agree, so a second extension cannot get a port and a form field
    // whose value the schema then strips.
    const schemaKeys = Object.keys(SettingsSchema.shape);
    const storeKeys = Object.keys(useControls.getState());
    for (const slice of EXTENSION_DIAL_SLICES) {
      expect(schemaKeys, `SettingsSchema lacks "${slice.key}"`).toContain(slice.key);
      expect(storeKeys, `the hot store lacks "${slice.key}"`).toContain(slice.key);
    }
    for (const t of EXTENSIONS.flatMap((e) => e.transient ?? [])) {
      expect(storeKeys, `the hot store lacks the transient field "${t.field}"`).toContain(t.field);
    }
  });

  it('no extension port reuses a trunk port name', () => {
    const trunk = makeStoreControlsNode([]).outputs.map((p) => p.name);
    const generated = [...EXTENSION_DIAL_SLICES.map((s) => s.key), ...EXTENSIONS.flatMap((e) => (e.transient ?? []).map((t) => t.field))];
    expect(generated.filter((name) => trunk.includes(name))).toEqual([]);
    expect(new Set(generated).size).toBe(generated.length);
  });

  it('an id an extension derives but does not declare is dropped, never composed', () => {
    const table = { knownBranchIds: new Set(['field-voices']), extensions: [{ id: 'bad', derive: () => ['nope', 'field-voices'] }] };
    expect(deriveBranchIds({ handMap: { maxGain: 0 } }, {}, table)).toEqual(['field-voices']);
  });

  it.runIf(AIR)('the derivation asks each extension which of its branches the dials imply', () => {
    const drum = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Air Drum')!.layer);
    expect(branchIdsFor(drum)).toEqual(['air-drum']);
    expect(AIR_EXTENSION.derive(drum)).toEqual(['air-drum']);
  });

  it.runIf(AIR)('an air graph composes and ticks against the folded registry', () => {
    const registry = createAppRegistry();
    const { spec } = composeInstrumentGraph(['air-flute'], { source: 'synthetic-hands' }, registry);
    const engine = new Engine(spec, registry, { validatePorts: true });
    for (let i = 0; i < 5; i++) engine.tick();
    expect(engine.evaluationOrder()).toContain('airFlute');
    engine.dispose();
  });
});

describe('the extensions\' shipped instruments and training routes', () => {
  it('a patch is checked at every depth: a typo throws, naming the path', () => {
    expect(() => settingsWithPatch('Typo', { handMap: { maxGian: 0 } })).toThrow(/handMap\.maxGian/);
    expect(() => settingsWithPatch('Typo', { nope: 1 })).toThrow(/"Typo".*nope/);
    expect(settingsWithPatch('Quiet', { handMap: { maxGain: 0 } }).handMap.maxGain).toBe(0);
  });

  it('names no instrument twice, and no route twice (an extension never shadows core)', () => {
    const names = SEED_INSTRUMENTS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    const routes = TRAINING_ROUTES.map((r) => r.id);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
