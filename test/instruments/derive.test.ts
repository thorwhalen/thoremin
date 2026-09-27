/**
 * PR 3 of the instruments-as-graphs ADR: the branch set an instrument's dials and the live
 * demand imply (§3.4's derivation column), and the property the review asked for: every
 * shipped seed × every demand combination composes into a graph that compiles and ticks
 * with no host resources.
 */
import { describe, expect, it } from 'vitest';
import { Engine, StreamRecorder } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { FACE_GROUP_IDS, BODY_GROUP_IDS, defaultFeatureLab } from '@/features/labConfig';
import { branchIdsFor } from '@/app/graph';
import { branchSetKey, type DerivationContext, type StrictDerivationSettings } from '@/instruments/derive';
import type { ControlState } from '@/app/store';

// The hot store is read by the derivation inside a zustand selector (useEngine); this pins,
// at typecheck time, that every dial the derivation reads exists on the store under that
// name, so a rename cannot silently derive "off" (the runtime shape is optional on purpose).
const _controlStateDerives: StrictDerivationSettings = null as unknown as ControlState;
void _controlStateDerives;
import { composeInstrumentGraph } from '@/app/graph';
import type { SynthParams } from '@/nodes';

const seedSettings = (name: string) => {
  const seed = SEED_INSTRUMENTS.find((s) => s.name === name);
  if (!seed) throw new Error(`no seed named ${name}`);
  return settingsFromLayer(seed.layer);
};

const ids = (name: string, ctx?: DerivationContext) => branchIdsFor(seedSettings(name), ctx).sort();

describe('branchIdsFor: the dials imply the branches', () => {
  it('the default field instrument is the hand voices and nothing else', () => {
    expect(ids('Pentatonic')).toEqual(['field-voices']);
  });

  it('a face-chord instrument gets the face source and the chord branch; a timbre one the timbre edge', () => {
    expect(ids('Glass Bells')).toEqual(['face-chord', 'face-source', 'field-voices']);
    expect(ids('Everything')).toEqual(['face-source', 'face-timbre', 'field-voices']);
  });

  it('the air drum, bass and guitar have no face and no hand voices', () => {
    expect(ids('Air Drum')).toEqual(['air-drum']);
    expect(ids('Air Bass')).toEqual(['air-bass']);
    expect(ids('Air Guitar')).toEqual(['air-guitar']);
  });

  it('the air flute alone has no face source; a mouth-group demand (its breath) brings it in', () => {
    expect(ids('Air Flute')).toEqual(['air-flute']);
    const demanded = new Set(['face.geom.mouth']);
    expect(ids('Air Flute', { demanded })).toEqual(['air-flute', 'face-source']);
  });

  it('a field instrument with a drum added keeps its hand voices (the class never decides)', () => {
    const s = seedSettings('Pentatonic');
    const withDrum = { ...s, airDrum: { ...s.airDrum, enabled: true } };
    expect(branchIdsFor(withDrum).sort()).toEqual(['air-drum', 'field-voices']);
  });

  it('the Lab showing a face group, or a face-group claim, implies the face source; the body likewise', () => {
    const lab = { ...defaultFeatureLab(), show: true, groups: [FACE_GROUP_IDS[0]] };
    expect(ids('Pentatonic', { featureLab: lab })).toContain('face-source');
    expect(ids('Pentatonic', { demanded: new Set([BODY_GROUP_IDS[0]]) })).toContain('body-source');
    expect(ids('Pentatonic', { demanded: new Set(['hand.geom.spread']) })).toEqual(['field-voices']);
  });

  it('the body router needs the body, the hand voices AND a live route', () => {
    const s = seedSettings('Pentatonic');
    const bodyOn = { ...s, body: { ...s.body, enabled: true } };
    expect(branchIdsFor(bodyOn).sort()).toEqual(['body-source', 'field-voices']);
    const routed = {
      ...bodyOn,
      bodyMap: { ...bodyOn.bodyMap, routes: { ...bodyOn.bodyMap.routes, a: { ...bodyOn.bodyMap.routes.a, target: 'gain', feature: 'body.geom.lean' } } },
    };
    expect(branchIdsFor(routed as typeof s).sort()).toEqual(['body-route', 'body-source', 'field-voices']);
    const silentHands = { ...routed, handMap: { ...routed.handMap, maxGain: 0 } };
    expect(branchIdsFor(silentHands as typeof s).sort()).toEqual(['body-source']);
  });

  it('the enable dials each imply their branch', () => {
    const s = seedSettings('Pentatonic');
    const all = {
      ...s,
      conductor: { ...s.conductor, enabled: true },
      midi: { ...s.midi, enabled: true },
      steer: { ...s.steer, enabled: true },
    };
    expect(branchIdsFor(all).sort()).toEqual(['conductor', 'field-voices', 'generative', 'midi-out']);
  });

  it('a partial settings object (mid-migration of an older persisted state) derives without throwing', () => {
    expect(branchIdsFor({})).toEqual(['field-voices']);
    expect(branchIdsFor({ faceMapping: 'chord' } as never).sort()).toEqual(['face-chord', 'face-source', 'field-voices']);
    expect(branchIdsFor({ bodyMap: { routes: { a: undefined } }, body: { enabled: true } }).sort()).toEqual(['body-source', 'field-voices']);
  });

  it('branchSetKey is order-insensitive', () => {
    expect(branchSetKey(['b', 'a'])).toBe(branchSetKey(['a', 'b']));
    expect(branchSetKey(['a'])).not.toBe(branchSetKey(['a', 'b']));
  });
});

describe('every seed × every demand combination composes, compiles and ticks', () => {
  const registry = createAppRegistry();
  const demandCases: Record<string, DerivationContext> = {
    none: {},
    face: { demanded: new Set([FACE_GROUP_IDS[0]]) },
    body: { demanded: new Set([BODY_GROUP_IDS[0]]) },
    'face+body': { demanded: new Set([FACE_GROUP_IDS[0], BODY_GROUP_IDS[0]]) },
    lab: { featureLab: { ...defaultFeatureLab(), show: true, groups: [FACE_GROUP_IDS[0], BODY_GROUP_IDS[0]] } },
  };

  for (const seed of SEED_INSTRUMENTS) {
    for (const [demandName, ctx] of Object.entries(demandCases)) {
      it(`${seed.name} with demand "${demandName}"`, () => {
        const settings = settingsFromLayer(seed.layer);
        const branchIds = branchIdsFor(settings, ctx);
        const { spec } = composeInstrumentGraph(branchIds, undefined, registry);
        const recorder = new StreamRecorder({ only: ['merge.params'] });
        const engine = new Engine(spec, registry, { taps: [recorder], validatePorts: true });
        for (let i = 0; i < 30; i++) engine.tick();
        const merged = recorder.values('merge.params') as SynthParams[];
        expect(merged).toHaveLength(30);
        engine.dispose();
      });
    }
  }
});
