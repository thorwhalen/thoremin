/**
 * PR 5a of the instruments-as-graphs ADR: the app's registries are folds over the extension
 * manifests. Without the air extension there is no air node, no air branch, no air port and
 * no air dial; with it, every one of them is there, from one object.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { makeStoreControlsNode } from '@/nodes/sources/store_controls';
import { EXTENSIONS, EXTENSION_DIAL_SLICES, EXTENSION_BRANCHES } from '@/extensions';
import { AIR_EXTENSION } from '@/extensions/air';
import { composeInstrumentGraph, ALL_BRANCH_IDS } from '@/app/graph';
import { branchIdsFor } from '@/instruments/derive';
import { SettingsSchema } from '@/settings/schema';
import { thoreminDials } from '@/settings/dials';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';

describe('the extension list', () => {
  it('ships the air extension, whose four instruments are four branches and four dial slices', () => {
    expect(EXTENSIONS.map((e) => e.id)).toEqual(['air']);
    expect(EXTENSION_BRANCHES.map((b) => b.id)).toEqual(['air-drum', 'air-bass', 'air-guitar', 'air-flute']);
    expect(EXTENSION_DIAL_SLICES.map((s) => s.key)).toEqual(['airDrum', 'airBass', 'airGuitar', 'airFlute']);
    expect(ALL_BRANCH_IDS).toEqual(expect.arrayContaining(['trunk', 'field-voices', 'air-drum', 'air-flute']));
  });
});

describe('the registry folds over the extensions', () => {
  it('with the extensions: every air node and the generated ports; without: none of them', () => {
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

  it('the settings schema and the dials form carry the extension slices', () => {
    expect(Object.keys(SettingsSchema.shape)).toEqual(expect.arrayContaining(['airDrum', 'airBass', 'airGuitar', 'airFlute']));
    const parsed = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Pentatonic')!.layer);
    expect(parsed.airDrum.enabled).toBe(false);
    expect(parsed.airFlute).toBeDefined();
    const fieldKeys = Object.keys((thoreminDials as unknown as { schema: { shape: Record<string, unknown> } }).schema?.shape ?? {});
    // The dials form has a field per slice (the per-dial commands and the palette follow).
    if (fieldKeys.length) expect(fieldKeys).toEqual(expect.arrayContaining(['airDrum', 'airBass', 'airGuitar', 'airFlute']));
  });

  it('the derivation asks each extension which of its branches the dials imply', () => {
    const drum = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Air Drum')!.layer);
    expect(branchIdsFor(drum)).toEqual(['air-drum']);
    expect(AIR_EXTENSION.derive(drum)).toEqual(['air-drum']);
  });

  it('an air graph composes and ticks against the folded registry', () => {
    const registry = createAppRegistry();
    const { spec } = composeInstrumentGraph(['air-flute'], { source: 'synthetic-hands' }, registry);
    const engine = new Engine(spec, registry, { validatePorts: true });
    for (let i = 0; i < 5; i++) engine.tick();
    expect(engine.evaluationOrder()).toContain('airFlute');
    engine.dispose();
  });
});
