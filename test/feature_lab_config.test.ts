/**
 * The Feature Lab as a TOOLING preference rather than an instrument parameter (#136).
 *
 * Three claims are pinned here, each of which was FALSE before #136:
 *  1. the Lab is not part of an instrument — it is not a dial, not a preset field, and
 *     so cannot be dirtied by editing it or clobbered by loading an instrument;
 *  2. the engine still sees one composed overlay config, so the meters keep working;
 *  3. the Lab can turn the face model on by itself — you can measure the face without
 *     handing the face control of the sound.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { thoreminDials } from '@/settings/dials';
import { SettingsSchema } from '@/settings/schema';
import { OverlayDialSchema, OverlayParamsSchema } from '@/nodes/output/canvas_overlay';
import { defaultFeatureLab, labWantsFace, FACE_GROUP_IDS } from '@/features/labConfig';
import { faceActive } from '@/nodes/sources/webcam_face';
import { storeControlsNode, type ControlSnapshot } from '@/nodes/sources/store_controls';
import { faceFeatureVectorNode } from '@/nodes/features/face_feature_vector';
import { normalizeLayer } from '@/app/dials/instruments';
import { useControls, toSettings, migrateControls, mergeControls } from '@/app/store';
import type { NodeContext } from '@/dag';

describe('the Feature Lab is not part of the instrument', () => {
  it('is not a dial — the overlay dial carries no featureLab', () => {
    // The whole bug: a measuring tool filed as an instrument parameter. If this ever
    // goes back into the dial, editing a meter marks the instrument dirty again.
    expect(Object.keys(OverlayDialSchema.shape)).not.toContain('featureLab');
    expect(thoreminDials.keys).not.toContain('featureLab');
    const overlayDial = thoreminDials.schema.shape.overlay;
    expect(Object.keys((overlayDial as unknown as typeof OverlayDialSchema).shape ?? {})).not.toContain(
      'featureLab',
    );
  });

  it('is not a preset field — an instrument snapshot never carries it', () => {
    expect(Object.keys(SettingsSchema.shape)).not.toContain('featureLab');
    useControls.getState().setFeatureLab({ show: true, columns: 7 });
    expect(toSettings(useControls.getState())).not.toHaveProperty('featureLab');
  });

  it('survives loading an instrument (an instrument cannot reconfigure the meters)', () => {
    useControls.getState().setFeatureLab({ show: true, columns: 7 });
    const settings = SettingsSchema.parse(toSettings(useControls.getState()));
    useControls.getState().applySettings(settings);
    expect(useControls.getState().featureLab.show).toBe(true);
    expect(useControls.getState().featureLab.columns).toBe(7);
  });

  it('IS still an overlay ELEMENT on the node side (the meters are drawn by the overlay)', () => {
    expect(Object.keys(OverlayParamsSchema.shape)).toContain('featureLab');
  });
});

describe('persistence: the lab is a per-device tooling pref', () => {
  it('migrates a v6 blob, lifting overlay.featureLab out of the instrument', () => {
    const v6 = { overlay: { featureLab: { show: true, columns: 5 } } };
    const migrated = migrateControls(v6, 6) as unknown as Record<string, unknown>;
    expect(migrated.featureLab).toMatchObject({ show: true, columns: 5 });
    // …and it is GONE from the overlay, which the lab-free schema would otherwise strip
    // silently — that is the difference between migrating the value and losing it.
    expect((migrated.overlay as Record<string, unknown>).featureLab).toBeUndefined();
  });

  it('heals a corrupt lab blob back to the defaults rather than throwing', () => {
    const current = useControls.getState();
    const merged = mergeControls({ featureLab: { columns: 'banana' } }, current);
    expect(merged.featureLab).toEqual(current.featureLab);
  });

  it('defaults to meters OFF (the Lab is opt-in — but now findable)', () => {
    expect(defaultFeatureLab().show).toBe(false);
  });
});

describe('store-controls composes the two back into one overlay config', () => {
  const runNode = (c: ControlSnapshot) => {
    const node = storeControlsNode.make({} as never);
    return node.process({}, { resources: { controls: () => c } } as unknown as NodeContext);
  };
  const baseVoice = { root: 0, type: 'pentatonic' as const, octaves: 2, baseOctave: 3, sound: 'warmPad' as const };

  it('merges the per-device lab config into the overlay node params', () => {
    const out = runNode({
      right: baseVoice,
      left: baseVoice,
      overlay: OverlayDialSchema.parse({}),
      featureLab: { ...defaultFeatureLab(), show: true, columns: 6 },
    });
    const overlay = out.overlay as Record<string, unknown>;
    expect(overlay.featureLab).toMatchObject({ show: true, columns: 6 });
    // The instrument's own elements are still there — this is a merge, not a swap.
    expect(overlay.landmarks).toBeDefined();
  });

  it('falls back to the lab defaults when the snapshot carries none', () => {
    const out = runNode({ right: baseVoice, left: baseVoice, overlay: OverlayDialSchema.parse({}) });
    expect((out.overlay as Record<string, unknown>).featureLab).toEqual(defaultFeatureLab());
  });
});

describe('the Lab can observe the face without altering the sound', () => {
  it('labWantsFace is true only when the meters are on AND a face group is selected', () => {
    const off = { ...defaultFeatureLab(), show: false, groups: [...FACE_GROUP_IDS] };
    const handOnly = { ...defaultFeatureLab(), show: true, groups: ['hand.whole'] };
    const faceOn = { ...defaultFeatureLab(), show: true, groups: [FACE_GROUP_IDS[0]] };
    expect(labWantsFace(off)).toBe(false);
    expect(labWantsFace(handOnly)).toBe(false);
    expect(labWantsFace(faceOn)).toBe(true);
    expect(labWantsFace(undefined)).toBe(false);
  });

  it('the face model loads for the Lab even with faceMapping = none', () => {
    // THE point of #136's face fix: before it, a face meter was unobservable unless you
    // also put your face in charge of the audio.
    const featureLab = { ...defaultFeatureLab(), show: true, groups: [FACE_GROUP_IDS[0]] };
    expect(faceActive({ faceMapping: 'none', featureLab })).toBe(true);
    expect(faceActive({ faceMapping: 'none' })).toBe(false);
  });

  it('still loads for a face MAPPING with the Lab closed (the old rule is intact)', () => {
    expect(faceActive({ faceMapping: 'timbre' })).toBe(true);
    expect(faceActive({ faceEnabled: true })).toBe(true);
    expect(faceActive(undefined)).toBe(false);
  });
});

beforeEach(() => {
  useControls.getState().setFeatureLab(defaultFeatureLab());
});

describe('the compute gate: the catalog costs nothing when the meters are off', () => {
  // The regression this file exists for. `ctx.resources.controls` is the RAW control
  // store (useEngine wires `() => useControls.getState()`), NOT the composed
  // store-controls output — so a vector node that reads `overlay.featureLab` reads
  // `undefined` since #136, and an undefined live config means "headless", which means
  // "always on". The gate failed OPEN: every user would evaluate all 248 features every
  // frame with the Lab switched off.
  //
  // So this drives the REAL store rather than a hand-shaped fake. The pre-existing
  // `feature_vector_nodes.test.ts` faked `{ overlay: { featureLab } }` and stayed green
  // through the whole bug — a test of a shape production does not produce.
  const liveControls = () => ({ resources: { controls: () => useControls.getState() } }) as unknown as NodeContext;
  const faceFrame = { present: true, blendshapes: { jawOpen: 0.5 }, landmarks: [] };

  it('emits an EMPTY vector when the meters are off (the default)', () => {
    expect(useControls.getState().featureLab.show).toBe(false);
    const node = faceFeatureVectorNode.make({} as never);
    const out = node.process({ face: faceFrame } as never, liveControls());
    expect(out.vector).toEqual({});
  });

  it('emits features once the meters are on', () => {
    useControls.getState().setFeatureLab({ show: true });
    const node = faceFeatureVectorNode.make({} as never);
    const out = node.process({ face: faceFrame } as never, liveControls());
    expect(Object.keys(out.vector as object).length).toBeGreaterThan(0);
  });
});

describe('a legacy saved instrument does not read as dirty on load', () => {
  // The mirror-image bug. `dialsStore.setLayer` stores a layer verbatim and dirty is a
  // structural compare, so an instrument saved BEFORE #136 (whose overlay still carries
  // featureLab) differs from the working layer (whose overlay no longer does) — and every
  // returning player's instrument would show unsaved-edits, forever, having changed nothing.
  it('normalizeLayer strips a stale overlay.featureLab from a stored layer', () => {
    const legacy = { overlay: { ...OverlayDialSchema.parse({}), featureLab: { show: true } } };
    const normalized = normalizeLayer(legacy as never);
    expect((normalized.overlay as Record<string, unknown>).featureLab).toBeUndefined();
    // and it is otherwise untouched
    expect(normalized.overlay).toEqual(OverlayDialSchema.parse({}));
  });

  it('leaves a modern layer structurally identical (no spurious dirty)', () => {
    const modern = { overlay: OverlayDialSchema.parse({}), 'master.volume': 0.4 };
    expect(normalizeLayer(modern as never)).toEqual(modern);
  });
});
